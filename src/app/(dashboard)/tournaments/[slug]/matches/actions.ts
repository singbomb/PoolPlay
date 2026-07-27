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
  matches,
  teamMembers,
  tournaments,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { updateScoreSchema } from "@/lib/validators";
import {
  canRefereeMatch,
  resolveIsTournamentOrganizer,
} from "@/lib/tournaments/permissions";
import { getMatchTournamentId } from "@/lib/tournaments/match-query";
import { assignBracketRefsForBracket } from "@/lib/tournaments/bracket-structure";
import {
  finalizeMatchTransactional,
  reopenMatchForCorrection,
  saveSetScoreTransactional,
} from "@/lib/tournaments/match-finalize";
import { MAX_CORRECTION_REASON_LENGTH } from "@/lib/tournaments/match-correction";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";
import { transitionMatchLifecycleTransactional } from "@/lib/tournaments/score-operation-support";
import { isTournamentArchived } from "@/lib/tournament-status";

type MatchRow = typeof matches.$inferSelect;
type TournamentRow = typeof tournaments.$inferSelect;

interface ControlGate {
  error: string | null;
  user: { id: string; role: string } | null;
  tournament: TournamentRow | null;
  match: MatchRow | null;
  isOrganizer: boolean;
}

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

async function loadUserTeamIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return new Set(rows.map((r) => r.teamId));
}

/**
 * Authorizes the current user to run a match's lifecycle/scoring. The host has
 * full control; otherwise the user must be a member of the assigned ref team
 * while the tournament is in progress.
 */
async function assertCanControlMatch(matchId: string): Promise<ControlGate> {
  const fail = (error: string): ControlGate => ({
    error,
    user: null,
    tournament: null,
    match: null,
    isOrganizer: false,
  });

  const user = await requireUser();

  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) return fail("Match not found");

  const tournamentId = await getMatchTournamentId(matchId);
  if (!tournamentId) return fail("Match not found");

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) return fail("Tournament not found");

  const userTeamIds = await loadUserTeamIds(user.id);
  const isOrganizer = await resolveIsTournamentOrganizer(tournament, user);

  if (!await canRefereeMatch(tournament, user, match, userTeamIds)) {
    return fail(
      "Only the assigned ref team or the host can run this match while the tournament is in progress."
    );
  }

  return { error: null, user, tournament, match, isOrganizer };
}

async function changeMatchLifecycle(
  matchId: string,
  expectedRevision: number,
  action: "warmup" | "start" | "pause"
) {
  const gate = await assertCanControlMatch(matchId);
  if (gate.error || !gate.user) {
    return { error: gate.error };
  }

  try {
    const result = await transitionMatchLifecycleTransactional({
      matchId,
      action,
      expectedRevision,
      actorUserId: gate.user.id,
    });
    revalidatePath(`/tournaments/[slug]/matches/[matchSlug]`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return { success: true as const, nextRevision: result.nextRevision };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}

export async function startWarmup(
  matchId: string,
  expectedRevision: number
) {
  return changeMatchLifecycle(matchId, expectedRevision, "warmup");
}

export async function startMatch(matchId: string, expectedRevision: number) {
  return changeMatchLifecycle(matchId, expectedRevision, "start");
}

/**
 * Take a live match out of in-progress. Scores and `startedAt` are kept so the
 * ref can resume later; status returns to `upcoming` and warmup is cleared.
 */
export async function pauseMatch(matchId: string, expectedRevision: number) {
  return changeMatchLifecycle(matchId, expectedRevision, "pause");
}

/**
 * Save absolute scores for a single set. The client scorekeeper debounces +1/-1
 * taps and sends the resulting totals here. Auto-finalizes the match when the
 * format says enough sets have been played.
 */
export async function saveSetScore(formData: FormData) {
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

  const gate = await assertCanControlMatch(matchId);
  if (gate.error || !gate.match || !gate.user) {
    return { error: gate.error };
  }

  try {
    const result = await saveSetScoreTransactional({
      matchId,
      setNumber,
      teamAScore,
      teamBScore,
      expectedRevision,
      actorUserId: gate.user.id,
    });

    revalidatePath(`/tournaments/[slug]/matches/[matchSlug]`, "page");
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
  winnerId: string | null,
  expectedRevision: number
) {
  const gate = await assertCanControlMatch(matchId);
  if (gate.error || !gate.match || !gate.user) {
    return { error: gate.error };
  }

  try {
    const result = await finalizeMatchTransactional({
      matchId,
      winnerId,
      expectedRevision,
      actorUserId: gate.user.id,
    });

    revalidatePath(`/tournaments/[slug]/matches/[matchSlug]`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return { success: true as const, nextRevision: result.nextRevision };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}

/** Host-only: reopen a completed match for corrections. */
export async function reopenMatch(
  matchId: string,
  expectedRevision: number,
  reason: string
) {
  const gate = await assertCanControlMatch(matchId);
  if (gate.error || !gate.match || !gate.user) return { error: gate.error };
  if (!gate.isOrganizer) {
    return { error: "Only the host can reopen a completed match." };
  }
  const correctionReason = reason.trim();
  if (!correctionReason) {
    return { error: "Add a correction reason before reopening the match." };
  }
  if (correctionReason.length > MAX_CORRECTION_REASON_LENGTH) {
    return {
      error: `Correction reasons must be ${MAX_CORRECTION_REASON_LENGTH} characters or fewer.`,
    };
  }

  try {
    const result = await reopenMatchForCorrection({
      matchId,
      expectedRevision,
      actorUserId: gate.user.id,
      reason: correctionReason,
    });

    revalidatePath(`/tournaments/[slug]/matches/[matchSlug]`, "page");
    revalidatePath("/tournaments/[slug]", "page");
    return {
      success: true as const,
      nextRevision: result.nextRevision,
      invalidatedMatchCount: result.invalidatedMatchCount,
    };
  } catch (error) {
    return { error: competitionOperationError(error) };
  }
}

/** Host-only: edit a match's planned start time from the match/pool/bracket UI. */
export async function updateMatchScheduledTime(
  matchId: string,
  isoTime: string | null
) {
  const user = await requireUser();
  const tournamentId = await getMatchTournamentId(matchId);
  if (!tournamentId) return { error: "Match not found" };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the host can edit the start time." };
  }
  if (isTournamentArchived(tournament.date)) {
    return { error: "This tournament is archived." };
  }

  let scheduledTime: Date | null = null;
  if (isoTime) {
    const parsed = new Date(isoTime);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Enter a valid start time." };
    }
    scheduledTime = parsed;
  }

  const [match] = await db
    .select({ bracketId: matches.bracketId, courtId: matches.courtId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  await db
    .update(matches)
    .set({ scheduledTime, updatedAt: new Date() })
    .where(eq(matches.id, matchId));

  if (match?.bracketId) {
    await assignBracketRefsForBracket(match.bracketId, db, {
      resetRoundOneCourtId: match.courtId,
    });
  }

  revalidatePath(`/tournaments/[slug]/matches/[matchSlug]`, "page");
  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}
