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

import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions,
  matches,
  poolTeams,
  pools,
  teams,
  tournaments,
} from "@/lib/db/schema";
import { assignRefsToMatchups, generatePoolMatches } from "@/lib/utils/pool";
import {
  getTakenMatchSlugsInTournament,
} from "@/lib/tournaments/match-query";
import {
  matchupSlugFromTeamSlugs,
  reserveMatchSlug,
} from "@/lib/tournaments/match-slug";

type DbClient = typeof db;

/**
 * Rebuild round-robin pool matches from the current seed order. Only allowed
 * when every existing pool match is still upcoming.
 */
export async function regeneratePoolMatchesFromSeedsInTransaction(
  poolId: string,
  client: DbClient
): Promise<{ error?: string; matchCount?: number }> {
  const [identity] = await client
    .select({ tournamentId: divisions.tournamentId })
    .from(pools)
    .innerJoin(divisions, eq(pools.divisionId, divisions.id))
    .where(eq(pools.id, poolId))
    .limit(1);
  if (!identity) return { error: "Pool not found" };
  await client.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${identity.tournamentId}
    FOR UPDATE
  `);
  const [lockedIdentity] = await client
    .select({ tournamentId: divisions.tournamentId })
    .from(pools)
    .innerJoin(divisions, eq(pools.divisionId, divisions.id))
    .where(eq(pools.id, poolId))
    .limit(1);
  if (
    !lockedIdentity ||
    lockedIdentity.tournamentId !== identity.tournamentId
  ) {
    return { error: "Pool changed while seeding was being updated" };
  }

  const members = await client
    .select({ teamId: poolTeams.teamId, seed: poolTeams.seed })
    .from(poolTeams)
    .where(eq(poolTeams.poolId, poolId))
    .orderBy(asc(poolTeams.seed), asc(poolTeams.teamId));

  if (members.length < 2) {
    return { error: "Need at least 2 teams to create pool matches" };
  }

  const existing = await client
    .select({ id: matches.id, status: matches.status })
    .from(matches)
    .where(eq(matches.poolId, poolId));

  const blocked = existing.some((m) => m.status !== "upcoming");
  if (blocked) {
    return {
      error:
        "Pool matches have already started. Seeding cannot be changed.",
    };
  }

  if (existing.length > 0) {
    await client.delete(matches).where(eq(matches.poolId, poolId));
  }

  const teamIds = members.map((m) => m.teamId);
  const teamSlugRows =
    teamIds.length > 0
      ? await client
          .select({ id: teams.id, slug: teams.slug })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [];
  const slugByTeamId = new Map(teamSlugRows.map((t) => [t.id, t.slug]));

  const taken = await getTakenMatchSlugsInTournament(
    identity.tournamentId,
    [],
    client
  );

  const matchups = assignRefsToMatchups(teamIds, generatePoolMatches(teamIds));

  for (const matchup of matchups) {
    const teamASlug = slugByTeamId.get(matchup.teamAId);
    const teamBSlug = slugByTeamId.get(matchup.teamBId);
    const base =
      teamASlug && teamBSlug
        ? matchupSlugFromTeamSlugs(teamASlug, teamBSlug)
        : "match";
    const slug = reserveMatchSlug(base, taken);

    await client.insert(matches).values({
      tournamentId: identity.tournamentId,
      slug,
      poolId,
      teamAId: matchup.teamAId,
      teamBId: matchup.teamBId,
      refTeamId: matchup.refTeamId,
      status: "upcoming",
    });
  }

  return { matchCount: matchups.length };
}

export async function regeneratePoolMatchesFromSeeds(
  poolId: string
): Promise<{ error?: string; matchCount?: number }> {
  return db.transaction((tx) =>
    regeneratePoolMatchesFromSeedsInTransaction(
      poolId,
      tx as unknown as DbClient
    )
  );
}

/** True when every pool match is completed (or there are none). */
export async function isPoolPlayComplete(
  poolId: string,
  client: DbClient = db
): Promise<boolean> {
  const rows = await client
    .select({ status: matches.status })
    .from(matches)
    .where(eq(matches.poolId, poolId));

  if (rows.length === 0) return false;
  return rows.every((m) => m.status === "completed");
}

/** Whether any pool match has left the upcoming state. */
export async function poolMatchesHaveStarted(
  poolId: string,
  client: DbClient = db
): Promise<boolean> {
  const rows = await client
    .select({ status: matches.status })
    .from(matches)
    .where(eq(matches.poolId, poolId));

  return rows.some((m) => m.status !== "upcoming");
}
