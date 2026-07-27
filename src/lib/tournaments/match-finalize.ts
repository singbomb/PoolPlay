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

import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, sets } from "@/lib/db/schema";
import {
  OperationConflictError,
  OperationValidationError,
  assertExpectedRevision,
  assertParticipantWinner,
} from "@/lib/tournaments/competition-operation-rules";
import {
  evaluateMatchOutcome,
  isSetComplete,
  targetForSet,
  totalSetsForFormat,
} from "@/lib/tournaments/match-format";
import {
  type DbClient,
  type LockedMatch,
  assertActorCanMutateLockedMatch,
  finalizeLockedMatch,
  insertScoreEvent,
  loadLockedMatch,
} from "@/lib/tournaments/score-operation-support";

export { reopenMatchForCorrection } from "@/lib/tournaments/match-correction";

type SaveSetInput = {
  matchId: string;
  setNumber: number;
  teamAScore: number;
  teamBScore: number;
  expectedRevision: number;
  actorUserId: string;
};

function assertTournamentInProgress(match: LockedMatch): void {
  if (match.tournamentStatus !== "in_progress") {
    throw new OperationValidationError(
      "Scores can only change while the tournament is in progress."
    );
  }
}

function validateScoreWrite(match: LockedMatch, input: SaveSetInput): void {
  assertExpectedRevision(match.scoreRevision, input.expectedRevision);
  assertTournamentInProgress(match);
  if (match.status === "completed") {
    throw new OperationConflictError(
      "Completed matches can only be changed through the host correction workflow.",
      match.scoreRevision
    );
  }
  assertParticipantWinner(
    match.teamAId,
    match.teamAId,
    match.teamBId,
    false
  );
  const { max } = totalSetsForFormat(match.matchFormat);
  if (input.setNumber > max) {
    throw new OperationValidationError(
      `This match format allows at most ${max} sets.`
    );
  }
}

async function loadPreviousSet(
  matchId: string,
  setNumber: number,
  executor: DbClient
): Promise<{ teamAScore: number; teamBScore: number } | null> {
  const [previous] = await executor
    .select({
      teamAScore: sets.teamAScore,
      teamBScore: sets.teamBScore,
    })
    .from(sets)
    .where(
      and(eq(sets.matchId, matchId), eq(sets.setNumber, setNumber))
    )
    .limit(1);
  return previous ?? null;
}

async function upsertSetScore(
  input: SaveSetInput,
  executor: DbClient
): Promise<void> {
  await executor
    .insert(sets)
    .values({
      matchId: input.matchId,
      setNumber: input.setNumber,
      teamAScore: input.teamAScore,
      teamBScore: input.teamBScore,
    })
    .onConflictDoUpdate({
      target: [sets.matchId, sets.setNumber],
      set: {
        teamAScore: input.teamAScore,
        teamBScore: input.teamBScore,
      },
    });
}

async function advanceScoreRevision(
  match: LockedMatch,
  executor: DbClient
): Promise<number> {
  const scoreRevision = match.scoreRevision + 1;
  const now = new Date();
  const [updated] = await executor
    .update(matches)
    .set({
      status: "in_progress",
      startedAt: match.startedAt ?? now,
      warmupStartedAt: match.warmupStartedAt ?? now,
      scoreRevision,
      updatedAt: now,
    })
    .where(
      and(
        eq(matches.id, match.id),
        eq(matches.scoreRevision, match.scoreRevision),
        ne(matches.status, "completed")
      )
    )
    .returning({ id: matches.id });
  if (!updated) {
    throw new OperationConflictError(
      "This score changed on another device. Refresh and try again."
    );
  }
  return scoreRevision;
}

async function loadCompletedSets(
  match: LockedMatch,
  executor: DbClient
): Promise<Array<{ teamAScore: number; teamBScore: number }>> {
  const rows = await executor
    .select({
      setNumber: sets.setNumber,
      teamAScore: sets.teamAScore,
      teamBScore: sets.teamBScore,
    })
    .from(sets)
    .where(eq(sets.matchId, match.id))
    .orderBy(asc(sets.setNumber));
  const settings = {
    format: match.matchFormat,
    targetScore: match.setTargetScore,
    tiebreakTargetScore: match.tiebreakTargetScore,
  };
  return rows.filter((set) =>
    isSetComplete(
      set.teamAScore,
      set.teamBScore,
      targetForSet(settings, set.setNumber)
    )
  );
}

async function saveSetInsideTransaction(
  input: SaveSetInput,
  executor: DbClient
): Promise<{ nextRevision: number; newlyCompleted: boolean }> {
  const match = await loadLockedMatch(input.matchId, executor);
  await assertActorCanMutateLockedMatch(
    match,
    input.actorUserId,
    executor
  );
  validateScoreWrite(match, input);
  const previousSet = await loadPreviousSet(
    match.id,
    input.setNumber,
    executor
  );
  await upsertSetScore(input, executor);
  const scoreRevision = await advanceScoreRevision(match, executor);
  await insertScoreEvent(executor, {
    matchId: match.id,
    revision: scoreRevision,
    actorUserId: input.actorUserId,
    eventType: "set_score_saved",
    setNumber: input.setNumber,
    previousValue: previousSet,
    newValue: {
      teamAScore: input.teamAScore,
      teamBScore: input.teamBScore,
    },
  });

  const completedSets = await loadCompletedSets(match, executor);
  const outcome = evaluateMatchOutcome(
    { format: match.matchFormat },
    match.teamAId!,
    match.teamBId!,
    completedSets
  );
  if (!outcome.shouldFinalize) {
    return { nextRevision: scoreRevision, newlyCompleted: false };
  }
  const nextRevision = await finalizeLockedMatch(
    { ...match, status: "in_progress", scoreRevision },
    outcome.winnerId,
    input.actorUserId,
    executor
  );
  return { nextRevision, newlyCompleted: true };
}

export async function saveSetScoreTransactional(
  input: SaveSetInput
): Promise<{ nextRevision: number; newlyCompleted: boolean }> {
  return db.transaction((tx) =>
    saveSetInsideTransaction(input, tx as unknown as DbClient)
  );
}

export async function finalizeMatchTransactional(input: {
  matchId: string;
  winnerId: string | null;
  expectedRevision: number;
  actorUserId: string;
}): Promise<{ nextRevision: number; newlyCompleted: true }> {
  return db.transaction(async (tx) => {
    const executor = tx as unknown as DbClient;
    const match = await loadLockedMatch(input.matchId, executor);
    await assertActorCanMutateLockedMatch(
      match,
      input.actorUserId,
      executor
    );
    assertExpectedRevision(match.scoreRevision, input.expectedRevision);
    assertTournamentInProgress(match);
    if (match.status === "completed") {
      throw new OperationConflictError(
        "This match is already completed.",
        match.scoreRevision
      );
    }
    const nextRevision = await finalizeLockedMatch(
      match,
      input.winnerId,
      input.actorUserId,
      executor
    );
    return { nextRevision, newlyCompleted: true };
  });
}
