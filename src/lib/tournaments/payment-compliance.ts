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

import { db } from "@/lib/db";
import {
  registrationPayments,
  registrations,
  teams,
  tournaments,
} from "@/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  RegistrationPaymentMethod,
  RegistrationPaymentStatus,
} from "@/types";
import {
  paymentSettingsFromTournament,
  type TournamentPaymentSettings,
} from "@/lib/tournaments/payment-settings";
import {
  transitionRegistrationPaymentInTransaction,
  type PaymentTransitionTransaction,
} from "@/lib/tournaments/payment-transitions";

const ACTIVE_REGISTRATION_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
] as const;

export type RegistrationPaymentRow = {
  registrationId: string;
  teamId: string;
  amountCents: number;
  status: RegistrationPaymentStatus;
  submittedMethod: RegistrationPaymentMethod | null;
  submittedNote: string | null;
  submittedAt: Date | null;
};

export type PaymentDbClient = typeof db | PaymentTransitionTransaction;

type PaymentTournament = {
  id: string;
  paymentEnabled: boolean;
  paymentRequiredBeforeConfirm: boolean;
  paymentFirstTeamFeeCents: number | null;
  paymentAdditionalTeamFeeCents: number | null;
  paymentVenmoHandle: string | null;
  paymentZelleHandle: string | null;
  paymentCashappHandle: string | null;
  paymentOtherInstructions: string | null;
};

type CreateRegistrationPaymentOptions = {
  hostWaived?: boolean;
  hostUserId?: string;
  priorSchoolRegistrationCount?: number;
  operationId?: string;
  client?: PaymentTransitionTransaction;
};

export async function countSchoolRegistrationsForFee(
  tournamentId: string,
  schoolId: string | null,
  client: PaymentDbClient = db
): Promise<number> {
  if (!schoolId) return 0;

  const [row] = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .innerJoin(teams, eq(registrations.teamId, teams.id))
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        eq(teams.schoolId, schoolId),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])
      )
    );

  return row?.count ?? 0;
}

export async function computeRegistrationFeeCents(
  settings: TournamentPaymentSettings,
  tournamentId: string,
  schoolId: string | null,
  options: {
    priorSchoolRegistrationCount?: number;
    client?: PaymentDbClient;
  } = {}
): Promise<number | null> {
  if (!settings.enabled || settings.firstTeamFeeCents == null) return null;

  const additional =
    settings.additionalTeamFeeCents ?? settings.firstTeamFeeCents;
  const priorCount =
    options.priorSchoolRegistrationCount ??
    (await countSchoolRegistrationsForFee(
      tournamentId,
      schoolId,
      options.client
    ));

  return priorCount === 0 ? settings.firstTeamFeeCents : additional;
}

export async function createRegistrationPayment(
  tournament: PaymentTournament,
  registrationId: string,
  teamId: string,
  schoolId: string | null,
  options: CreateRegistrationPaymentOptions = {}
): Promise<void> {
  const { client } = options;
  if (client) {
    await createRegistrationPaymentWithClient(
      tournament,
      registrationId,
      teamId,
      schoolId,
      { ...options, client }
    );
    return;
  }

  await db.transaction((tx) =>
    createRegistrationPaymentWithClient(
      tournament,
      registrationId,
      teamId,
      schoolId,
      {
        ...options,
        client: tx,
      }
    )
  );
}

async function createRegistrationPaymentWithClient(
  tournament: PaymentTournament,
  registrationId: string,
  teamId: string,
  schoolId: string | null,
  options: CreateRegistrationPaymentOptions & {
    client: PaymentTransitionTransaction;
  }
): Promise<void> {
  const settings = paymentSettingsFromTournament(tournament);
  if (!settings.enabled) return;

  const amountCents = await computeRegistrationFeeCents(
    settings,
    tournament.id,
    schoolId,
    {
      priorSchoolRegistrationCount: options.priorSchoolRegistrationCount,
      client: options.client,
    }
  );
  if (amountCents == null) return;

  await options.client
    .insert(registrationPayments)
    .values({
      registrationId,
      tournamentId: tournament.id,
      teamId,
      amountCents,
      status: "unpaid",
    })
    .onConflictDoNothing({ target: registrationPayments.registrationId });

  if (options.hostWaived) {
    await recordHostPaymentWaiver(registrationId, options);
  }
}

async function recordHostPaymentWaiver(
  registrationId: string,
  options: CreateRegistrationPaymentOptions & {
    client: PaymentTransitionTransaction;
  }
): Promise<void> {
  if (!options.hostUserId) {
    throw new Error("A host user is required to waive a payment.");
  }

  const result = await transitionRegistrationPaymentInTransaction(
    {
      kind: "waive",
      registrationId,
      actorUserId: options.hostUserId,
      operationId: crypto.randomUUID(),
      auditMetadata: options.operationId
        ? { batchOperationId: options.operationId }
        : undefined,
    },
    options.client
  );

  if (
    result.outcome === "applied" ||
    result.outcome === "idempotent" ||
    (result.outcome === "conflict" &&
      (result.currentStatus === "confirmed" ||
        result.currentStatus === "waived"))
  ) {
    return;
  }

  throw new Error("Could not record the host payment waiver.");
}

async function backfillRegistrationPaymentsWithClient(
  tournament: PaymentTournament,
  client: PaymentTransitionTransaction
): Promise<void> {
  const settings = paymentSettingsFromTournament(tournament);
  if (!settings.enabled || settings.firstTeamFeeCents == null) return;

  await client.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${tournament.id}
    FOR UPDATE
  `);

  const regRows = await client
    .select({
      id: registrations.id,
      teamId: registrations.teamId,
      registeredAt: registrations.registeredAt,
      schoolId: teams.schoolId,
    })
    .from(registrations)
    .innerJoin(teams, eq(registrations.teamId, teams.id))
    .where(
      and(
        eq(registrations.tournamentId, tournament.id),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])
      )
    )
    .orderBy(asc(registrations.registeredAt), asc(registrations.id));

  const existingRows = await client
    .select({ registrationId: registrationPayments.registrationId })
    .from(registrationPayments)
    .where(eq(registrationPayments.tournamentId, tournament.id));

  await insertMissingRegistrationPayments(
    tournament.id,
    settings.firstTeamFeeCents,
    settings.additionalTeamFeeCents ?? settings.firstTeamFeeCents,
    regRows,
    new Set(existingRows.map((row) => row.registrationId)),
    client
  );
}

async function insertMissingRegistrationPayments(
  tournamentId: string,
  firstTeamFeeCents: number,
  additionalTeamFeeCents: number,
  rows: Array<{ id: string; teamId: string; schoolId: string | null }>,
  existingIds: Set<string>,
  client: PaymentTransitionTransaction
): Promise<void> {
  const schoolCounts = new Map<string, number>();

  for (const row of rows) {
    const prior = row.schoolId ? schoolCounts.get(row.schoolId) ?? 0 : 0;
    const amountCents =
      !row.schoolId || prior === 0
        ? firstTeamFeeCents
        : additionalTeamFeeCents;
    if (row.schoolId) schoolCounts.set(row.schoolId, prior + 1);
    if (existingIds.has(row.id)) continue;

    await client
      .insert(registrationPayments)
      .values({
        registrationId: row.id,
        tournamentId,
        teamId: row.teamId,
        amountCents,
        status: "unpaid",
      })
      .onConflictDoNothing({ target: registrationPayments.registrationId });
  }
}

export async function backfillRegistrationPayments(
  tournament: PaymentTournament,
  client?: PaymentTransitionTransaction
): Promise<void> {
  if (client) {
    await backfillRegistrationPaymentsWithClient(tournament, client);
    return;
  }

  await db.transaction((tx) =>
    backfillRegistrationPaymentsWithClient(tournament, tx)
  );
}

export async function getPaymentsByRegistrationIds(
  registrationIds: string[]
): Promise<Map<string, RegistrationPaymentRow>> {
  if (registrationIds.length === 0) return new Map();

  const rows = await db
    .select({
      registrationId: registrationPayments.registrationId,
      teamId: registrationPayments.teamId,
      amountCents: registrationPayments.amountCents,
      status: registrationPayments.status,
      submittedMethod: registrationPayments.submittedMethod,
      submittedNote: registrationPayments.submittedNote,
      submittedAt: registrationPayments.submittedAt,
    })
    .from(registrationPayments)
    .where(inArray(registrationPayments.registrationId, registrationIds));

  return new Map(
    rows.map((row) => [
      row.registrationId,
      {
        registrationId: row.registrationId,
        teamId: row.teamId,
        amountCents: row.amountCents,
        status: row.status as RegistrationPaymentStatus,
        submittedMethod: row.submittedMethod as RegistrationPaymentMethod | null,
        submittedNote: row.submittedNote,
        submittedAt: row.submittedAt,
      },
    ])
  );
}

export function paymentBlocksConfirm(
  settings: TournamentPaymentSettings,
  payment: Pick<RegistrationPaymentRow, "status"> | null | undefined
): boolean {
  if (!settings.enabled || !settings.requiredBeforeConfirm) return false;
  if (!payment) return true;
  return payment.status !== "confirmed" && payment.status !== "waived";
}

export function paymentIsSettled(
  payment: Pick<RegistrationPaymentRow, "status"> | null | undefined
): boolean {
  return payment?.status === "confirmed" || payment?.status === "waived";
}
