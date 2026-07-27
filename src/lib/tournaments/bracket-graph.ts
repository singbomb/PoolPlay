/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bracketMatchEdges,
  matches,
} from "@/lib/db/schema";
import { OperationConflictError } from "@/lib/tournaments/competition-operation-rules";
import {
  projectBracketGraph as projectGraphState,
  type GraphEdge,
  type GraphMatchState,
} from "@/lib/tournaments/bracket-projection";

type DbClient = typeof db;

type StoredGraphMatch = GraphMatchState & {
  bracketRound: number;
  bracketPosition: number;
};

async function loadGraphMatches(
  bracketId: string,
  client: DbClient
): Promise<StoredGraphMatch[]> {
  const rows = await client
    .select({
      id: matches.id,
      activation: matches.bracketActivation,
      status: matches.status,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
    })
    .from(matches)
    .where(eq(matches.bracketId, bracketId))
    .orderBy(
      asc(matches.bracketSection),
      asc(matches.bracketRound),
      asc(matches.bracketPosition),
      asc(matches.id)
    );

  return rows.map((row) => {
    if (
      row.activation === null ||
      row.bracketRound === null ||
      row.bracketPosition === null
    ) {
      throw new Error("Bracket graph match metadata is incomplete.");
    }
    return {
      ...row,
      activation: row.activation,
      bracketRound: row.bracketRound,
      bracketPosition: row.bracketPosition,
    };
  });
}

async function loadGraphEdges(
  bracketId: string,
  client: DbClient
): Promise<GraphEdge[]> {
  return client
    .select({
      sourceMatchId: bracketMatchEdges.sourceMatchId,
      sourceOutcome: bracketMatchEdges.sourceOutcome,
      targetMatchId: bracketMatchEdges.targetMatchId,
      targetSlot: bracketMatchEdges.targetSlot,
      condition: bracketMatchEdges.condition,
    })
    .from(bracketMatchEdges)
    .where(eq(bracketMatchEdges.bracketId, bracketId))
    .orderBy(
      asc(bracketMatchEdges.sourceMatchId),
      asc(bracketMatchEdges.sourceOutcome)
    );
}

function participantsChanged(
  current: StoredGraphMatch,
  projected: GraphMatchState
): boolean {
  return (
    current.teamAId !== projected.teamAId ||
    current.teamBId !== projected.teamBId
  );
}

function stateChanged(
  current: StoredGraphMatch,
  projected: GraphMatchState
): boolean {
  return (
    participantsChanged(current, projected) ||
    current.activation !== projected.activation ||
    current.status !== projected.status ||
    current.winnerId !== projected.winnerId
  );
}

async function persistProjection(
  current: StoredGraphMatch,
  projected: GraphMatchState,
  client: DbClient
): Promise<void> {
  if (!stateChanged(current, projected)) return;
  if (
    participantsChanged(current, projected) &&
    current.status !== "upcoming"
  ) {
    throw new OperationConflictError(
      "A downstream bracket match already started with different teams."
    );
  }

  const automaticallyResolved =
    projected.status === "completed" ||
    projected.activation === "not_required";
  await client
    .update(matches)
    .set({
      bracketActivation: projected.activation,
      teamAId: projected.teamAId,
      teamBId: projected.teamBId,
      winnerId: projected.winnerId,
      status: projected.status,
      ...(participantsChanged(current, projected)
        ? { refTeamId: null }
        : {}),
      ...(automaticallyResolved
        ? { warmupStartedAt: null, startedAt: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, current.id));
}

/**
 * Recompute every materialized match slot in a graph bracket. Returns false
 * for legacy coordinate-only brackets so callers can use their v1 fallback.
 */
export async function projectPersistedBracketGraph(
  bracketId: string,
  client: DbClient = db
): Promise<boolean> {
  const edges = await loadGraphEdges(bracketId, client);
  if (edges.length === 0) return false;

  const stored = await loadGraphMatches(bracketId, client);
  const projection = projectGraphState(stored, edges);
  for (const current of stored) {
    await persistProjection(current, projection.get(current.id)!, client);
  }
  return true;
}
