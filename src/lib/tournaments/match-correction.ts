/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bracketMatchEdges,
  brackets,
  divisions,
  matches,
  sets,
} from "@/lib/db/schema";
import { assignBracketRefsForBracket } from "@/lib/tournaments/bracket-structure";
import { projectPersistedBracketGraph } from "@/lib/tournaments/bracket-graph";
import {
  OperationConflictError,
  OperationValidationError,
  assertExpectedRevision,
} from "@/lib/tournaments/competition-operation-rules";
import {
  type DbClient,
  type LockedMatch,
  type MatchStatus,
  assertActorCanMutateLockedMatch,
  assertLockedMatchIsPlayable,
  insertScoreEvent,
  loadLockedMatch,
} from "@/lib/tournaments/score-operation-support";
import { revertTournamentIfBracketsIncomplete } from "@/lib/tournaments/tournament-completion";
import { bracketAdvanceTarget } from "@/lib/utils/bracket";

export const MAX_CORRECTION_REASON_LENGTH = 500;

type InvalidatedMatch = {
  id: string;
  bracketId: string | null;
  bracketRound: number | null;
  bracketPosition: number | null;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  status: MatchStatus;
  scoreRevision: number;
};

type SlotToClear = "A" | "B" | "both";

async function invalidateMatch(
  row: InvalidatedMatch,
  actorUserId: string,
  reason: string,
  executor: DbClient,
  slotToClear: SlotToClear
): Promise<void> {
  await executor.delete(sets).where(eq(sets.matchId, row.id));
  const teamAId =
    slotToClear === "A" || slotToClear === "both" ? null : row.teamAId;
  const teamBId =
    slotToClear === "B" || slotToClear === "both" ? null : row.teamBId;
  const nextRevision = row.scoreRevision + 1;

  await executor
    .update(matches)
    .set({
      teamAId,
      teamBId,
      winnerId: null,
      status: "upcoming",
      warmupStartedAt: null,
      startedAt: null,
      scoreRevision: nextRevision,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, row.id));
  await insertScoreEvent(executor, {
    matchId: row.id,
    revision: nextRevision,
    actorUserId,
    eventType: "downstream_invalidated",
    previousValue: {
      status: row.status,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
      winnerId: row.winnerId,
    },
    newValue: {
      status: "upcoming",
      teamAId,
      teamBId,
      winnerId: null,
    },
    correctionReason: reason,
  });
}

function slotToClear(slots: Set<"A" | "B">): SlotToClear {
  if (slots.size === 2) return "both";
  return slots.has("A") ? "A" : "B";
}

async function loadGraphInvalidationPlan(
  bracketId: string,
  sourceMatchId: string,
  executor: DbClient
): Promise<Map<string, Set<"A" | "B">> | null> {
  const edges = await executor
    .select({
      sourceMatchId: bracketMatchEdges.sourceMatchId,
      targetMatchId: bracketMatchEdges.targetMatchId,
      targetSlot: bracketMatchEdges.targetSlot,
    })
    .from(bracketMatchEdges)
    .where(eq(bracketMatchEdges.bracketId, bracketId));
  if (edges.length === 0) return null;

  const outgoing = new Map<string, typeof edges>();
  for (const edge of edges) {
    const list = outgoing.get(edge.sourceMatchId) ?? [];
    list.push(edge);
    outgoing.set(edge.sourceMatchId, list);
  }

  const plan = new Map<string, Set<"A" | "B">>();
  const queue = [sourceMatchId];
  const expanded = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (expanded.has(current)) continue;
    expanded.add(current);
    for (const edge of outgoing.get(current) ?? []) {
      const slots = plan.get(edge.targetMatchId) ?? new Set<"A" | "B">();
      slots.add(edge.targetSlot === "team_a" ? "A" : "B");
      plan.set(edge.targetMatchId, slots);
      queue.push(edge.targetMatchId);
    }
  }
  return plan;
}

async function invalidateGraphDescendants(
  source: LockedMatch,
  actorUserId: string,
  reason: string,
  executor: DbClient
): Promise<number | null> {
  if (!source.bracketId) return null;
  const plan = await loadGraphInvalidationPlan(
    source.bracketId,
    source.id,
    executor
  );
  if (plan === null) return null;
  const ids = [...plan.keys()];
  if (ids.length === 0) return 0;

  const rows = await executor
    .select({
      id: matches.id,
      bracketId: matches.bracketId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      status: matches.status,
      scoreRevision: matches.scoreRevision,
    })
    .from(matches)
    .where(inArray(matches.id, ids))
    .orderBy(asc(matches.id))
    .for("update");
  const rowById = new Map(rows.map((row) => [row.id, row]));

  for (const [matchId, slots] of plan) {
    const row = rowById.get(matchId);
    if (!row) continue;
    await invalidateMatch(
      row,
      actorUserId,
      reason,
      executor,
      slotToClear(slots)
    );
  }
  await projectPersistedBracketGraph(source.bracketId, executor);
  await assignBracketRefsForBracket(source.bracketId, executor);
  return rows.length;
}

async function loadNextBracketMatch(
  source: LockedMatch,
  round: number,
  position: number,
  executor: DbClient
): Promise<InvalidatedMatch | null> {
  const [next] = await executor
    .select({
      id: matches.id,
      bracketId: matches.bracketId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      status: matches.status,
      scoreRevision: matches.scoreRevision,
    })
    .from(matches)
    .where(
      and(
        eq(matches.bracketId, source.bracketId!),
        eq(matches.bracketRound, round),
        eq(matches.bracketPosition, position)
      )
    )
    .limit(1);
  return next ?? null;
}

async function invalidateBracketDescendants(
  source: LockedMatch,
  actorUserId: string,
  reason: string,
  executor: DbClient
): Promise<number> {
  if (
    !source.bracketId ||
    source.bracketRound == null ||
    source.bracketPosition == null
  ) {
    return 0;
  }
  const graphInvalidated = await invalidateGraphDescendants(
    source,
    actorUserId,
    reason,
    executor
  );
  if (graphInvalidated !== null) return graphInvalidated;

  let round = source.bracketRound;
  let position = source.bracketPosition;
  let invalidated = 0;

  while (true) {
    const feed = bracketAdvanceTarget(round, position);
    const next = await loadNextBracketMatch(
      source,
      feed.round,
      feed.position,
      executor
    );
    if (!next) break;
    await invalidateMatch(next, actorUserId, reason, executor, feed.slot);
    invalidated += 1;
    round = feed.round;
    position = feed.position;
  }
  await assignBracketRefsForBracket(source.bracketId, executor);
  return invalidated;
}

async function loadDivisionBracketMatches(
  divisionId: string,
  executor: DbClient
): Promise<InvalidatedMatch[]> {
  return executor
    .select({
      id: matches.id,
      bracketId: matches.bracketId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      status: matches.status,
      scoreRevision: matches.scoreRevision,
    })
    .from(matches)
    .innerJoin(brackets, eq(matches.bracketId, brackets.id))
    .where(eq(brackets.divisionId, divisionId))
    .orderBy(
      asc(matches.bracketId),
      asc(matches.bracketRound),
      asc(matches.bracketPosition)
    );
}

async function resetDivisionBrackets(
  divisionId: string,
  actorUserId: string,
  reason: string,
  executor: DbClient
): Promise<number> {
  const bracketMatches = await loadDivisionBracketMatches(divisionId, executor);
  const bracketIds = new Set<string>();
  let invalidated = 0;

  for (const row of bracketMatches) {
    if (row.bracketId) bracketIds.add(row.bracketId);
    const hasState =
      row.teamAId !== null ||
      row.teamBId !== null ||
      row.winnerId !== null ||
      row.status !== "upcoming";
    if (!hasState) continue;
    await invalidateMatch(row, actorUserId, reason, executor, "both");
    invalidated += 1;
  }
  for (const bracketId of bracketIds) {
    await assignBracketRefsForBracket(bracketId, executor);
  }
  return invalidated;
}

async function bracketOwnerForPoolCorrection(
  match: LockedMatch,
  executor: DbClient
): Promise<string> {
  if (!match.divisionId) {
    throw new OperationValidationError(
      "The pool match is missing its division."
    );
  }
  const [sourceDivision] = await executor
    .select({ format: divisions.format })
    .from(divisions)
    .where(eq(divisions.id, match.divisionId))
    .limit(1);
  if (!sourceDivision) {
    throw new OperationValidationError("The pool division no longer exists.");
  }
  if (sourceDivision.format !== "pool_to_bracket") {
    return match.divisionId;
  }
  const [owner] = await executor
    .select({ id: divisions.id })
    .from(divisions)
    .where(
      and(
        eq(divisions.tournamentId, match.tournamentId),
        eq(divisions.format, "pool_to_bracket")
      )
    )
    .orderBy(asc(divisions.createdAt), asc(divisions.id))
    .limit(1);
  if (!owner) {
    throw new OperationValidationError(
      "The tournament bracket owner no longer exists."
    );
  }
  return owner.id;
}

async function reopenLockedMatch(
  match: LockedMatch,
  actorUserId: string,
  reason: string,
  executor: DbClient
): Promise<number> {
  const nextRevision = match.scoreRevision + 1;
  const [reopened] = await executor
    .update(matches)
    .set({
      status: "in_progress",
      winnerId: null,
      scoreRevision: nextRevision,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(matches.id, match.id),
        eq(matches.status, "completed"),
        eq(matches.scoreRevision, match.scoreRevision)
      )
    )
    .returning({ id: matches.id });
  if (!reopened) {
    throw new OperationConflictError(
      "This match changed on another device. Refresh and try again."
    );
  }
  await insertScoreEvent(executor, {
    matchId: match.id,
    revision: nextRevision,
    actorUserId,
    eventType: "match_reopened",
    previousValue: { status: match.status, winnerId: match.winnerId },
    newValue: { status: "in_progress", winnerId: null },
    correctionReason: reason,
  });
  return nextRevision;
}

export async function reopenMatchForCorrection(input: {
  matchId: string;
  expectedRevision: number;
  actorUserId: string;
  reason: string;
}): Promise<{ nextRevision: number; invalidatedMatchCount: number }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new OperationValidationError(
      "Add a correction reason before reopening the match."
    );
  }
  if (reason.length > MAX_CORRECTION_REASON_LENGTH) {
    throw new OperationValidationError(
      `Correction reasons must be ${MAX_CORRECTION_REASON_LENGTH} characters or fewer.`
    );
  }
  return db.transaction(async (tx) => {
    const executor = tx as unknown as DbClient;
    const match = await loadLockedMatch(input.matchId, executor);
    await assertActorCanMutateLockedMatch(
      match,
      input.actorUserId,
      executor,
      true
    );
    assertExpectedRevision(match.scoreRevision, input.expectedRevision);
    assertLockedMatchIsPlayable(match);
    if (match.status !== "completed") {
      throw new OperationConflictError(
        "Only a completed match can be reopened.",
        match.scoreRevision
      );
    }
    const nextRevision = await reopenLockedMatch(
      match,
      input.actorUserId,
      reason,
      executor
    );
    const bracketOwnerDivisionId = match.poolId
      ? await bracketOwnerForPoolCorrection(match, executor)
      : null;
    const invalidatedMatchCount = bracketOwnerDivisionId
      ? await resetDivisionBrackets(
          bracketOwnerDivisionId,
          input.actorUserId,
          reason,
          executor
        )
      : await invalidateBracketDescendants(
          match,
          input.actorUserId,
          reason,
          executor
        );
    await revertTournamentIfBracketsIncomplete(match.tournamentId, executor);
    return { nextRevision, invalidatedMatchCount };
  });
}
