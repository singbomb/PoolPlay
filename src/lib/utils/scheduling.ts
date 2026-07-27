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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

import {
  autoScheduleMatchesWithCourtSets,
  SchedulePlanningError,
} from "./dependency-scheduling";

export {
  autoScheduleMatchesWithCourtSets,
  SchedulePlanningError,
} from "./dependency-scheduling";

export interface ScheduleSlot {
  matchId: string;
  courtId: string;
  /** Time when play begins. Warmup runs from `scheduledTime - warmupMinutes`. */
  scheduledTime: Date;
}

export interface ScheduleDependency {
  sourceMatchId: string;
  targetMatchId: string;
}

export interface ScheduleMatchState {
  matchId: string;
  status: "upcoming" | "in_progress" | "completed";
  activation?: "required" | "conditional" | "not_required" | null;
  scheduledTime?: Date | null;
  courtId?: string | null;
  teamAId?: string | null;
  teamBId?: string | null;
}

export interface ScheduleItem {
  matchId: string;
  courtIds: string[];
  teamAId?: string | null;
  teamBId?: string | null;
}

export interface ScheduleConstraints {
  dependencies?: ScheduleDependency[];
  matchStates?: ScheduleMatchState[];
}

export interface CoordinateBracketMatch {
  matchId: string;
  bracketId: string;
  bracketSection: string;
  bracketRound: number;
  bracketPosition: number;
}

export interface TournamentBracketScheduleMatch {
  matchId: string;
  bracketId: string;
  bracketType: "single_elimination" | "double_elimination";
  bracketSection: string;
  bracketRound: number;
  bracketPosition: number;
}

export interface PersistedBracketScheduleDependency
  extends ScheduleDependency {
  bracketId: string;
}

export interface AutoScheduleCandidateState {
  status: "upcoming" | "in_progress" | "completed";
  scheduledTime: Date | null;
  bracketId: string | null;
  bracketActivation: "required" | "conditional" | "not_required" | null;
}

/**
 * Coordinate-only single-elimination brackets do not persist graph edges.
 * Derive each winner feed from round r / position p into
 * round r + 1 / ceil(p / 2) within the same bracket section.
 */
export function deriveSingleEliminationDependencies(
  rows: CoordinateBracketMatch[]
): ScheduleDependency[] {
  const byCoordinate = new Map<string, string>();
  for (const row of rows) {
    byCoordinate.set(
      [
        row.bracketId,
        row.bracketSection,
        row.bracketRound,
        row.bracketPosition,
      ].join(":"),
      row.matchId
    );
  }

  const dependencies: ScheduleDependency[] = [];
  for (const row of rows) {
    const targetId = byCoordinate.get(
      [
        row.bracketId,
        row.bracketSection,
        row.bracketRound + 1,
        Math.ceil(row.bracketPosition / 2),
      ].join(":")
    );
    if (targetId) {
      dependencies.push({
        sourceMatchId: row.matchId,
        targetMatchId: targetId,
      });
    }
  }
  return dependencies;
}

/** Build the exact dependency set consumed by the tournament schedule action. */
export function buildBracketScheduleDependencies(
  rows: TournamentBracketScheduleMatch[],
  persisted: PersistedBracketScheduleDependency[]
): ScheduleDependency[] {
  const graphBracketIds = new Set(
    persisted.map((dependency) => dependency.bracketId)
  );
  if (
    rows.some(
      (row) =>
        row.bracketType === "double_elimination" &&
        !graphBracketIds.has(row.bracketId)
    )
  ) {
    throw new SchedulePlanningError(
      "Cannot auto-schedule because a double-elimination bracket graph is incomplete."
    );
  }
  const coordinateRows = rows.filter(
    (row) =>
      row.bracketType === "single_elimination" &&
      !graphBracketIds.has(row.bracketId)
  );
  return [
    ...persisted.map(({ sourceMatchId, targetMatchId }) => ({
      sourceMatchId,
      targetMatchId,
    })),
    ...deriveSingleEliminationDependencies(coordinateRows),
  ];
}

export function isAutoScheduleCandidate(
  match: AutoScheduleCandidateState
): boolean {
  return (
    match.status === "upcoming" &&
    match.scheduledTime == null &&
    (match.bracketId == null || match.bracketActivation === "required")
  );
}

/** Auto-schedules matches when every match may use the same court list. */
export function autoScheduleMatches(
  matchIds: string[],
  courtIds: string[],
  startTime: Date,
  matchDurationMinutes: number = 30,
  warmupMinutes: number = 0
): ScheduleSlot[] {
  if (courtIds.length === 0 || matchIds.length === 0) return [];
  return autoScheduleMatchesWithCourtSets(
    matchIds.map((matchId) => ({ matchId, courtIds })),
    startTime,
    matchDurationMinutes,
    warmupMinutes
  );
}
