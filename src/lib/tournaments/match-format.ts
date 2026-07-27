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

import type { MatchFormat } from "@/lib/labels/match-format";

export const DEFAULT_BRACKET_SET_STARTING_SCORE = 0;

export interface MatchFormatSettings {
  format: MatchFormat;
  startingScore: number;
  targetScore: number;
  tiebreakTargetScore: number;
}

/** True when the match belongs to an elimination bracket (not pool round-robin). */
export function isBracketMatch(match: {
  bracketId: string | null;
  poolId?: string | null;
}): boolean {
  return match.bracketId != null;
}

/** Elimination matches add a deciding set when a two-set format splits 1–1. */
export function matchFormatForMatch(
  format: MatchFormat,
  match: { bracketId: string | null }
): MatchFormat {
  if (isBracketMatch(match) && format === "best_of_2") {
    return "two_with_tiebreak";
  }
  return format;
}

/** Pool matches use `setStartingScore`; bracket matches use `bracketSetStartingScore`. */
export function setStartingScoreForMatch(
  tournament: {
    setStartingScore: number;
    bracketSetStartingScore?: number;
  },
  match: { bracketId: string | null; poolId?: string | null }
): number {
  if (isBracketMatch(match)) {
    return tournament.bracketSetStartingScore ?? DEFAULT_BRACKET_SET_STARTING_SCORE;
  }
  return tournament.setStartingScore;
}

export interface CompletedSet {
  teamAScore: number;
  teamBScore: number;
}

export interface MatchOutcome {
  status: "in_progress" | "completed";
  /** Winner team id or null when the match is a tie or still in progress. */
  winnerId: string | null;
  /** Number of sets played so far. */
  setsPlayed: number;
  /** True when the match is fully resolved per the format rules. */
  isFinished: boolean;
  /** True when no more sets should be added (caller should finalize). */
  shouldFinalize: boolean;
}

/**
 * How many sets a single match should contain for the given format. Used to
 * default the next set number and decide when to auto-finalize.
 */
export function totalSetsForFormat(format: MatchFormat): {
  required: number;
  max: number;
} {
  switch (format) {
    case "play_all_3":
      return { required: 3, max: 3 };
    case "best_of_2":
      return { required: 2, max: 2 };
    case "two_with_tiebreak":
      return { required: 2, max: 3 };
  }
}

/** Target score for the given set number under the format. */
export function targetForSet(
  settings: Pick<
    MatchFormatSettings,
    "format" | "targetScore" | "tiebreakTargetScore"
  >,
  setNumber: number
): number {
  if (settings.format === "two_with_tiebreak" && setNumber >= 3) {
    return settings.tiebreakTargetScore;
  }
  return settings.targetScore;
}

export type MatchPhase =
  | "upcoming"
  | "warmup"
  | "paused"
  | "in_progress"
  | "completed";

/**
 * Derive the lifecycle phase from a match row. "warmup" and "paused" are not
 * stored statuses: warmup is the window after `warmupStartedAt` is set but
 * before play begins; paused is an in-progress match returned to `upcoming`
 * while keeping scores (`startedAt` set, no active warmup).
 */
export function matchPhase(match: {
  status: string;
  warmupStartedAt: Date | null;
  startedAt?: Date | null;
}): MatchPhase {
  if (match.status === "completed") return "completed";
  if (match.status === "in_progress") return "in_progress";
  if (match.warmupStartedAt) return "warmup";
  if (match.startedAt) return "paused";
  return "upcoming";
}

/**
 * A set is complete once a team reaches the target score with at least a
 * two-point lead (standard volleyball win-by-two, no hard cap).
 */
export function isSetComplete(
  teamAScore: number,
  teamBScore: number,
  target: number
): boolean {
  const top = Math.max(teamAScore, teamBScore);
  return top >= target && Math.abs(teamAScore - teamBScore) >= 2;
}

export interface SetTrackerEntry {
  setNumber: number;
  target: number;
  teamAScore: number;
  teamBScore: number;
  complete: boolean;
  /** True for the set currently being scored. */
  current: boolean;
}

export interface MatchScoreState {
  setsWonA: number;
  setsWonB: number;
  requiredSets: number;
  maxSets: number;
  /** 1-based number of the set currently being scored. */
  currentSetNumber: number;
  currentTarget: number;
  /** Per-set breakdown sized to the format's max sets. */
  tracker: SetTrackerEntry[];
}

/**
 * Build the live scoring/tracker state for a match from its stored sets and the
 * tournament's format settings. Pure + UI-facing; the server still uses
 * `evaluateMatchOutcome` as the source of truth for finalizing.
 */
export function buildMatchScoreState(
  settings: Pick<
    MatchFormatSettings,
    "format" | "targetScore" | "tiebreakTargetScore"
  >,
  storedSets: CompletedSet[]
): MatchScoreState {
  const { required, max } = totalSetsForFormat(settings.format);

  let setsWonA = 0;
  let setsWonB = 0;
  let currentSetNumber = max;
  let foundCurrent = false;

  const tracker: SetTrackerEntry[] = [];
  for (let i = 0; i < max; i++) {
    const setNumber = i + 1;
    const target = targetForSet(settings, setNumber);
    const stored = storedSets[i];
    const teamAScore = stored?.teamAScore ?? 0;
    const teamBScore = stored?.teamBScore ?? 0;
    const complete = stored
      ? isSetComplete(teamAScore, teamBScore, target)
      : false;

    if (complete) {
      if (teamAScore > teamBScore) setsWonA++;
      else if (teamBScore > teamAScore) setsWonB++;
    }

    tracker.push({
      setNumber,
      target,
      teamAScore,
      teamBScore,
      complete,
      current: false,
    });

    if (!foundCurrent && !complete) {
      currentSetNumber = setNumber;
      foundCurrent = true;
    }
  }

  const currentEntry = tracker[currentSetNumber - 1];
  if (currentEntry) currentEntry.current = true;

  return {
    setsWonA,
    setsWonB,
    requiredSets: required,
    maxSets: max,
    currentSetNumber,
    currentTarget: targetForSet(settings, currentSetNumber),
    tracker,
  };
}

/**
 * Resolve the current outcome of a match given the completed set scores. Used
 * after an incremental score save so the server can auto-finalize the match.
 */
export function evaluateMatchOutcome(
  settings: Pick<MatchFormatSettings, "format">,
  teamAId: string,
  teamBId: string,
  completedSets: CompletedSet[]
): MatchOutcome {
  const setsPlayed = completedSets.length;
  let aSetsWon = 0;
  let bSetsWon = 0;
  for (const s of completedSets) {
    if (s.teamAScore > s.teamBScore) aSetsWon++;
    else if (s.teamBScore > s.teamAScore) bSetsWon++;
  }

  const { required, max } = totalSetsForFormat(settings.format);

  if (setsPlayed < required) {
    return {
      status: "in_progress",
      winnerId: null,
      setsPlayed,
      isFinished: false,
      shouldFinalize: false,
    };
  }

  if (settings.format === "two_with_tiebreak") {
    if (aSetsWon === bSetsWon && setsPlayed < max) {
      return {
        status: "in_progress",
        winnerId: null,
        setsPlayed,
        isFinished: false,
        shouldFinalize: false,
      };
    }
  }

  let winnerId: string | null = null;
  if (aSetsWon > bSetsWon) winnerId = teamAId;
  else if (bSetsWon > aSetsWon) winnerId = teamBId;

  return {
    status: "completed",
    winnerId,
    setsPlayed,
    isFinished: true,
    shouldFinalize: true,
  };
}
