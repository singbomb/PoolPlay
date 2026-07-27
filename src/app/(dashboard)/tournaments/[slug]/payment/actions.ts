"use server";

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

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  registrations,
  teamMembers,
  tournaments,
} from "@/lib/db/schema";
import { backfillRegistrationPayments } from "@/lib/tournaments/payment-compliance";
import {
  actorCanManagePaymentTournament,
  transitionRegistrationPayment,
  type RegistrationPaymentTransitionInput,
  type RegistrationPaymentTransitionResult,
} from "@/lib/tournaments/payment-transitions";
import { OperationValidationError } from "@/lib/tournaments/competition-operation-rules";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  canEditTournamentSetup,
  resolveIsTournamentOrganizer,
  tournamentPreparationLockedReason,
} from "@/lib/tournaments/permissions";
import {
  MAX_PAYMENT_FEE_INPUT_LENGTH,
  parsePaymentFeeCents,
  resolveTournamentPaymentFeeCents,
} from "@/lib/tournaments/payment-fees";

const paymentSettingsSchema = z
  .object({
    enabled: z.boolean(),
    requiredBeforeConfirm: z.boolean(),
    firstTeamFeeDollars: z
      .string()
      .trim()
      .max(MAX_PAYMENT_FEE_INPUT_LENGTH, "Fee amount is too long."),
    additionalTeamFeeDollars: z
      .string()
      .trim()
      .max(MAX_PAYMENT_FEE_INPUT_LENGTH, "Fee amount is too long."),
    venmoHandle: z.string().trim().max(200),
    zelleHandle: z.string().trim().max(200),
    cashappHandle: z.string().trim().max(200),
    otherInstructions: z.string().trim().max(2000),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;

    const first = parsePaymentFeeCents(value.firstTeamFeeDollars);
    if (first == null || first <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid first-team fee.",
        path: ["firstTeamFeeDollars"],
      });
    }

    if (value.additionalTeamFeeDollars) {
      const additional = parsePaymentFeeCents(
        value.additionalTeamFeeDollars
      );
      if (additional == null || additional < 0) {
        ctx.addIssue({
          code: "custom",
          message: "Additional team fee must be a valid amount.",
          path: ["additionalTeamFeeDollars"],
        });
      }
    }

    const hasHandle =
      Boolean(value.venmoHandle) ||
      Boolean(value.zelleHandle) ||
      Boolean(value.cashappHandle) ||
      Boolean(value.otherInstructions);

    if (!hasHandle) {
      ctx.addIssue({
        code: "custom",
        message:
          "Add at least one payment method or instructions for teams.",
        path: ["venmoHandle"],
      });
    }
  });

const submitPaymentSchema = z.object({
  registrationId: z.string().uuid(),
  operationId: z.string().uuid(),
  method: z.enum([
    "venmo",
    "zelle",
    "cashapp",
    "check",
    "cash",
    "other",
  ]),
  note: z.string().trim().max(500),
});

const hostPaymentSchema = z.object({
  registrationId: z.string().uuid(),
  operationId: z.string().uuid(),
});

function paymentTransitionError(
  result: RegistrationPaymentTransitionResult,
  kind: RegistrationPaymentTransitionInput["kind"]
): string | null {
  if (result.outcome === "applied" || result.outcome === "idempotent") {
    return null;
  }
  if (result.outcome === "not_found") {
    return "No payment record for this registration.";
  }
  if (result.outcome === "operation_conflict") {
    return "This payment operation was already used for another change.";
  }
  if (result.outcome === "not_enabled") {
    return "Payment tracking is not enabled for this tournament.";
  }
  if (result.outcome === "forbidden") {
    return kind === "submit"
      ? "Only the current team captain can submit payment."
      : "Only the current tournament organizer can settle payments.";
  }
  if (kind === "submit") {
    return "Payment has already been submitted or settled.";
  }
  return "Payment is already settled or changed. Refresh and try again.";
}

async function loadOrganizerTournament(
  tournamentId: string,
  authenticatedUser?: Awaited<ReturnType<typeof requireUser>>
) {
  const user = authenticatedUser ?? (await requireUser());
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can manage tournament payments." as const };
  }

  return { user, tournament };
}

async function loadCaptainRegistration(
  registrationId: string,
  userId: string
) {
  const [reg] = await db
    .select({
      id: registrations.id,
      tournamentId: registrations.tournamentId,
      teamId: registrations.teamId,
      status: registrations.status,
    })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);

  if (!reg) {
    return { error: "Registration not found." as const };
  }

  const [membership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, reg.teamId), eq(teamMembers.userId, userId))
    )
    .limit(1);

  if (!membership || membership.role !== "captain") {
    return { error: "Only team captains can submit payment." as const };
  }

  return { registration: reg };
}

export async function updateTournamentPaymentSettings(
  tournamentId: string,
  input: z.infer<typeof paymentSettingsSchema>
) {
  const loaded = await loadOrganizerTournament(tournamentId);
  if ("error" in loaded) return loaded;
  const { tournament, user } = loaded;

  if (!await canEditTournamentSetup(tournament, user)) {
    return {
      error:
        tournamentPreparationLockedReason(tournament) ??
        "Payment settings cannot be changed in the current tournament stage.",
    };
  }

  const parsed = paymentSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid payment settings.",
    };
  }

  const feeCents = resolveTournamentPaymentFeeCents(
    parsed.data.enabled,
    parsed.data.firstTeamFeeDollars,
    parsed.data.additionalTeamFeeDollars
  )!;

  let updated: typeof tournaments.$inferSelect | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      const [lockedTournament] = await tx
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update")
        .limit(1);
      if (!lockedTournament) return undefined;
      if (
        !(await actorCanManagePaymentTournament(
          tx,
          lockedTournament,
          user.id
        ))
      ) {
        throw new OperationValidationError(
          "Only the current organizer can manage tournament payments."
        );
      }
      if (isTournamentArchived(lockedTournament.date)) {
        throw new OperationValidationError(
          "Archived tournament payment settings cannot be changed."
        );
      }

      const [row] = await tx
        .update(tournaments)
        .set({
          paymentEnabled: parsed.data.enabled,
          paymentRequiredBeforeConfirm: parsed.data.requiredBeforeConfirm,
          paymentFirstTeamFeeCents: feeCents.firstTeamFeeCents,
          paymentAdditionalTeamFeeCents: feeCents.additionalTeamFeeCents,
          paymentVenmoHandle: parsed.data.venmoHandle || null,
          paymentZelleHandle: parsed.data.zelleHandle || null,
          paymentCashappHandle: parsed.data.cashappHandle || null,
          paymentOtherInstructions: parsed.data.otherInstructions || null,
          updatedAt: new Date(),
        })
        .where(eq(tournaments.id, tournamentId))
        .returning();

      if (parsed.data.enabled && row) {
        await backfillRegistrationPayments(row, tx);
      }
      return row;
    });
  } catch (error) {
    if (error instanceof OperationValidationError) {
      return { error: error.message };
    }
    console.error("Payment settings update failed", error);
    return { error: "Could not update payment settings. Try again." };
  }

  if (!updated) {
    return { error: "Tournament no longer exists." };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/register", "page");
  return { success: true as const };
}

export async function captainSubmitPayment(
  input: z.infer<typeof submitPaymentSchema>
) {
  const user = await requireUser();
  const parsed = submitPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid payment submission.",
    };
  }

  const loaded = await loadCaptainRegistration(
    parsed.data.registrationId,
    user.id
  );
  if ("error" in loaded) return loaded;

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, loaded.registration.tournamentId))
    .limit(1);

  if (!tournament?.paymentEnabled) {
    return { error: "Payment tracking is not enabled for this tournament." };
  }

  const transition = await transitionRegistrationPayment({
    kind: "submit",
    registrationId: parsed.data.registrationId,
    actorUserId: user.id,
    operationId: parsed.data.operationId,
    method: parsed.data.method,
    note: parsed.data.note || null,
  });
  const transitionError = paymentTransitionError(transition, "submit");
  if (transitionError) return { error: transitionError };

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}

export async function hostConfirmPayment(
  registrationId: string,
  operationId: string
) {
  const user = await requireUser();
  const parsed = hostPaymentSchema.safeParse({ registrationId, operationId });
  if (!parsed.success) return { error: "Invalid payment operation." };

  const [reg] = await db
    .select({
      id: registrations.id,
      tournamentId: registrations.tournamentId,
    })
    .from(registrations)
    .where(eq(registrations.id, parsed.data.registrationId))
    .limit(1);

  if (!reg) return { error: "Registration not found." };

  const loaded = await loadOrganizerTournament(reg.tournamentId, user);
  if ("error" in loaded) return loaded;

  const transition = await transitionRegistrationPayment({
    kind: "confirm",
    registrationId: parsed.data.registrationId,
    actorUserId: user.id,
    operationId: parsed.data.operationId,
  });
  const transitionError = paymentTransitionError(transition, "confirm");
  if (transitionError) return { error: transitionError };

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}

export async function hostWaivePayment(
  registrationId: string,
  operationId: string
) {
  const user = await requireUser();
  const parsed = hostPaymentSchema.safeParse({ registrationId, operationId });
  if (!parsed.success) return { error: "Invalid payment operation." };

  const [reg] = await db
    .select({
      id: registrations.id,
      tournamentId: registrations.tournamentId,
    })
    .from(registrations)
    .where(eq(registrations.id, parsed.data.registrationId))
    .limit(1);

  if (!reg) return { error: "Registration not found." };

  const loaded = await loadOrganizerTournament(reg.tournamentId, user);
  if ("error" in loaded) return loaded;

  const transition = await transitionRegistrationPayment({
    kind: "waive",
    registrationId: parsed.data.registrationId,
    actorUserId: user.id,
    operationId: parsed.data.operationId,
  });
  const transitionError = paymentTransitionError(transition, "waive");
  if (transitionError) return { error: transitionError };

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}
