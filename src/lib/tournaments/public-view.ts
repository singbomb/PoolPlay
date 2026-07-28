/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, eq, ne } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";
import { publicTournamentCacheTag } from "./public-cache";
import {
  buildPublicTournamentProjection,
  type PublicTournamentProjection,
} from "./public-projection";
import {
  loadPublicProjectionSource,
  loadPublishedTournament,
} from "./public-view-rows";

interface PublicTournamentMetadata {
  name: string;
  description: string | null;
}

async function loadPublicTournamentMetadataBySlug(
  slug: string
): Promise<PublicTournamentMetadata | null> {
  const [row] = await db
    .select({
      name: tournaments.name,
      description: tournaments.description,
    })
    .from(tournaments)
    .where(and(eq(tournaments.slug, slug), ne(tournaments.status, "draft")))
    .limit(1);
  return row ?? null;
}

export async function getPublicTournamentMetadataBySlug(
  slug: string
): Promise<PublicTournamentMetadata | null> {
  return unstable_cache(
    () => loadPublicTournamentMetadataBySlug(slug),
    ["public-tournament-metadata", slug],
    { revalidate: 60, tags: [publicTournamentCacheTag(slug)] }
  )();
}

/**
 * Reads all released rows from one snapshot before applying the public DTO.
 * Drizzle uses the trusted server connection; the projection is the boundary.
 */
async function loadPublicTournamentViewBySlug(
  slug: string
): Promise<PublicTournamentProjection | null> {
  return db.transaction(
    async (tx) => {
      const tournament = await loadPublishedTournament(tx, slug);
      if (!tournament) return null;
      const source = await loadPublicProjectionSource(tx, tournament);
      return buildPublicTournamentProjection(source);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

export async function getPublicTournamentViewBySlug(
  slug: string
): Promise<PublicTournamentProjection | null> {
  return unstable_cache(
    () => loadPublicTournamentViewBySlug(slug),
    ["public-tournament-view", slug],
    { revalidate: 5, tags: [publicTournamentCacheTag(slug)] }
  )();
}
