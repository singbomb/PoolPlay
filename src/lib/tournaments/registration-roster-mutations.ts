/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions,
  registrationStatusEvents,
  registrations,
  schoolMembers,
  teamMembers,
  tournaments,
  users,
} from "@/lib/db/schema";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";
import { syncManyDivisionPools } from "@/lib/tournaments/division-pools";

type DbClient = typeof db;
type LockedTournament = typeof tournaments.$inferSelect;

async function lockTournament(
  client: DbClient,
  tournamentId: string
): Promise<LockedTournament> {
  await client.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${tournamentId}
    FOR UPDATE
  `);
  const [tournament] = await client
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) {
    throw new OperationValidationError("Tournament not found.");
  }
  return tournament;
}

async function actorIsOrganizer(
  client: DbClient,
  tournament: LockedTournament,
  actorUserId: string
): Promise<boolean> {
  const [actor] = await client
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actorUserId))
    .for("share")
    .limit(1);
  if (!actor || actor.disabledAt != null) {
    throw new OperationValidationError(
      "Your account cannot modify tournament registrations."
    );
  }
  if (tournament.organizerId === actorUserId || actor.role === "admin") {
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

function validateRosterStage(
  tournament: LockedTournament,
  mode: "edit" | "withdraw"
): void {
  if (isTournamentArchived(tournament.date)) {
    throw new OperationValidationError(
      "Archived tournament registrations cannot be changed."
    );
  }
  const allowed =
    mode === "withdraw"
      ? tournament.status === "registration_open"
      : tournament.status === "registration_open" ||
        tournament.status === "registration_closed";
  if (!allowed) {
    throw new OperationValidationError(
      mode === "withdraw"
        ? "Registration can no longer be withdrawn for this event."
        : "Registrations cannot be changed in the current tournament stage."
    );
  }
}

async function requireOrganizer(
  client: DbClient,
  tournament: LockedTournament,
  actorUserId: string
): Promise<void> {
  if (!(await actorIsOrganizer(client, tournament, actorUserId))) {
    throw new OperationValidationError(
      "Only the organizer can update registrations."
    );
  }
}

async function validateDivision(
  client: DbClient,
  tournamentId: string,
  divisionId: string | null
): Promise<void> {
  if (!divisionId) return;
  const [division] = await client
    .select({ id: divisions.id })
    .from(divisions)
    .where(
      and(
        eq(divisions.id, divisionId),
        eq(divisions.tournamentId, tournamentId)
      )
    )
    .for("share")
    .limit(1);
  if (!division) {
    throw new OperationValidationError("Invalid pool for this tournament.");
  }
}

export async function assignRegistrationsToDivisionAtomically(input: {
  tournamentId: string;
  registrationIds: string[];
  divisionId: string | null;
  actorUserId: string;
}): Promise<{ count: number }> {
  const ids = [...new Set(input.registrationIds)].sort();
  if (ids.length === 0) {
    throw new OperationValidationError("No teams selected.");
  }

  return db.transaction(async (tx) => {
    const client = tx as unknown as DbClient;
    const tournament = await lockTournament(client, input.tournamentId);
    await requireOrganizer(client, tournament, input.actorUserId);
    validateRosterStage(tournament, "edit");
    await validateDivision(client, input.tournamentId, input.divisionId);

    const rows = await client
      .select({
        id: registrations.id,
        divisionId: registrations.divisionId,
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

    await client
      .update(registrations)
      .set({
        divisionId: input.divisionId,
        revision: sql`${registrations.revision} + 1`,
      })
      .where(
        and(
          eq(registrations.tournamentId, input.tournamentId),
          inArray(registrations.id, ids)
        )
      );

    await syncManyDivisionPools(
      input.tournamentId,
      [input.divisionId, ...rows.map((row) => row.divisionId)],
      client
    );
    return { count: rows.length };
  });
}

export async function removeRegistrationsAtomically(input: {
  tournamentId: string;
  registrationIds: string[];
  actorUserId: string;
}): Promise<{ count: number }> {
  const ids = [...new Set(input.registrationIds)].sort();
  if (ids.length === 0) {
    throw new OperationValidationError("No teams selected.");
  }

  return db.transaction(async (tx) => {
    const client = tx as unknown as DbClient;
    const tournament = await lockTournament(client, input.tournamentId);
    await requireOrganizer(client, tournament, input.actorUserId);
    validateRosterStage(tournament, "edit");

    const rows = await client
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

    const operationId = crypto.randomUUID();
    await client.insert(registrationStatusEvents).values(
      rows.map((row) => ({
        registrationId: row.id,
        tournamentId: input.tournamentId,
        teamId: row.teamId,
        fromStatus: row.status,
        toStatus: row.status,
        actorUserId: input.actorUserId,
        operationId,
        reason: "registration_removed_by_organizer",
      }))
    );

    const removed = await client
      .delete(registrations)
      .where(
        and(
          eq(registrations.tournamentId, input.tournamentId),
          inArray(registrations.id, ids)
        )
      )
      .returning({ id: registrations.id });
    await syncManyDivisionPools(
      input.tournamentId,
      rows.map((row) => row.divisionId),
      client
    );
    return { count: removed.length };
  });
}

export async function removeDivisionPreservingRegistrationsAtomically(input: {
  tournamentId: string;
  divisionId: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const client = tx as unknown as DbClient;
    const tournament = await lockTournament(client, input.tournamentId);
    await requireOrganizer(client, tournament, input.actorUserId);
    if (isTournamentArchived(tournament.date)) {
      throw new OperationValidationError(
        "Archived tournament pools cannot be removed."
      );
    }
    if (
      tournament.status !== "draft" &&
      tournament.status !== "registration_open" &&
      tournament.status !== "registration_closed"
    ) {
      throw new OperationValidationError(
        "Pools cannot be removed after tournament play begins."
      );
    }

    const assigned = await client
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.tournamentId, input.tournamentId),
          eq(registrations.divisionId, input.divisionId)
        )
      )
      .orderBy(registrations.id)
      .for("update");

    if (assigned.length > 0) {
      await client
        .update(registrations)
        .set({
          divisionId: null,
          revision: sql`${registrations.revision} + 1`,
        })
        .where(
          and(
            eq(registrations.tournamentId, input.tournamentId),
            eq(registrations.divisionId, input.divisionId)
          )
        );
    }

    const [removed] = await client
      .delete(divisions)
      .where(
        and(
          eq(divisions.id, input.divisionId),
          eq(divisions.tournamentId, input.tournamentId)
        )
      )
      .returning({ id: divisions.id });
    if (!removed) {
      throw new OperationConflictError(
        "Pool not found or already removed. Refresh and try again."
      );
    }
  });
}

export async function withdrawRegistrationAtomically(input: {
  tournamentId: string;
  teamId: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const client = tx as unknown as DbClient;
    const tournament = await lockTournament(client, input.tournamentId);
    validateRosterStage(tournament, "withdraw");

    const [row] = await client
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
          eq(registrations.teamId, input.teamId)
        )
      )
      .for("update")
      .limit(1);
    if (!row) {
      throw new OperationConflictError(
        "This team is not registered for this tournament."
      );
    }

    if (!(await actorIsOrganizer(client, tournament, input.actorUserId))) {
      const [captain] = await client
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, input.actorUserId),
            eq(teamMembers.role, "captain")
          )
        )
        .for("share")
        .limit(1);
      if (!captain) {
        throw new OperationValidationError(
          "Only team captains or the tournament host can withdraw a team."
        );
      }
    }

    await client.insert(registrationStatusEvents).values({
      registrationId: row.id,
      tournamentId: input.tournamentId,
      teamId: row.teamId,
      fromStatus: row.status,
      toStatus: row.status,
      actorUserId: input.actorUserId,
      operationId: crypto.randomUUID(),
      reason: "registration_withdrawn",
    });
    await client.delete(registrations).where(eq(registrations.id, row.id));
    await syncManyDivisionPools(
      input.tournamentId,
      [row.divisionId],
      client
    );
  });
}
