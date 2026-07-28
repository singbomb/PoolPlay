/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brackets,
  courts,
  divisions,
  matches,
  poolTeams,
  pools,
  schools,
  sets,
  teams,
  tournaments,
} from "@/lib/db/schema";
import type { PublicTournamentProjectionSource } from "./public-projection";

type PublicReadTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
type PublicTournamentRow = PublicTournamentProjectionSource["tournament"];

const publicTournamentColumns = {
  id: tournaments.id,
  hostSchoolId: tournaments.hostSchoolId,
  slug: tournaments.slug,
  name: tournaments.name,
  description: tournaments.description,
  date: tournaments.date,
  location: tournaments.location,
  address: tournaments.address,
  status: tournaments.status,
  gender: tournaments.gender,
  region: tournaments.region,
  matchFormat: tournaments.matchFormat,
  setTargetScore: tournaments.setTargetScore,
  tiebreakTargetScore: tournaments.tiebreakTargetScore,
  poolTiebreakCriteria: tournaments.poolTiebreakCriteria,
};

export async function loadPublishedTournament(
  tx: PublicReadTransaction,
  slug: string
): Promise<PublicTournamentRow | null> {
  const [row] = await tx
    .select(publicTournamentColumns)
    .from(tournaments)
    .where(and(eq(tournaments.slug, slug), ne(tournaments.status, "draft")))
    .limit(1);
  return row ?? null;
}

async function loadHostSchool(
  tx: PublicReadTransaction,
  schoolId: string | null
): Promise<PublicTournamentProjectionSource["hostSchool"]> {
  if (!schoolId) return null;
  const [row] = await tx
    .select({
      name: schools.name,
      slug: schools.slug,
      verificationStatus: schools.verificationStatus,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row ?? null;
}

async function loadReleasedDivisions(
  tx: PublicReadTransaction,
  tournamentId: string
): Promise<PublicTournamentProjectionSource["divisions"]> {
  return tx
    .select({
      id: divisions.id,
      name: divisions.name,
      format: divisions.format,
      poolsReleasedAt: divisions.poolsReleasedAt,
    })
    .from(divisions)
    .where(
      and(
        eq(divisions.tournamentId, tournamentId),
        isNotNull(divisions.poolsReleasedAt)
      )
    )
    .orderBy(asc(divisions.createdAt), asc(divisions.id));
}

async function loadPools(
  tx: PublicReadTransaction,
  divisionIds: string[]
): Promise<PublicTournamentProjectionSource["pools"]> {
  if (divisionIds.length === 0) return [];
  return tx
    .select({ id: pools.id, divisionId: pools.divisionId, name: pools.name })
    .from(pools)
    .where(inArray(pools.divisionId, divisionIds))
    .orderBy(asc(pools.createdAt), asc(pools.id));
}

async function loadBrackets(
  tx: PublicReadTransaction,
  divisionIds: string[]
): Promise<PublicTournamentProjectionSource["brackets"]> {
  if (divisionIds.length === 0) return [];
  return tx
    .select({
      id: brackets.id,
      divisionId: brackets.divisionId,
      bracketType: brackets.bracketType,
      seedCount: brackets.seedCount,
      name: brackets.name,
      tier: brackets.tier,
    })
    .from(brackets)
    .where(inArray(brackets.divisionId, divisionIds))
    .orderBy(asc(brackets.tier), asc(brackets.createdAt), asc(brackets.id));
}

async function loadPoolTeams(
  tx: PublicReadTransaction,
  poolIds: string[]
): Promise<PublicTournamentProjectionSource["poolTeams"]> {
  if (poolIds.length === 0) return [];
  return tx
    .select({
      poolId: poolTeams.poolId,
      teamId: poolTeams.teamId,
      seed: poolTeams.seed,
    })
    .from(poolTeams)
    .where(inArray(poolTeams.poolId, poolIds))
    .orderBy(asc(poolTeams.seed), asc(poolTeams.id));
}

function matchParentFilter(
  poolIds: string[],
  bracketIds: string[]
): SQL | null {
  if (poolIds.length > 0 && bracketIds.length > 0) {
    return or(
      inArray(matches.poolId, poolIds),
      inArray(matches.bracketId, bracketIds)
    )!;
  }
  if (poolIds.length > 0) return inArray(matches.poolId, poolIds);
  if (bracketIds.length > 0) return inArray(matches.bracketId, bracketIds);
  return null;
}

async function loadMatches(
  tx: PublicReadTransaction,
  tournamentId: string,
  poolIds: string[],
  bracketIds: string[]
): Promise<PublicTournamentProjectionSource["matches"]> {
  const parentFilter = matchParentFilter(poolIds, bracketIds);
  if (!parentFilter) return [];
  return tx
    .select({
      id: matches.id,
      slug: matches.slug,
      poolId: matches.poolId,
      bracketId: matches.bracketId,
      courtId: matches.courtId,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      status: matches.status,
      scheduledTime: matches.scheduledTime,
      bracketSection: matches.bracketSection,
      bracketActivation: matches.bracketActivation,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
    })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), parentFilter))
    .orderBy(
      asc(matches.scheduledTime),
      asc(matches.bracketRound),
      asc(matches.bracketPosition),
      asc(matches.id)
    );
}

function relatedIds(
  poolTeamRows: PublicTournamentProjectionSource["poolTeams"],
  matchRows: PublicTournamentProjectionSource["matches"]
): { teamIds: string[]; courtIds: string[]; matchIds: string[] } {
  const teamIds = [
    ...new Set(
      [
        ...poolTeamRows.map((row) => row.teamId),
        ...matchRows.flatMap((match) => [
          match.teamAId,
          match.teamBId,
          match.winnerId,
        ]),
      ].filter((value): value is string => value != null)
    ),
  ];
  const courtIds = [
    ...new Set(
      matchRows
        .map((match) => match.courtId)
        .filter((value): value is string => value != null)
    ),
  ];
  return { teamIds, courtIds, matchIds: matchRows.map((match) => match.id) };
}

async function loadTeams(
  tx: PublicReadTransaction,
  ids: string[]
): Promise<PublicTournamentProjectionSource["teams"]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: teams.id, name: teams.name, university: teams.university })
    .from(teams)
    .where(inArray(teams.id, ids));
}

async function loadCourts(
  tx: PublicReadTransaction,
  tournamentId: string,
  ids: string[]
): Promise<PublicTournamentProjectionSource["courts"]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(
      and(eq(courts.tournamentId, tournamentId), inArray(courts.id, ids))
    );
}

async function loadSets(
  tx: PublicReadTransaction,
  matchIds: string[]
): Promise<PublicTournamentProjectionSource["sets"]> {
  if (matchIds.length === 0) return [];
  return tx
    .select({
      matchId: sets.matchId,
      setNumber: sets.setNumber,
      teamAScore: sets.teamAScore,
      teamBScore: sets.teamBScore,
    })
    .from(sets)
    .where(inArray(sets.matchId, matchIds))
    .orderBy(asc(sets.matchId), asc(sets.setNumber));
}

export async function loadPublicProjectionSource(
  tx: PublicReadTransaction,
  tournament: PublicTournamentRow
): Promise<PublicTournamentProjectionSource> {
  const [hostSchool, divisionRows] = await Promise.all([
    loadHostSchool(tx, tournament.hostSchoolId),
    loadReleasedDivisions(tx, tournament.id),
  ]);
  const divisionIds = divisionRows.map((division) => division.id);
  const [poolRows, bracketRows] = await Promise.all([
    loadPools(tx, divisionIds),
    loadBrackets(tx, divisionIds),
  ]);
  const poolIds = poolRows.map((pool) => pool.id);
  const bracketIds = bracketRows.map((bracket) => bracket.id);
  const [poolTeamRows, matchRows] = await Promise.all([
    loadPoolTeams(tx, poolIds),
    loadMatches(tx, tournament.id, poolIds, bracketIds),
  ]);
  const ids = relatedIds(poolTeamRows, matchRows);
  const [teamRows, courtRows, setRows] = await Promise.all([
    loadTeams(tx, ids.teamIds),
    loadCourts(tx, tournament.id, ids.courtIds),
    loadSets(tx, ids.matchIds),
  ]);
  return {
    tournament,
    hostSchool,
    divisions: divisionRows,
    pools: poolRows,
    poolTeams: poolTeamRows,
    brackets: bracketRows,
    matches: matchRows,
    teams: teamRows,
    courts: courtRows,
    sets: setRows,
  };
}
