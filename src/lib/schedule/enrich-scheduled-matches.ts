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

import { db } from "@/lib/db";
import {
  brackets,
  courts,
  divisions,
  matches,
  pools,
  teams,
  tournaments,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  warmupMinutesForFormat,
  type WarmupFormat,
} from "@/lib/labels/warmup-format";
import {
  formatBracketRoundLabel,
  type BracketSection,
} from "@/lib/tournaments/bracket-labels";
import { isActiveMatch } from "@/lib/tournaments/match-visibility";

export type ScheduledMatchRow = typeof matches.$inferSelect;

export type EnrichedScheduledMatch = ScheduledMatchRow & {
  teamAName: string;
  teamBName: string;
  courtName: string;
  refTeamName: string | null;
  contextLabel: string;
  warmupStart: Date | null;
};

/** Batch-load related rows for scheduled matches (avoids per-match N+1 queries). */
export async function enrichScheduledMatches(
  scheduledMatches: ScheduledMatchRow[]
): Promise<EnrichedScheduledMatch[]> {
  const activeMatches = scheduledMatches.filter(isActiveMatch);
  if (activeMatches.length === 0) return [];

  const teamIds = new Set<string>();
  const courtIds = new Set<string>();
  const poolIds = new Set<string>();
  const bracketIds = new Set<string>();

  for (const match of activeMatches) {
    if (match.teamAId) teamIds.add(match.teamAId);
    if (match.teamBId) teamIds.add(match.teamBId);
    if (match.refTeamId) teamIds.add(match.refTeamId);
    if (match.courtId) courtIds.add(match.courtId);
    if (match.poolId) poolIds.add(match.poolId);
    if (match.bracketId) bracketIds.add(match.bracketId);
  }

  const [teamRows, courtRows, poolRows, bracketRows] = await Promise.all([
    teamIds.size > 0
      ? db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, [...teamIds]))
      : Promise.resolve([]),
    courtIds.size > 0
      ? db
          .select({ id: courts.id, name: courts.name })
          .from(courts)
          .where(inArray(courts.id, [...courtIds]))
      : Promise.resolve([]),
    poolIds.size > 0
      ? db
          .select({
            id: pools.id,
            name: pools.name,
            warmupFormat: tournaments.warmupFormat,
          })
          .from(pools)
          .innerJoin(divisions, eq(pools.divisionId, divisions.id))
          .innerJoin(tournaments, eq(divisions.tournamentId, tournaments.id))
          .where(inArray(pools.id, [...poolIds]))
      : Promise.resolve([]),
    bracketIds.size > 0
      ? db
          .select({
            id: brackets.id,
            warmupFormat: tournaments.warmupFormat,
          })
          .from(brackets)
          .innerJoin(divisions, eq(brackets.divisionId, divisions.id))
          .innerJoin(tournaments, eq(divisions.tournamentId, tournaments.id))
          .where(inArray(brackets.id, [...bracketIds]))
      : Promise.resolve([]),
  ]);

  const teamNameById = new Map(teamRows.map((row) => [row.id, row.name]));
  const courtNameById = new Map(courtRows.map((row) => [row.id, row.name]));
  const poolById = new Map(poolRows.map((row) => [row.id, row]));
  const bracketWarmupById = new Map(
    bracketRows.map((row) => [row.id, row.warmupFormat])
  );

  return activeMatches.map((match) => {
    let contextLabel = "";
    let warmupFormat: WarmupFormat = "none";

    if (match.poolId) {
      const pool = poolById.get(match.poolId);
      contextLabel = pool?.name ?? "Pool";
      warmupFormat = pool?.warmupFormat ?? "none";
    } else if (match.bracketId) {
      warmupFormat = bracketWarmupById.get(match.bracketId) ?? "none";
      if (match.bracketRound) {
        contextLabel = formatBracketRoundLabel({
          section: (match.bracketSection ?? "main") as BracketSection,
          round: match.bracketRound,
        });
      }
    }

    const warmupMinutes = warmupMinutesForFormat(warmupFormat);
    const warmupStart =
      match.scheduledTime && warmupMinutes > 0
        ? new Date(match.scheduledTime.getTime() - warmupMinutes * 60 * 1000)
        : null;

    return {
      ...match,
      teamAName: (match.teamAId && teamNameById.get(match.teamAId)) || "TBD",
      teamBName: (match.teamBId && teamNameById.get(match.teamBId)) || "TBD",
      courtName:
        (match.courtId && courtNameById.get(match.courtId)) || "Unassigned",
      refTeamName:
        (match.refTeamId && teamNameById.get(match.refTeamId)) ?? null,
      contextLabel,
      warmupStart,
    };
  });
}
