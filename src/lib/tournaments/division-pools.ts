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

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions,
  poolTeams,
  pools,
  registrations,
  teams,
} from "@/lib/db/schema";

type DbClient = typeof db;

/**
 * Each division now has a single auto-created pool that mirrors the team list
 * from the Teams tab. Helpers here keep that mirror in sync with confirmed
 * registrations so hosts never have to manage pool membership manually.
 *
 * Legacy tournaments that already have multiple pools per division are left
 * alone — we only auto-sync when a division has 0 or 1 pool, which is the
 * only shape the new UI produces.
 */

/** Statuses that mean a team is in the pool roster for play. */
const ACTIVE_REGISTRATION_STATUSES: readonly (
  | "confirmed"
  | "checked_in"
)[] = ["confirmed", "checked_in"] as const;

/**
 * Returns the auto-pool id for a division. Creates one if missing. Returns
 * `null` for legacy divisions that already have multiple pools, so callers
 * skip auto-sync in that case.
 */
export async function ensureDivisionAutoPool(
  divisionId: string,
  client: DbClient = db
): Promise<string | null> {
  if (client === db) {
    return db.transaction((tx) =>
      ensureDivisionAutoPool(
        divisionId,
        tx as unknown as DbClient
      )
    );
  }

  await client.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`poolplay:auto-pool:${divisionId}`}, 0)
    )
  `);
  const existing = await client
    .select({ id: pools.id })
    .from(pools)
    .where(eq(pools.divisionId, divisionId))
    .orderBy(asc(pools.createdAt), asc(pools.id));

  if (existing.length > 1) return null;
  if (existing.length === 1) return existing[0].id;

  const [division] = await client
    .select({ name: divisions.name })
    .from(divisions)
    .where(eq(divisions.id, divisionId))
    .limit(1);

  const [created] = await client
    .insert(pools)
    .values({
      divisionId,
      name: division?.name ?? "Pool",
    })
    .returning({ id: pools.id });

  return created?.id ?? null;
}

/**
 * Make a division's auto-pool roster match its currently active registrations
 * (confirmed / checked-in). No-op for legacy divisions with multiple pools.
 */
export async function syncDivisionAutoPoolMembers(
  tournamentId: string,
  divisionId: string,
  client: DbClient = db
): Promise<void> {
  if (client === db) {
    await db.transaction((tx) =>
      syncDivisionAutoPoolMembers(
        tournamentId,
        divisionId,
        tx as unknown as DbClient
      )
    );
    return;
  }

  const poolId = await ensureDivisionAutoPool(divisionId, client);
  if (!poolId) return;

  const desiredRows = await client
    .select({
      teamId: registrations.teamId,
      registeredAt: registrations.registeredAt,
      teamName: teams.name,
    })
    .from(registrations)
    .innerJoin(teams, eq(registrations.teamId, teams.id))
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        eq(registrations.divisionId, divisionId),
        inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES)
      )
    )
    .orderBy(asc(registrations.registeredAt), asc(teams.name));

  const desiredOrder = new Map<string, number>();
  desiredRows.forEach((r, i) => desiredOrder.set(r.teamId, i));
  const desiredIds = new Set(desiredOrder.keys());

  const currentRows = await client
    .select({
      id: poolTeams.id,
      teamId: poolTeams.teamId,
      seed: poolTeams.seed,
    })
    .from(poolTeams)
    .where(eq(poolTeams.poolId, poolId));

  const currentByTeam = new Map(currentRows.map((r) => [r.teamId, r]));

  for (const row of currentRows) {
    if (!desiredIds.has(row.teamId)) {
      await client.delete(poolTeams).where(eq(poolTeams.id, row.id));
    }
  }

  let maxSeed = 0;
  for (const row of currentRows) {
    if (desiredIds.has(row.teamId) && row.seed != null && row.seed > maxSeed) {
      maxSeed = row.seed;
    }
  }

  for (const teamId of desiredIds) {
    if (!currentByTeam.has(teamId)) {
      maxSeed += 1;
      await client
        .insert(poolTeams)
        .values({
          poolId,
          teamId,
          seed: maxSeed,
        })
        .onConflictDoNothing({
          target: [poolTeams.poolId, poolTeams.teamId],
        });
    }
  }
}

/**
 * Resync every division-pool that might be affected by a multi-team
 * registration mutation. Pass the set of division ids that changed.
 */
export async function syncManyDivisionPools(
  tournamentId: string,
  divisionIds: Iterable<string | null | undefined>,
  client: DbClient = db
): Promise<void> {
  const ids = new Set<string>();
  for (const id of divisionIds) {
    if (id) ids.add(id);
  }
  for (const id of [...ids].sort()) {
    await syncDivisionAutoPoolMembers(tournamentId, id, client);
  }
}
