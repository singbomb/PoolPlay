/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  registrationPayments,
  registrationStatusEvents,
  registrations,
  schoolMembers,
  teamMembers,
  tournamentWaivers,
  tournaments,
  users,
  waiverCompletions,
} from "@/lib/db/schema";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  OperationConflictError,
  OperationValidationError,
  canTransitionRegistrationStatus,
} from "@/lib/tournaments/competition-operation-rules";
import { syncManyDivisionPools } from "@/lib/tournaments/division-pools";
import { paymentSettingsFromTournament } from "@/lib/tournaments/payment-access";
import { paymentBlocksConfirm } from "@/lib/tournaments/payment-compliance";
import type { RegistrationStatus } from "@/types";

type DbClient = typeof db;

async function requireCurrentOrganizer(
  executor: DbClient,
  tournament: typeof tournaments.$inferSelect,
  actorUserId: string
): Promise<void> {
  const [actor] = await executor
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actorUserId))
    .for("share")
    .limit(1);
  if (!actor || actor.disabledAt != null) {
    throw new OperationValidationError(
      "Only the current organizer can update registrations."
    );
  }
  if (
    tournament.organizerId === actorUserId ||
    actor.role === "admin"
  ) {
    return;
  }
  if (tournament.hostSchoolId) {
    const [officer] = await executor
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
    if (officer) return;
  }
  throw new OperationValidationError(
    "Only the current organizer can update registrations."
  );
}

async function assertWaiverComplianceForCheckIn(
  executor: DbClient,
  tournament: typeof tournaments.$inferSelect,
  rows: Array<{ teamId: string }>
): Promise<void> {
  if (
    !tournament.waiverEnabled ||
    !tournament.waiverRequiredBeforeCheckIn
  ) {
    return;
  }

  const [waiver] = await executor
    .select({ id: tournamentWaivers.id })
    .from(tournamentWaivers)
    .where(eq(tournamentWaivers.tournamentId, tournament.id))
    .orderBy(desc(tournamentWaivers.version))
    .for("share")
    .limit(1);
  if (!waiver) return;

  const teamIds = [...new Set(rows.map((row) => row.teamId))];
  const rosterRows = await executor
    .select({
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
    })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds))
    .for("share");
  const userIds = [...new Set(rosterRows.map((row) => row.userId))];
  const completions =
    userIds.length === 0
      ? []
      : await executor
          .select({
            teamId: waiverCompletions.teamId,
            userId: waiverCompletions.userId,
          })
          .from(waiverCompletions)
          .where(
            and(
              eq(waiverCompletions.waiverId, waiver.id),
              inArray(waiverCompletions.teamId, teamIds),
              inArray(waiverCompletions.userId, userIds)
            )
          )
          .for("share");

  const rosterByTeam = new Map<string, Set<string>>();
  for (const row of rosterRows) {
    const roster = rosterByTeam.get(row.teamId) ?? new Set<string>();
    roster.add(row.userId);
    rosterByTeam.set(row.teamId, roster);
  }
  const completeByTeam = new Map<string, Set<string>>();
  for (const row of completions) {
    const complete = completeByTeam.get(row.teamId) ?? new Set<string>();
    complete.add(row.userId);
    completeByTeam.set(row.teamId, complete);
  }

  const blocked = teamIds.filter((teamId) => {
    const roster = rosterByTeam.get(teamId);
    const complete = completeByTeam.get(teamId);
    return (
      !roster ||
      roster.size === 0 ||
      [...roster].some((userId) => !complete?.has(userId))
    );
  });
  if (blocked.length > 0) {
    throw new OperationValidationError(
      `Waivers are incomplete for ${blocked.length} team${blocked.length === 1 ? "" : "s"}. Complete or waive every player before check-in.`
    );
  }
}

function validateTournamentStage(
  tournament: typeof tournaments.$inferSelect,
  toStatus: RegistrationStatus
): void {
  if (isTournamentArchived(tournament.date)) {
    throw new OperationValidationError(
      "Archived tournament registrations cannot be changed."
    );
  }

  if (toStatus === "checked_in") {
    if (tournament.status !== "in_progress") {
      throw new OperationValidationError(
        "Teams can only be checked in while the tournament is in progress."
      );
    }
    return;
  }

  if (
    tournament.status !== "registration_open" &&
    tournament.status !== "registration_closed"
  ) {
    throw new OperationValidationError(
      "Registrations cannot be updated in the current tournament stage."
    );
  }
}

export async function transitionRegistrationStatuses(input: {
  tournamentId: string;
  registrationIds: string[];
  toStatus: RegistrationStatus;
  actorUserId: string;
  operationId: string;
  reason?: string;
}): Promise<{ count: number; replayed: boolean }> {
  const ids = [...new Set(input.registrationIds)].sort();
  if (ids.length === 0) {
    throw new OperationValidationError("No registrations selected.");
  }

  return db.transaction(async (tx) => {
    const executor = tx as unknown as DbClient;
    await executor.execute(sql`
      SELECT id
      FROM ${tournaments}
      WHERE ${tournaments.id} = ${input.tournamentId}
      FOR UPDATE
    `);

    const [tournament] = await executor
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .limit(1);
    if (!tournament) {
      throw new OperationValidationError("Tournament not found.");
    }
    await requireCurrentOrganizer(
      executor,
      tournament,
      input.actorUserId
    );
    validateTournamentStage(tournament, input.toStatus);

    const rows = await executor
      .select({
        id: registrations.id,
        teamId: registrations.teamId,
        divisionId: registrations.divisionId,
        status: registrations.status,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.tournamentId, input.tournamentId),
          inArray(registrations.id, ids)
        )
      )
      .orderBy(registrations.id)
      .for("update");
    if (rows.length !== ids.length) {
      throw new OperationConflictError(
        "Some registrations were removed or changed. Refresh and try again."
      );
    }

    const priorEvents = await executor
      .select({
        registrationId: registrationStatusEvents.registrationId,
        toStatus: registrationStatusEvents.toStatus,
        actorUserId: registrationStatusEvents.actorUserId,
      })
      .from(registrationStatusEvents)
      .where(
        and(
          eq(registrationStatusEvents.tournamentId, input.tournamentId),
          eq(registrationStatusEvents.operationId, input.operationId)
        )
      );
    if (priorEvents.length > 0) {
      const priorRegistrationIds = new Set(
        priorEvents.map((event) => event.registrationId)
      );
      const exactReplay =
        priorEvents.length === ids.length &&
        priorRegistrationIds.size === ids.length &&
        ids.every((id) => priorRegistrationIds.has(id)) &&
        priorEvents.every(
          (event) =>
            event.toStatus === input.toStatus &&
            event.actorUserId === input.actorUserId
        ) &&
        rows.every((row) => row.status === input.toStatus);
      if (exactReplay) {
        return { count: ids.length, replayed: true };
      }
      throw new OperationConflictError(
        "This request was already used for a different registration change."
      );
    }

    for (const row of rows) {
      if (!canTransitionRegistrationStatus(row.status, input.toStatus)) {
        throw new OperationValidationError(
          `Registration cannot move from ${row.status} to ${input.toStatus}.`
        );
      }
    }

    if (input.toStatus === "checked_in") {
      await assertWaiverComplianceForCheckIn(executor, tournament, rows);
    }

    if (
      input.toStatus === "confirmed" ||
      input.toStatus === "checked_in"
    ) {
      const paymentRows = await executor
        .select({
          registrationId: registrationPayments.registrationId,
          status: registrationPayments.status,
        })
        .from(registrationPayments)
        .where(inArray(registrationPayments.registrationId, ids));
      const paymentByRegistration = new Map(
        paymentRows.map((payment) => [payment.registrationId, payment])
      );
      const settings = paymentSettingsFromTournament(tournament);
      const blockedCount = ids.filter((id) =>
        paymentBlocksConfirm(settings, paymentByRegistration.get(id))
      ).length;
      if (blockedCount > 0) {
        throw new OperationValidationError(
          `Payment required before updating ${blockedCount} registration${blockedCount === 1 ? "" : "s"}.`
        );
      }
    }

    const changedRows = rows.filter(
      (row) => row.status !== input.toStatus
    );
    if (changedRows.length === 0) {
      return { count: ids.length, replayed: true };
    }

    for (const row of changedRows) {
      const [updated] = await executor
        .update(registrations)
        .set({
          status: input.toStatus,
          revision: sql`${registrations.revision} + 1`,
        })
        .where(
          and(
            eq(registrations.id, row.id),
            eq(registrations.tournamentId, input.tournamentId),
            eq(registrations.status, row.status)
          )
        )
        .returning({ id: registrations.id });
      if (!updated) {
        throw new OperationConflictError(
          "A registration changed on another device. Refresh and try again."
        );
      }

      await executor.insert(registrationStatusEvents).values({
        registrationId: row.id,
        tournamentId: input.tournamentId,
        teamId: row.teamId,
        fromStatus: row.status,
        toStatus: input.toStatus,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        reason: input.reason,
      });
    }

    await syncManyDivisionPools(
      input.tournamentId,
      changedRows.map((row) => row.divisionId),
      executor
    );
    return { count: changedRows.length, replayed: false };
  });
}
