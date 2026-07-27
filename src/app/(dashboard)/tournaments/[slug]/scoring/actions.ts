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
import { tournaments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { updateScoreSchema } from "@/lib/validators";
import { canScoreMatches } from "@/lib/tournaments/permissions";
import { getMatchTournamentId } from "@/lib/tournaments/match-query";
import {
  finalizeMatchTransactional,
  saveSetScoreTransactional,
} from "@/lib/tournaments/match-finalize";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";
import { transitionMatchLifecycleTransactional } from "@/lib/tournaments/score-operation-support";

function competitionOperationError(error: unknown): string {
  if (
    error instanceof OperationConflictError ||
    error instanceof OperationValidationError
  ) {
    return error.message;
  }
  console.error("Competition operation failed", error);
  return "Could not save this match. Try again.";
}

async function assertCanScoreMatch(matchId: string) {
  const user = await requireUser();
  const tournamentId = await getMatchTournamentId(matchId);

  if (!tournamentId) {
    return { error: "Match not found" as const, user: null, tournament: null };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canScoreMatches(tournament, user)) {
    return {
      error: "Only the organizer can score matches while the event is in progress." as const,
      user: null,
      tournament: null,
    };
  }

  return { error: null, user, tournament };
}

export async function updateScore(formData: FormData) {
  const parsed = updateScoreSchema.safeParse({
    matchId: formData.get("matchId"),
    setNumber: parseInt(formData.get("setNumber") as string, 10),
    teamAScore: parseInt(formData.get("teamAScore") as string, 10),
    teamBScore: parseInt(formData.get("teamBScore") as string, 10),
    expectedRevision: parseInt(
      formData.get("expectedRevision") as string,
      10
    ),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const {
    matchId,
    setNumber,
    teamAScore,
    teamBScore,
    expectedRevision,
  } = parsed.data;

  const gate = await assertCanScoreMatch(matchId);
  if (gate.error || !gate.user) return { error: gate.error };

  try {
    const result = await saveSetScoreTransactional({
      matchId,
      setNumber,
      teamAScore,
      teamBScore,
      expectedRevision,
      actorUserId: gate.user.id,
    });

    revalidatePath(`/tournaments/[slug]/scoring`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return {
      success: true as const,
      nextRevision: result.nextRevision,
      newlyCompleted: result.newlyCompleted,
    };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}

export async function finalizeMatch(
  matchId: string,
  winnerId: string,
  expectedRevision: number
) {
  const gate = await assertCanScoreMatch(matchId);
  if (gate.error || !gate.user) return { error: gate.error };

  try {
    const result = await finalizeMatchTransactional({
      matchId,
      winnerId,
      expectedRevision,
      actorUserId: gate.user.id,
    });

    revalidatePath(`/tournaments/[slug]/scoring`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return { success: true as const, nextRevision: result.nextRevision };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}

export async function startMatch(matchId: string, expectedRevision: number) {
  const gate = await assertCanScoreMatch(matchId);
  if (gate.error || !gate.user) return { error: gate.error };

  try {
    const result = await transitionMatchLifecycleTransactional({
      matchId,
      action: "start",
      expectedRevision,
      actorUserId: gate.user.id,
    });
    revalidatePath(`/tournaments/[slug]/scoring`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return { success: true as const, nextRevision: result.nextRevision };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}
