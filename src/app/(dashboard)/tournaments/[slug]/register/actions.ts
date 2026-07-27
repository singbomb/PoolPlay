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
import { db } from "@/lib/db";
import {
  registrations,
  tournaments,
  teams,
  schools,
} from "@/lib/db/schema";
import { eq, and, notInArray, asc } from "drizzle-orm";
import {
  isSchoolVerifiedForTournament,
  SCHOOL_NOT_VERIFIED_FOR_TOURNAMENT_ERROR,
} from "@/lib/tournaments/registration-eligibility";
import { requireUser } from "@/lib/auth";
import {
  canRegisterTeams,
  resolveIsTournamentOrganizer,
} from "@/lib/tournaments/permissions";
import {
  MAX_TEAM_REGISTRATION_BATCH_SIZE,
  registerTeamsAtomically,
} from "@/lib/tournaments/registrations";
import { withdrawRegistrationAtomically } from "@/lib/tournaments/registration-roster-mutations";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerTeams(
  tournamentId: string,
  teamIds: string[],
  operationId: string
) {
  const user = await requireUser();
  const uniqueIds = [...new Set(teamIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return { error: "Select at least one team" };
  }

  if (!UUID_RE.test(tournamentId)) {
    return { error: "Tournament ID is invalid." };
  }
  if (uniqueIds.length > MAX_TEAM_REGISTRATION_BATCH_SIZE) {
    return {
      error: `Select no more than ${MAX_TEAM_REGISTRATION_BATCH_SIZE} teams at once.`,
    };
  }
  if (uniqueIds.some((teamId) => !UUID_RE.test(teamId))) {
    return { error: "One or more team IDs are invalid." };
  }
  if (!UUID_RE.test(operationId)) {
    return { error: "Could not start registration. Try again." };
  }

  let result: Awaited<ReturnType<typeof registerTeamsAtomically>>;
  try {
    result = await registerTeamsAtomically({
      tournamentId,
      teamIds: uniqueIds,
      actor: user,
      operationId,
    });
  } catch (e) {
    if (
      e instanceof OperationConflictError ||
      e instanceof OperationValidationError
    ) {
      return { error: e.message };
    }
    console.error("Team registration failed", e);
    return { error: "Could not register teams. Try again." };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/register", "page");
  return { success: true as const, count: result.count };
}

export async function registerTeam(
  tournamentId: string,
  teamId: string,
  operationId: string
) {
  const result = await registerTeams(tournamentId, [teamId], operationId);
  if ("error" in result && result.error) {
    return { error: result.error };
  }
  return { success: true as const };
}

export async function withdrawRegistration(
  tournamentId: string,
  teamId: string
) {
  const user = await requireUser();

  try {
    await withdrawRegistrationAtomically({
      tournamentId,
      teamId,
      actorUserId: user.id,
    });
  } catch (error) {
    if (
      error instanceof OperationConflictError ||
      error instanceof OperationValidationError
    ) {
      return { error: error.message };
    }
    console.error("Registration withdrawal failed", error);
    return { error: "Could not withdraw this registration. Try again." };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/register", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true };
}

export type AddableTeamResult = {
  id: string;
  name: string;
  university: string;
  schoolId: string | null;
  schoolName: string | null;
};

/** Host-only: eligible teams for one school (matching gender, not yet registered). */
export async function getAddableTeamsForSchool(
  tournamentId: string,
  schoolId: string
): Promise<{ teams: AddableTeamResult[] } | { error: string }> {
  const user = await requireUser();

  const [tournament] = await db
    .select({
      id: tournaments.id,
      gender: tournaments.gender,
      organizerId: tournaments.organizerId,
      hostSchoolId: tournaments.hostSchoolId,
      status: tournaments.status,
      date: tournaments.date,
    })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    return { error: "Tournament not found" };
  }

  if (!await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the tournament host can add teams" };
  }

  if (!canRegisterTeams(tournament)) {
    return { error: "Registration is not open for this tournament" };
  }

  const [school] = await db
    .select({
      id: schools.id,
      verificationStatus: schools.verificationStatus,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  if (!school) {
    return { error: "School not found" };
  }

  if (!isSchoolVerifiedForTournament(school.verificationStatus)) {
    return { error: SCHOOL_NOT_VERIFIED_FOR_TOURNAMENT_ERROR };
  }

  const existingRegs = await db
    .select({ teamId: registrations.teamId })
    .from(registrations)
    .where(eq(registrations.tournamentId, tournamentId));

  const registeredIds = existingRegs.map((r) => r.teamId);

  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      university: teams.university,
      schoolId: teams.schoolId,
      schoolName: schools.name,
    })
    .from(teams)
    .innerJoin(schools, eq(teams.schoolId, schools.id))
    .where(
      and(
        eq(teams.schoolId, schoolId),
        eq(teams.gender, tournament.gender),
        registeredIds.length > 0
          ? notInArray(teams.id, registeredIds)
          : undefined
      )
    )
    .orderBy(asc(teams.name));

  return { teams: rows };
}
