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

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brackets,
  courts,
  divisions,
  matches,
  poolTeams,
  pools,
  registrations,
  sets,
  teams,
} from "@/lib/db/schema";

/** Shape used by the Pools and Bracket tabs to render a division's play data. */
export type DivisionPlayData = {
  id: string;
  name: string;
  format: string;
  poolsReleasedAt: Date | null;
  pools: {
    id: string;
    name: string;
    teams: {
      id: string;
      name: string;
      university: string;
      seed: number | null;
    }[];
    matches: {
      id: string;
      slug: string;
      teamAId: string | null;
      teamBId: string | null;
      refTeamId: string | null;
      winnerId: string | null;
      status: string;
      scheduledTime: Date | null;
      teamA: { id: string; name: string } | null;
      teamB: { id: string; name: string } | null;
      ref: { id: string; name: string } | null;
      sets: { teamAScore: number; teamBScore: number }[];
    }[];
    matchCount: number;
  }[];
  brackets: {
    id: string;
    bracketType: string;
    seedCount: number;
    name: string | null;
    tier: number;
    topologyVersion: number;
    matches: {
      id: string;
      slug: string;
      teamAId: string | null;
      teamBId: string | null;
      teamAName: string | null;
      teamBName: string | null;
      bracketSection: "main" | "winners" | "losers" | "grand_final";
      bracketActivation: "required" | "conditional" | "not_required";
      bracketRound: number | null;
      bracketPosition: number | null;
      refTeamId: string | null;
      courtId: string | null;
      winnerId: string | null;
      status: string;
      scheduledTime: Date | null;
      teamA: { id: string; name: string } | null;
      teamB: { id: string; name: string } | null;
      ref: { id: string; name: string } | null;
      courtName: string | null;
      sets: { teamAScore: number; teamBScore: number }[];
    }[];
  }[];
  /** All confirmed registrations for the division, used for context. */
  eligibleTeams: { id: string; name: string; university: string }[];
};

/**
 * Resolves all the per-division data needed to render the Pools and Bracket
 * tabs. When `forOrganizer` is false, unreleased divisions return no pool or
 * bracket details so participants cannot see them early.
 */
export async function getDivisionPlayData(
  tournamentId: string,
  options?: { forOrganizer?: boolean }
): Promise<DivisionPlayData[]> {
  const forOrganizer = options?.forOrganizer ?? false;

  const tournamentDivisions = await db
    .select()
    .from(divisions)
    .where(eq(divisions.tournamentId, tournamentId))
    .orderBy(asc(divisions.name), asc(divisions.id));

  if (tournamentDivisions.length === 0) return [];

  // Only divisions whose play data is visible to this viewer need their pools,
  // brackets, and eligible teams fetched. Participants can't see unreleased
  // divisions, so we skip that work entirely.
  const visibleDivIds = tournamentDivisions
    .filter((d) => forOrganizer || d.poolsReleasedAt != null)
    .map((d) => d.id);

  // Bulk queries grouped into dependency "waves": each wave runs its
  // independent queries in parallel (postgres.js fans them across the pool),
  // and successive waves depend on ids produced by the previous one. This
  // replaces the per-division → per-pool → per-match → per-set N+1 waterfall.
  const [eligibleRows, poolRows, bracketRows] = await Promise.all([
    visibleDivIds.length
      ? db
          .select({
            divisionId: registrations.divisionId,
            id: teams.id,
            name: teams.name,
            university: teams.university,
          })
          .from(registrations)
          .innerJoin(teams, eq(registrations.teamId, teams.id))
          .where(
            and(
              eq(registrations.tournamentId, tournamentId),
              inArray(registrations.divisionId, visibleDivIds),
              eq(registrations.status, "confirmed")
            )
          )
          .orderBy(asc(registrations.registeredAt), asc(teams.name))
      : Promise.resolve([]),
    visibleDivIds.length
      ? db
          .select()
          .from(pools)
          .where(inArray(pools.divisionId, visibleDivIds))
          .orderBy(asc(pools.createdAt), asc(pools.id))
      : Promise.resolve([]),
    visibleDivIds.length
      ? db
          .select()
          .from(brackets)
          .where(inArray(brackets.divisionId, visibleDivIds))
          .orderBy(asc(brackets.tier), asc(brackets.createdAt), asc(brackets.id))
      : Promise.resolve([]),
  ]);

  const poolIds = poolRows.map((p) => p.id);
  const bracketIds = bracketRows.map((b) => b.id);

  const [poolTeamRows, poolMatchRows, bracketMatchRows] = await Promise.all([
    poolIds.length
      ? db
          .select({
            poolId: poolTeams.poolId,
            id: teams.id,
            name: teams.name,
            university: teams.university,
            seed: poolTeams.seed,
          })
          .from(poolTeams)
          .innerJoin(teams, eq(poolTeams.teamId, teams.id))
          .where(inArray(poolTeams.poolId, poolIds))
          .orderBy(asc(poolTeams.seed), asc(teams.name))
      : Promise.resolve([]),
    poolIds.length
      ? db
          .select()
          .from(matches)
          .where(inArray(matches.poolId, poolIds))
          .orderBy(asc(matches.createdAt), asc(matches.id))
      : Promise.resolve([]),
    bracketIds.length
      ? db
          .select()
          .from(matches)
          .where(inArray(matches.bracketId, bracketIds))
          .orderBy(asc(matches.bracketRound), asc(matches.bracketPosition))
      : Promise.resolve([]),
  ]);

  const poolMatchIds = poolMatchRows.map((m) => m.id);
  const bracketMatchIds = bracketMatchRows.map((m) => m.id);
  // Sets back both the pool and bracket match cards on the Matches board.
  const setMatchIds = [...poolMatchIds, ...bracketMatchIds];
  const bracketTeamIds = [
    ...new Set(
      bracketMatchRows
        .flatMap((m) => [m.teamAId, m.teamBId, m.refTeamId])
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const bracketCourtIds = [
    ...new Set(
      bracketMatchRows
        .map((m) => m.courtId)
        .filter((v): v is string => Boolean(v))
    ),
  ];

  const [setRows, bracketTeamRows, bracketCourtRows] = await Promise.all([
    setMatchIds.length
      ? db
          .select()
          .from(sets)
          .where(inArray(sets.matchId, setMatchIds))
          .orderBy(asc(sets.setNumber))
      : Promise.resolve([]),
    bracketTeamIds.length
      ? db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, bracketTeamIds))
      : Promise.resolve([]),
    bracketCourtIds.length
      ? db
          .select({ id: courts.id, name: courts.name })
          .from(courts)
          .where(inArray(courts.id, bracketCourtIds))
      : Promise.resolve([]),
  ]);

  // Group the bulk rows by their parent id. Insertion order is preserved from
  // the ordered queries above, so grouped arrays keep the original ordering.
  type PoolTeam = DivisionPlayData["pools"][number]["teams"][number];
  const eligibleByDiv = new Map<string, DivisionPlayData["eligibleTeams"]>();
  for (const r of eligibleRows) {
    if (!r.divisionId) continue;
    const list = eligibleByDiv.get(r.divisionId) ?? [];
    list.push({ id: r.id, name: r.name, university: r.university });
    eligibleByDiv.set(r.divisionId, list);
  }

  const poolsByDiv = new Map<string, typeof poolRows>();
  for (const p of poolRows) {
    const list = poolsByDiv.get(p.divisionId) ?? [];
    list.push(p);
    poolsByDiv.set(p.divisionId, list);
  }

  const teamsByPool = new Map<string, PoolTeam[]>();
  for (const r of poolTeamRows) {
    const list = teamsByPool.get(r.poolId) ?? [];
    list.push({ id: r.id, name: r.name, university: r.university, seed: r.seed });
    teamsByPool.set(r.poolId, list);
  }

  const matchesByPool = new Map<string, typeof poolMatchRows>();
  for (const m of poolMatchRows) {
    if (!m.poolId) continue;
    const list = matchesByPool.get(m.poolId) ?? [];
    list.push(m);
    matchesByPool.set(m.poolId, list);
  }

  const setsByMatch = new Map<string, { teamAScore: number; teamBScore: number }[]>();
  for (const s of setRows) {
    const list = setsByMatch.get(s.matchId) ?? [];
    list.push({ teamAScore: s.teamAScore, teamBScore: s.teamBScore });
    setsByMatch.set(s.matchId, list);
  }

  const bracketsByDiv = new Map<string, typeof bracketRows>();
  for (const b of bracketRows) {
    const list = bracketsByDiv.get(b.divisionId) ?? [];
    list.push(b);
    bracketsByDiv.set(b.divisionId, list);
  }

  const matchesByBracket = new Map<string, typeof bracketMatchRows>();
  for (const m of bracketMatchRows) {
    if (!m.bracketId) continue;
    const list = matchesByBracket.get(m.bracketId) ?? [];
    list.push(m);
    matchesByBracket.set(m.bracketId, list);
  }

  const bracketTeamName = new Map<string, string>();
  for (const t of bracketTeamRows) bracketTeamName.set(t.id, t.name);
  const bracketCourtName = new Map<string, string>();
  for (const c of bracketCourtRows) bracketCourtName.set(c.id, c.name);

  const rows: DivisionPlayData[] = [];
  for (const div of tournamentDivisions) {
    const canShowPlay = forOrganizer || div.poolsReleasedAt != null;
    if (!canShowPlay) {
      rows.push({
        id: div.id,
        name: div.name,
        format: div.format,
        poolsReleasedAt: div.poolsReleasedAt,
        pools: [],
        brackets: [],
        eligibleTeams: [],
      });
      continue;
    }

    const poolData: DivisionPlayData["pools"] = (
      poolsByDiv.get(div.id) ?? []
    ).map((pool) => {
      const pTeams = teamsByPool.get(pool.id) ?? [];
      const poolMatches = matchesByPool.get(pool.id) ?? [];
      const matchData = poolMatches.map((m) => {
        const teamA = m.teamAId
          ? (pTeams.find((t) => t.id === m.teamAId) ?? null)
          : null;
        const teamB = m.teamBId
          ? (pTeams.find((t) => t.id === m.teamBId) ?? null)
          : null;
        const refTeam = m.refTeamId
          ? (pTeams.find((t) => t.id === m.refTeamId) ?? null)
          : null;
        return {
          id: m.id,
          slug: m.slug,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          refTeamId: m.refTeamId,
          winnerId: m.winnerId,
          status: m.status,
          scheduledTime: m.scheduledTime,
          sets: setsByMatch.get(m.id) ?? [],
          teamA: teamA ? { id: teamA.id, name: teamA.name } : null,
          teamB: teamB ? { id: teamB.id, name: teamB.name } : null,
          ref: refTeam ? { id: refTeam.id, name: refTeam.name } : null,
        };
      });
      return {
        id: pool.id,
        name: pool.name,
        teams: pTeams,
        matches: matchData,
        matchCount: poolMatches.length,
      };
    });

    const bracketData: DivisionPlayData["brackets"] = (
      bracketsByDiv.get(div.id) ?? []
    ).map((bracket) => ({
      id: bracket.id,
      bracketType: bracket.bracketType,
      seedCount: bracket.seedCount,
      name: bracket.name,
      tier: bracket.tier,
      topologyVersion: bracket.topologyVersion,
      matches: (matchesByBracket.get(bracket.id) ?? []).map((m) => ({
        id: m.id,
        slug: m.slug,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        teamAName: m.teamAId ? (bracketTeamName.get(m.teamAId) ?? null) : null,
        teamBName: m.teamBId ? (bracketTeamName.get(m.teamBId) ?? null) : null,
        // The migration backfills every persisted bracket match. These
        // fallbacks keep organizer pages readable during a rolling deploy.
        bracketSection: m.bracketSection ?? "main",
        bracketActivation: m.bracketActivation ?? "required",
        bracketRound: m.bracketRound,
        bracketPosition: m.bracketPosition,
        refTeamId: m.refTeamId,
        courtId: m.courtId,
        winnerId: m.winnerId,
        status: m.status,
        scheduledTime: m.scheduledTime,
        teamA: m.teamAId
          ? { id: m.teamAId, name: bracketTeamName.get(m.teamAId) ?? "Team" }
          : null,
        teamB: m.teamBId
          ? { id: m.teamBId, name: bracketTeamName.get(m.teamBId) ?? "Team" }
          : null,
        ref: m.refTeamId
          ? { id: m.refTeamId, name: bracketTeamName.get(m.refTeamId) ?? "Team" }
          : null,
        courtName: m.courtId
          ? (bracketCourtName.get(m.courtId) ?? null)
          : null,
        sets: setsByMatch.get(m.id) ?? [],
      })),
    }));

    rows.push({
      id: div.id,
      name: div.name,
      format: div.format,
      poolsReleasedAt: div.poolsReleasedAt,
      pools: poolData,
      brackets: bracketData,
      eligibleTeams: eligibleByDiv.get(div.id) ?? [],
    });
  }

  return rows;
}
