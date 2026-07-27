/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schoolMembers,
  tournaments,
  users,
} from "@/lib/db/schema";

type DbClient = typeof db;

/**
 * Serialize tournament mutations and reauthorize the actor from locked rows.
 * This prevents organizer, officer, or account state changes racing a write.
 */
export async function loadLockedTournamentForOrganizer(
  tournamentId: string,
  actorUserId: string,
  executor: DbClient
): Promise<typeof tournaments.$inferSelect | null> {
  await executor.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${tournamentId}
    FOR UPDATE
  `);
  const [tournament] = await executor
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  const [actor] = await executor
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actorUserId))
    .for("share")
    .limit(1);
  if (!tournament || !actor || actor.disabledAt != null) return null;
  if (tournament.organizerId === actorUserId || actor.role === "admin") {
    return tournament;
  }
  if (!tournament.hostSchoolId) return null;

  const [officer] = await executor
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, tournament.hostSchoolId),
        eq(schoolMembers.userId, actorUserId),
        or(
          eq(schoolMembers.role, "president"),
          eq(schoolMembers.role, "officer")
        )
      )
    )
    .for("share")
    .limit(1);
  return officer ? tournament : null;
}
