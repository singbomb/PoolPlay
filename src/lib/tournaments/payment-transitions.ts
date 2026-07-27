/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  registrationPaymentEvents,
  registrationPayments,
  registrations,
  schoolMembers,
  teamMembers,
  tournaments,
  users,
} from "@/lib/db/schema";
import type {
  RegistrationPaymentMethod,
  RegistrationPaymentStatus,
} from "@/types";

type PaymentTransitionBase = {
  registrationId: string;
  actorUserId: string;
  operationId: string;
  auditMetadata?: PaymentAuditMetadata;
};

type PaymentAuditMetadata = Record<string, string | number | boolean | null>;

export type RegistrationPaymentTransitionInput =
  | (PaymentTransitionBase & {
      kind: "submit";
      method: RegistrationPaymentMethod;
      note: string | null;
    })
  | (PaymentTransitionBase & {
      kind: "confirm" | "waive";
    });

export type RegistrationPaymentTransitionResult =
  | {
      outcome: "applied" | "idempotent";
      status: RegistrationPaymentStatus;
    }
  | {
      outcome: "conflict";
      currentStatus: RegistrationPaymentStatus;
    }
  | {
      outcome:
        | "not_found"
        | "operation_conflict"
        | "forbidden"
        | "not_enabled";
    };

type PaymentTransactionCallback = Parameters<typeof db.transaction>[0];

/** A Drizzle executor that is already scoped to an open database transaction. */
export type PaymentTransitionTransaction =
  Parameters<PaymentTransactionCallback>[0];

const EXPECTED_STATUSES = {
  submit: ["unpaid"],
  confirm: ["unpaid", "submitted"],
  waive: ["unpaid", "submitted"],
} as const satisfies Record<
  RegistrationPaymentTransitionInput["kind"],
  readonly RegistrationPaymentStatus[]
>;

function targetStatus(
  kind: RegistrationPaymentTransitionInput["kind"]
): RegistrationPaymentStatus {
  switch (kind) {
    case "submit":
      return "submitted";
    case "confirm":
      return "confirmed";
    case "waive":
      return "waived";
  }
}

function eventMetadata(
  input: RegistrationPaymentTransitionInput
): PaymentAuditMetadata {
  if (input.kind === "submit") {
    return {
      ...input.auditMetadata,
      action: input.kind,
      method: input.method,
      note: input.note,
    };
  }

  return {
    ...input.auditMetadata,
    action: input.kind,
  };
}

function eventMatchesInput(
  event: {
    registrationId: string | null;
    actorUserId: string | null;
    toStatus: RegistrationPaymentStatus;
    metadata: Record<string, unknown> | null;
  },
  input: RegistrationPaymentTransitionInput,
  metadata: PaymentAuditMetadata
): boolean {
  if (
    event.registrationId !== input.registrationId ||
    event.actorUserId !== input.actorUserId ||
    event.toStatus !== targetStatus(input.kind)
  ) {
    return false;
  }

  const stored = event.metadata ?? {};
  const keys = Object.keys(metadata);
  return (
    Object.keys(stored).length === keys.length &&
    keys.every((key) => stored[key] === metadata[key])
  );
}

function transitionValues(input: RegistrationPaymentTransitionInput) {
  const now = sql`now()`;

  switch (input.kind) {
    case "submit":
      return {
        status: "submitted" as const,
        submittedMethod: input.method,
        submittedNote: input.note,
        submittedByUserId: input.actorUserId,
        submittedAt: now,
        confirmedByUserId: null,
        confirmedAt: null,
        waivedByUserId: null,
        waivedAt: null,
        updatedAt: now,
      };
    case "confirm":
      return {
        status: "confirmed" as const,
        confirmedByUserId: input.actorUserId,
        confirmedAt: now,
        waivedByUserId: null,
        waivedAt: null,
        updatedAt: now,
      };
    case "waive":
      return {
        status: "waived" as const,
        confirmedByUserId: null,
        confirmedAt: null,
        waivedByUserId: input.actorUserId,
        waivedAt: now,
        updatedAt: now,
      };
  }
}

type LockedPayment = {
  id: string;
  registrationId: string;
  tournamentId: string;
  status: RegistrationPaymentStatus;
};

type LockedPaymentContext = {
  registrationId: string;
  teamId: string;
  tournament: typeof tournaments.$inferSelect;
};

async function lockPaymentContext(
  client: PaymentTransitionTransaction,
  registrationId: string
): Promise<LockedPaymentContext | null> {
  const [hint] = await client
    .select({ tournamentId: registrations.tournamentId })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);
  if (!hint) return null;

  await client.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${hint.tournamentId}
    FOR UPDATE
  `);
  const [registration] = await client
    .select({
      id: registrations.id,
      teamId: registrations.teamId,
      tournamentId: registrations.tournamentId,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.tournamentId, hint.tournamentId)
      )
    )
    .for("update")
    .limit(1);
  if (!registration) return null;

  const [tournament] = await client
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, registration.tournamentId))
    .limit(1);
  if (!tournament) return null;
  return {
    registrationId: registration.id,
    teamId: registration.teamId,
    tournament,
  };
}

async function actorCanApplyTransition(
  client: PaymentTransitionTransaction,
  context: LockedPaymentContext,
  input: RegistrationPaymentTransitionInput
): Promise<boolean> {
  const [actor] = await client
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, input.actorUserId))
    .for("share")
    .limit(1);
  if (!actor || actor.disabledAt != null) return false;

  if (input.kind === "submit") {
    const [captain] = await client
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, context.teamId),
          eq(teamMembers.userId, input.actorUserId),
          eq(teamMembers.role, "captain")
        )
      )
      .for("share")
      .limit(1);
    return captain != null;
  }

  return actorCanManagePaymentTournament(
    client,
    context.tournament,
    input.actorUserId,
    actor.role
  );
}

export async function actorCanManagePaymentTournament(
  client: PaymentTransitionTransaction,
  tournament: Pick<
    typeof tournaments.$inferSelect,
    "organizerId" | "hostSchoolId"
  >,
  actorUserId: string,
  knownActorRole?: string
): Promise<boolean> {
  let actorRole = knownActorRole;
  if (actorRole == null) {
    const [actor] = await client
      .select({ role: users.role, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, actorUserId))
      .for("share")
      .limit(1);
    if (!actor || actor.disabledAt != null) return false;
    actorRole = actor.role;
  }

  if (tournament.organizerId === actorUserId || actorRole === "admin") {
    return true;
  }
  if (!tournament.hostSchoolId) return false;
  const [officer] = await client
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, tournament.hostSchoolId),
        eq(schoolMembers.userId, actorUserId),
        or(
          eq(schoolMembers.role, "president"),
          eq(schoolMembers.role, "officer")
        )
      )
    )
    .for("share")
    .limit(1);
  return officer != null;
}

async function lockPaymentOperation(
  client: PaymentTransitionTransaction,
  operationId: string
): Promise<void> {
  await client.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`poolplay:registration-payment:${operationId}`},
        0
      )
    )
  `);
}

async function findOperationReplay(
  client: PaymentTransitionTransaction,
  input: RegistrationPaymentTransitionInput,
  metadata: PaymentAuditMetadata
): Promise<RegistrationPaymentTransitionResult | null> {
  const [event] = await client
    .select({
      registrationId: registrationPaymentEvents.registrationId,
      actorUserId: registrationPaymentEvents.actorUserId,
      toStatus: registrationPaymentEvents.toStatus,
      metadata: registrationPaymentEvents.metadata,
    })
    .from(registrationPaymentEvents)
    .where(eq(registrationPaymentEvents.operationId, input.operationId))
    .limit(1);

  if (!event) return null;
  return eventMatchesInput(event, input, metadata)
    ? { outcome: "idempotent", status: event.toStatus }
    : { outcome: "operation_conflict" };
}

async function lockPayment(
  client: PaymentTransitionTransaction,
  registrationId: string
): Promise<LockedPayment | null> {
  const [payment] = await client
    .select({
      id: registrationPayments.id,
      registrationId: registrationPayments.registrationId,
      tournamentId: registrationPayments.tournamentId,
      status: registrationPayments.status,
    })
    .from(registrationPayments)
    .where(eq(registrationPayments.registrationId, registrationId))
    .for("update")
    .limit(1);

  return payment ?? null;
}

async function applyPaymentCas(
  client: PaymentTransitionTransaction,
  paymentId: string,
  expectedStatuses: readonly RegistrationPaymentStatus[],
  input: RegistrationPaymentTransitionInput
): Promise<RegistrationPaymentStatus | null> {
  const [updated] = await client
    .update(registrationPayments)
    .set(transitionValues(input))
    .where(
      and(
        eq(registrationPayments.id, paymentId),
        inArray(registrationPayments.status, [...expectedStatuses])
      )
    )
    .returning({ status: registrationPayments.status });

  return updated?.status ?? null;
}

async function currentPaymentResult(
  client: PaymentTransitionTransaction,
  paymentId: string
): Promise<RegistrationPaymentTransitionResult> {
  const [current] = await client
    .select({ status: registrationPayments.status })
    .from(registrationPayments)
    .where(eq(registrationPayments.id, paymentId))
    .limit(1);

  return current
    ? { outcome: "conflict", currentStatus: current.status }
    : { outcome: "not_found" };
}

async function insertPaymentEvent(
  client: PaymentTransitionTransaction,
  payment: LockedPayment,
  input: RegistrationPaymentTransitionInput,
  toStatus: RegistrationPaymentStatus,
  metadata: PaymentAuditMetadata
): Promise<void> {
  await client.insert(registrationPaymentEvents).values({
    paymentId: payment.id,
    registrationId: payment.registrationId,
    tournamentId: payment.tournamentId,
    actorUserId: input.actorUserId,
    fromStatus: payment.status,
    toStatus,
    operationId: input.operationId,
    metadata,
  });
}

/**
 * Apply one payment transition and its audit event atomically.
 *
 * The operation-level advisory lock makes an operation UUID replayable even
 * when two requests arrive together. The row lock preserves the exact
 * from-status recorded by the audit event, while the status predicate remains
 * a compare-and-set guard against unsupported transitions.
 */
export async function transitionRegistrationPaymentInTransaction(
  input: RegistrationPaymentTransitionInput,
  client: PaymentTransitionTransaction
): Promise<RegistrationPaymentTransitionResult> {
  const context = await lockPaymentContext(client, input.registrationId);
  await lockPaymentOperation(client, input.operationId);
  const metadata = eventMetadata(input);
  const replay = await findOperationReplay(client, input, metadata);
  if (replay) return replay;
  if (!context) return { outcome: "not_found" };
  if (!context.tournament.paymentEnabled) {
    return { outcome: "not_enabled" };
  }
  if (!(await actorCanApplyTransition(client, context, input))) {
    return { outcome: "forbidden" };
  }

  const payment = await lockPayment(client, input.registrationId);
  if (!payment) return { outcome: "not_found" };
  const expectedStatuses: readonly RegistrationPaymentStatus[] =
    EXPECTED_STATUSES[input.kind];
  if (!expectedStatuses.includes(payment.status)) {
    return { outcome: "conflict", currentStatus: payment.status };
  }

  const status = await applyPaymentCas(client, payment.id, expectedStatuses, input);
  if (!status) return currentPaymentResult(client, payment.id);
  await insertPaymentEvent(client, payment, input, status, metadata);

  return { outcome: "applied", status };
}

export async function transitionRegistrationPayment(
  input: RegistrationPaymentTransitionInput
): Promise<RegistrationPaymentTransitionResult> {
  return db.transaction((tx) =>
    transitionRegistrationPaymentInTransaction(input, tx)
  );
}
