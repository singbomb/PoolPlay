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
  registrationStatusEvents,
  registrations,
  schoolMembers,
  schools,
  teamMembers,
  teams,
  tournaments,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { teamRegistrationBlockReason } from "@/lib/tournaments/registration-eligibility";
import {
  canRegisterTeams,
  registrationGenderMismatchMessage,
  teamMatchesTournamentGender,
} from "@/lib/tournaments/permissions";
import {
  countSchoolRegistrationsForFee,
  createRegistrationPayment,
  type PaymentDbClient,
} from "@/lib/tournaments/payment-compliance";
import type { PaymentTransitionTransaction } from "@/lib/tournaments/payment-transitions";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";

type DbClient = PaymentDbClient;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_TEAM_REGISTRATION_BATCH_SIZE = 32;

function isUniqueViolation(e: unknown): boolean {
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "23505"
  ) {
    return true;
  }
  if (typeof e === "object" && e !== null && "cause" in e) {
    return isUniqueViolation((e as { cause: unknown }).cause);
  }
  return false;
}

export async function insertTeamRegistration(
  tournamentId: string,
  teamId: string,
  status: "confirmed" | "pending",
  client: DbClient = db
): Promise<string> {
  try {
    const [inserted] = await client
      .insert(registrations)
      .values({
        teamId,
        tournamentId,
        divisionId: null,
        status,
      })
      .returning({ id: registrations.id });
    return inserted!.id;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new OperationConflictError(
        "This team is already registered for this tournament."
      );
    }
    throw e;
  }
}

type RegistrationActor = {
  id: string;
  role: string;
};

type RegistrationTeamRow = {
  id: string;
  gender: (typeof teams.$inferSelect)["gender"];
  schoolId: string | null;
  schoolVerificationStatus:
    | (typeof schools.$inferSelect)["verificationStatus"]
    | null;
  teamVerificationStatus: (typeof teams.$inferSelect)["verificationStatus"];
};

function registrationSelectionMatches(
  rows: Array<{ teamId: string }>,
  teamIds: string[]
): boolean {
  if (rows.length !== teamIds.length) return false;
  const selected = new Set(teamIds);
  return rows.every((row) => selected.has(row.teamId));
}

async function resolveHostInsideTransaction(
  client: DbClient,
  tournament: typeof tournaments.$inferSelect,
  actor: RegistrationActor
): Promise<boolean> {
  const [currentActor] = await client
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actor.id))
    .for("share")
    .limit(1);
  if (!currentActor || currentActor.disabledAt != null) {
    throw new OperationValidationError("Your account cannot register teams.");
  }
  if (
    tournament.organizerId === actor.id ||
    currentActor.role === "admin"
  ) {
    return true;
  }
  if (!tournament.hostSchoolId) return false;

  const [officer] = await client
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, tournament.hostSchoolId),
        eq(schoolMembers.userId, actor.id),
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

async function lockAndLoadTournament(
  client: DbClient,
  tournamentId: string
): Promise<typeof tournaments.$inferSelect> {
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

async function findReplayCount(
  client: DbClient,
  input: {
    tournamentId: string;
    teamIds: string[];
    actorId: string;
    operationId: string;
  }
): Promise<number | null> {
  const replayRows = await client
    .select({ teamId: registrationStatusEvents.teamId })
    .from(registrationStatusEvents)
    .where(
      and(
        eq(registrationStatusEvents.tournamentId, input.tournamentId),
        eq(registrationStatusEvents.actorUserId, input.actorId),
        eq(registrationStatusEvents.operationId, input.operationId),
        eq(registrationStatusEvents.reason, "registration_created")
      )
    );
  if (replayRows.length === 0) return null;
  if (!registrationSelectionMatches(replayRows, input.teamIds)) {
    throw new OperationConflictError(
      "This registration operation was already used for a different team selection"
    );
  }
  return replayRows.length;
}

async function loadRegistrationTeams(
  client: DbClient,
  teamIds: string[]
): Promise<Map<string, RegistrationTeamRow>> {
  const teamRows = await client
    .select({
      id: teams.id,
      gender: teams.gender,
      schoolId: teams.schoolId,
      schoolVerificationStatus: schools.verificationStatus,
      teamVerificationStatus: teams.verificationStatus,
    })
    .from(teams)
    .leftJoin(schools, eq(teams.schoolId, schools.id))
    .where(inArray(teams.id, teamIds));
  return new Map(teamRows.map((team) => [team.id, team]));
}

async function loadCaptainTeamIds(
  client: DbClient,
  actorId: string,
  teamIds: string[],
  isHost: boolean
): Promise<Set<string>> {
  if (isHost) return new Set(teamIds);
  const memberships = await client
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, actorId),
        inArray(teamMembers.teamId, teamIds)
      )
    )
    .for("share");
  return new Set(
    memberships
      .filter((membership) => membership.role === "captain")
      .map((membership) => membership.teamId)
  );
}

async function loadExistingRegistrationTeamIds(
  client: DbClient,
  tournamentId: string,
  teamIds: string[]
): Promise<Set<string>> {
  const rows = await client
    .select({ teamId: registrations.teamId })
    .from(registrations)
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        inArray(registrations.teamId, teamIds)
      )
    );
  return new Set(rows.map((row) => row.teamId));
}

function validateRegistrationBatch(input: {
  tournamentGender: (typeof tournaments.$inferSelect)["gender"];
  teamIds: string[];
  teamById: Map<string, RegistrationTeamRow>;
  captainTeamIds: Set<string>;
  existingTeamIds: Set<string>;
  isHost: boolean;
}): void {
  for (const teamId of input.teamIds) {
    const team = input.teamById.get(teamId);
    if (!team) throw new OperationValidationError("Team not found.");

    const block = teamRegistrationBlockReason(
      team.schoolId,
      team.schoolVerificationStatus,
      team.teamVerificationStatus
    );
    if (block) throw new OperationValidationError(block);
    if (!teamMatchesTournamentGender(team.gender, input.tournamentGender)) {
      throw new OperationValidationError(
        registrationGenderMismatchMessage(input.tournamentGender)
      );
    }
    if (!input.isHost && !input.captainTeamIds.has(teamId)) {
      throw new OperationValidationError(
        "Only team captains or the tournament host can register teams for this event"
      );
    }
    if (input.existingTeamIds.has(teamId)) {
      throw new OperationConflictError(
        "This team is already registered for this tournament."
      );
    }
  }
}

async function createRegistrationBatch(
  client: PaymentTransitionTransaction,
  input: {
    tournament: typeof tournaments.$inferSelect;
    teamIds: string[];
    teamById: Map<string, RegistrationTeamRow>;
    actorId: string;
    operationId: string;
    status: "confirmed" | "pending";
  }
): Promise<void> {
  for (const teamId of input.teamIds) {
    const team = input.teamById.get(teamId)!;
    const priorCount = await countSchoolRegistrationsForFee(
      input.tournament.id,
      team.schoolId,
      client
    );
    const registrationId = await insertTeamRegistration(
      input.tournament.id,
      teamId,
      input.status,
      client
    );
    await createRegistrationPayment(
      input.tournament,
      registrationId,
      teamId,
      team.schoolId,
      {
        client,
        priorSchoolRegistrationCount: priorCount,
        operationId: input.operationId,
        ...(input.status === "confirmed"
          ? { hostWaived: true, hostUserId: input.actorId }
          : {}),
      }
    );
    await client.insert(registrationStatusEvents).values({
      registrationId,
      tournamentId: input.tournament.id,
      teamId,
      fromStatus: null,
      toStatus: input.status,
      actorUserId: input.actorId,
      operationId: input.operationId,
      reason: "registration_created",
    });
  }
}

export async function registerTeamsAtomically(input: {
  tournamentId: string;
  teamIds: string[];
  actor: RegistrationActor;
  operationId: string;
}): Promise<{ count: number; replayed: boolean }> {
  const uniqueIds = [...new Set(input.teamIds.filter(Boolean))];
  if (!UUID_RE.test(input.tournamentId)) {
    throw new OperationValidationError("Tournament ID is invalid.");
  }
  if (!UUID_RE.test(input.operationId)) {
    throw new OperationValidationError("Registration operation is invalid.");
  }
  if (uniqueIds.length === 0) {
    throw new OperationValidationError("Select at least one team.");
  }
  if (uniqueIds.length > MAX_TEAM_REGISTRATION_BATCH_SIZE) {
    throw new OperationValidationError(
      `Select no more than ${MAX_TEAM_REGISTRATION_BATCH_SIZE} teams at once.`
    );
  }
  if (uniqueIds.some((teamId) => !UUID_RE.test(teamId))) {
    throw new OperationValidationError("One or more team IDs are invalid.");
  }

  return db.transaction(async (tx) => {
    const client = tx;
    const tournament = await lockAndLoadTournament(client, input.tournamentId);
    const replayCount = await findReplayCount(client, {
      tournamentId: input.tournamentId,
      teamIds: uniqueIds,
      actorId: input.actor.id,
      operationId: input.operationId,
    });
    if (replayCount != null) {
      return { count: replayCount, replayed: true };
    }

    if (!canRegisterTeams(tournament)) {
      throw new OperationValidationError(
        "Registration is not open for this tournament. Contact the host if you need to sign up."
      );
    }

    const isHost = await resolveHostInsideTransaction(
      client,
      tournament,
      input.actor
    );

    const teamById = await loadRegistrationTeams(client, uniqueIds);
    const captainTeamIds = await loadCaptainTeamIds(
      client,
      input.actor.id,
      uniqueIds,
      isHost
    );
    const existingTeamIds = await loadExistingRegistrationTeamIds(
      client,
      input.tournamentId,
      uniqueIds
    );
    validateRegistrationBatch({
      tournamentGender: tournament.gender,
      teamIds: uniqueIds,
      teamById,
      captainTeamIds,
      existingTeamIds,
      isHost,
    });

    const status = isHost ? "confirmed" : "pending";
    await createRegistrationBatch(client, {
      tournament,
      teamIds: uniqueIds,
      teamById,
      actorId: input.actor.id,
      operationId: input.operationId,
      status,
    });
    return { count: uniqueIds.length, replayed: false };
  });
}

/** Auto-register all teams under the hosting school as confirmed. */
export async function registerHostSchoolTeamsOnCreate(
  tournamentId: string,
  hostSchoolId: string,
  actorUserId: string,
  client: DbClient = db,
  operationId: string = crypto.randomUUID()
): Promise<void> {
  const schoolTeams = await client
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.schoolId, hostSchoolId));

  for (const team of schoolTeams) {
    const registrationId = await insertTeamRegistration(
      tournamentId,
      team.id,
      "confirmed",
      client
    );
    await client.insert(registrationStatusEvents).values({
      registrationId,
      tournamentId,
      teamId: team.id,
      fromStatus: null,
      toStatus: "confirmed",
      actorUserId,
      operationId,
      reason: "host_school_registration_created",
    });
  }
}
