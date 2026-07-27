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

import {
  bracketAdvanceTarget,
  isBracketRoundOneByeMatch,
} from "@/lib/utils/bracket";

export interface BracketMatchForRefs {
  id: string;
  bracketSection?: string | null;
  bracketRound: number;
  bracketPosition: number;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  status: string;
  courtId: string | null;
  scheduledTime: Date | string | null;
}

/** Automatic suggestions must never replace the working team during play. */
export function shouldAutoAssignBracketRef(
  match: Pick<BracketMatchForRefs, "status">
): boolean {
  return match.status === "upcoming";
}

/** Previous-round feeder positions for a bracket match. */
export function feederPositions(position: number): {
  feederA: number;
  feederB: number;
} {
  return { feederA: 2 * position - 1, feederB: 2 * position };
}

export function matchLoserId(
  match: Pick<
    BracketMatchForRefs,
    "teamAId" | "teamBId" | "winnerId" | "status"
  >
): string | null {
  if (match.status !== "completed" || !match.winnerId) return null;
  if (match.winnerId === match.teamAId) return match.teamBId;
  if (match.winnerId === match.teamBId) return match.teamAId;
  return null;
}

function matchTimeMs(match: BracketMatchForRefs): number | null {
  if (!match.scheduledTime) return null;
  const t = new Date(match.scheduledTime).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Teams with a round-1 bye (auto-advanced, not playing a real match). */
export function roundOneByeTeamIds(matches: BracketMatchForRefs[]): Set<string> {
  const ids = new Set<string>();
  for (const m of matches) {
    if (m.bracketRound !== 1 || !isBracketRoundOneByeMatch(m)) continue;
    if (m.teamAId) ids.add(m.teamAId);
    if (m.teamBId) ids.add(m.teamBId);
  }
  return ids;
}

/**
 * Teams from a later round-1 match on the same court that can ref an earlier
 * match on that court.
 */
export function sameCourtLaterRefCandidates(
  target: BracketMatchForRefs,
  roundOnePlayable: BracketMatchForRefs[]
): string[] {
  if (!target.courtId) return [];

  const onCourt = roundOnePlayable
    .filter((m) => m.courtId === target.courtId)
    .sort((a, b) => {
      const ta = matchTimeMs(a) ?? Number.POSITIVE_INFINITY;
      const tb = matchTimeMs(b) ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return a.bracketPosition - b.bracketPosition;
    });

  const targetIndex = onCourt.findIndex((m) => m.id === target.id);
  if (targetIndex < 0) return [];

  const candidates: string[] = [];
  for (let i = targetIndex + 1; i < onCourt.length; i++) {
    const m = onCourt[i];
    if (m.teamAId) candidates.push(m.teamAId);
    if (m.teamBId) candidates.push(m.teamBId);
  }
  return candidates;
}

export function eligibleBracketRefIds(
  match: BracketMatchForRefs,
  allMatches: BracketMatchForRefs[]
): string[] {
  if (match.status === "completed") return [];
  if (isBracketRoundOneByeMatch(match)) return [];
  if (!match.teamAId || !match.teamBId) return [];

  const playing = new Set([match.teamAId, match.teamBId]);
  if (match.bracketSection && match.bracketSection !== "main") {
    return eligibleDoubleEliminationRefIds(match, allMatches, playing);
  }

  const sameSection = allMatches.filter(
    (candidate) =>
      (candidate.bracketSection ?? "main") ===
      (match.bracketSection ?? "main")
  );
  const roundOne = sameSection.filter((m) => m.bracketRound === 1);
  const roundOnePlayable = roundOne.filter(
    (m) => m.teamAId && m.teamBId && !isBracketRoundOneByeMatch(m)
  );

  if (match.bracketRound === 1) {
    const candidates = new Set<string>();
    for (const id of roundOneByeTeamIds(roundOne)) {
      if (!playing.has(id)) candidates.add(id);
    }
    for (const id of sameCourtLaterRefCandidates(match, roundOnePlayable)) {
      if (!playing.has(id)) candidates.add(id);
    }
    return [...candidates];
  }

  const prevRound = match.bracketRound - 1;
  const { feederA, feederB } = feederPositions(match.bracketPosition);
  const feeders = sameSection.filter((m) => m.bracketRound === prevRound);
  const feederMatchA = feeders.find((m) => m.bracketPosition === feederA);
  const feederMatchB = feeders.find((m) => m.bracketPosition === feederB);

  const candidates: string[] = [];
  for (const feeder of [feederMatchA, feederMatchB]) {
    if (!feeder) continue;
    const loser = matchLoserId(feeder);
    if (loser && !playing.has(loser)) candidates.push(loser);
  }
  return candidates;
}

function eligibleDoubleEliminationRefIds(
  match: BracketMatchForRefs,
  allMatches: BracketMatchForRefs[],
  playing: Set<string>
): string[] {
  const lossCounts = new Map<string, number>();
  for (const candidate of allMatches) {
    const loserId = matchLoserId(candidate);
    if (!loserId) continue;
    lossCounts.set(loserId, (lossCounts.get(loserId) ?? 0) + 1);
  }

  const stillPlaying = new Set<string>();
  for (const candidate of allMatches) {
    if (candidate.id === match.id || candidate.status === "completed") continue;
    if (candidate.teamAId) stillPlaying.add(candidate.teamAId);
    if (candidate.teamBId) stillPlaying.add(candidate.teamBId);
  }

  return [...lossCounts]
    .filter(
      ([teamId, losses]) =>
        losses >= 2 &&
        !playing.has(teamId) &&
        !stillPlaying.has(teamId)
    )
    .map(([teamId]) => teamId)
    .sort();
}

function pickRef(
  candidates: string[],
  refCounts: Map<string, number>
): string | null {
  if (candidates.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const id of candidates) {
    min = Math.min(min, refCounts.get(id) ?? 0);
  }
  const tied = candidates.filter((id) => (refCounts.get(id) ?? 0) === min);
  tied.sort();
  const chosen = tied[0];
  refCounts.set(chosen, (refCounts.get(chosen) ?? 0) + 1);
  return chosen;
}

/**
 * Assign working refs for an entire single-elimination bracket.
 * Round 1: bye teams or teams from a later match on the same court.
 * Round 2+: losers from feeder matches in the previous round.
 */
export function assignBracketMatchRefs(
  matches: BracketMatchForRefs[]
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const refCounts = new Map<string, number>();

  const sorted = [...matches].sort((a, b) => {
    const sectionComparison = (a.bracketSection ?? "main").localeCompare(
      b.bracketSection ?? "main"
    );
    if (sectionComparison !== 0) return sectionComparison;
    if (a.bracketRound !== b.bracketRound) {
      return a.bracketRound - b.bracketRound;
    }
    return a.bracketPosition - b.bracketPosition;
  });

  for (const match of sorted) {
    if (match.status === "completed" || isBracketRoundOneByeMatch(match)) {
      result.set(match.id, null);
      continue;
    }
    if (!match.teamAId || !match.teamBId) {
      result.set(match.id, null);
      continue;
    }

    const candidates = eligibleBracketRefIds(match, matches);
    result.set(match.id, pickRef(candidates, refCounts));
  }

  return result;
}

/** Feeder match positions that supply teams to a given match. */
export function feederMatchPositions(
  round: number,
  position: number
): Array<{ round: number; position: number }> {
  if (round <= 1) return [];
  const prev = round - 1;
  const { feederA, feederB } = feederPositions(position);
  return [
    { round: prev, position: feederA },
    { round: prev, position: feederB },
  ];
}

export function nextRoundMatchPosition(
  round: number,
  position: number
): { round: number; position: number } {
  const feed = bracketAdvanceTarget(round, position);
  return { round: feed.round, position: feed.position };
}
