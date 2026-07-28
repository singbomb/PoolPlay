/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { eq, inArray, or } from "drizzle-orm";
import { updateTag } from "next/cache";
import { db } from "@/lib/db";
import {
  divisions,
  matches,
  pools,
  poolTeams,
  tournaments,
} from "@/lib/db/schema";
import {
  PUBLIC_TOURNAMENTS_CACHE_TAG,
  publicTournamentCacheTag,
} from "./public-cache";

interface PublicCacheInvalidationOptions {
  listing?: boolean;
}

export function invalidatePublicTournamentCaches(
  slugs: Iterable<string>,
  { listing = false }: PublicCacheInvalidationOptions = {}
): void {
  const uniqueSlugs = [...new Set(slugs)].filter(Boolean);
  if (listing) updateTag(PUBLIC_TOURNAMENTS_CACHE_TAG);
  for (const slug of uniqueSlugs) {
    updateTag(publicTournamentCacheTag(slug));
  }
}

export async function invalidatePublicTournamentCachesByIds(
  tournamentIds: Iterable<string>,
  options?: PublicCacheInvalidationOptions
): Promise<void> {
  const uniqueIds = [...new Set(tournamentIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;
  const rows = await db
    .select({ slug: tournaments.slug })
    .from(tournaments)
    .where(inArray(tournaments.id, uniqueIds));
  invalidatePublicTournamentCaches(
    rows.map((row) => row.slug),
    options
  );
}

export async function publicTournamentIdsForSchool(
  schoolId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(eq(tournaments.hostSchoolId, schoolId));
  return rows.map((row) => row.id);
}

export async function publicTournamentIdsForTeam(
  teamId: string
): Promise<string[]> {
  const [poolRows, matchRows] = await Promise.all([
    db
      .select({ id: tournaments.id })
      .from(poolTeams)
      .innerJoin(pools, eq(poolTeams.poolId, pools.id))
      .innerJoin(divisions, eq(pools.divisionId, divisions.id))
      .innerJoin(tournaments, eq(divisions.tournamentId, tournaments.id))
      .where(eq(poolTeams.teamId, teamId)),
    db
      .select({ id: tournaments.id })
      .from(matches)
      .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
      .where(
        or(
          eq(matches.teamAId, teamId),
          eq(matches.teamBId, teamId),
          eq(matches.winnerId, teamId)
        )
      ),
  ]);
  return [...new Set([...poolRows, ...matchRows].map((row) => row.id))];
}
