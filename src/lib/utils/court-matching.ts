/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * Find a maximum match-to-court assignment without sacrificing an earlier
 * priority match. Augmenting paths move earlier matches to alternate courts
 * when that makes room for another match.
 */
export function maximumCourtMatching(
  matchIdsInPriorityOrder: string[],
  courtIdsForMatch: (matchId: string) => readonly string[],
  courtIsAvailable: (courtId: string) => boolean
): Map<string, string> {
  const matchByCourt = new Map<string, string>();
  const courtByMatch = new Map<string, string>();

  function tryAssign(matchId: string, visitedCourts: Set<string>): boolean {
    for (const courtId of courtIdsForMatch(matchId)) {
      if (visitedCourts.has(courtId) || !courtIsAvailable(courtId)) continue;
      visitedCourts.add(courtId);
      const occupant = matchByCourt.get(courtId);
      if (occupant && !tryAssign(occupant, visitedCourts)) continue;

      matchByCourt.set(courtId, matchId);
      courtByMatch.set(matchId, courtId);
      return true;
    }
    return false;
  }

  for (const matchId of matchIdsInPriorityOrder) {
    tryAssign(matchId, new Set<string>());
  }
  return courtByMatch;
}
