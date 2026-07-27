"use server";

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

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  matches,
  courts,
  courtDivisions,
  tournaments,
  pools,
  brackets,
  divisions,
} from "@/lib/db/schema";
import { eq, and, isNull, or, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireUser } from "@/lib/auth";
import { canScheduleMatches } from "@/lib/tournaments/permissions";
import { getMatchTournamentId } from "@/lib/tournaments/match-query";
import { autoScheduleMatchesWithCourtSets } from "@/lib/utils/scheduling";
import { warmupMinutesForFormat } from "@/lib/labels/warmup-format";
import { assertScheduledCourtBelongsToMatchTournament } from "@/lib/security/authorization-invariants";

export async function autoScheduleTournament(
  tournamentId: string,
  startTimeISO: string,
  matchDuration: number
) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canScheduleMatches(tournament, user)) {
    return {
      error:
        "Matches can only be scheduled after registration closes. Only the organizer can schedule.",
    };
  }

  const tournamentCourts = await db
    .select()
    .from(courts)
    .where(eq(courts.tournamentId, tournamentId))
    .orderBy(asc(courts.name), asc(courts.id));

  if (tournamentCourts.length === 0) {
    return { error: "Add courts before scheduling" };
  }

  const courtDivisionLinks = await db
    .select({
      courtId: courtDivisions.courtId,
      divisionId: courtDivisions.divisionId,
    })
    .from(courtDivisions)
    .innerJoin(courts, eq(courtDivisions.courtId, courts.id))
    .where(eq(courts.tournamentId, tournamentId));

  const divisionIdsByCourt = new Map<string, Set<string>>();
  for (const row of courtDivisionLinks) {
    let set = divisionIdsByCourt.get(row.courtId);
    if (!set) {
      set = new Set();
      divisionIdsByCourt.set(row.courtId, set);
    }
    set.add(row.divisionId);
  }

  const divFromPool = alias(divisions, "schedule_div_pool");
  const divFromBracket = alias(divisions, "schedule_div_bracket");

  const unscheduledMatches = await db
    .select({
      id: matches.id,
      poolDivisionId: divFromPool.id,
      bracketDivisionId: divFromBracket.id,
    })
    .from(matches)
    .leftJoin(pools, eq(matches.poolId, pools.id))
    .leftJoin(divFromPool, eq(pools.divisionId, divFromPool.id))
    .leftJoin(brackets, eq(matches.bracketId, brackets.id))
    .leftJoin(divFromBracket, eq(brackets.divisionId, divFromBracket.id))
    .where(
      and(
        eq(matches.status, "upcoming"),
        isNull(matches.scheduledTime),
        or(
          eq(divFromPool.tournamentId, tournamentId),
          eq(divFromBracket.tournamentId, tournamentId)
        )
      )
    );

  if (unscheduledMatches.length === 0) {
    return { error: "No unscheduled matches found" };
  }

  const startTime = new Date(startTimeISO);
  const allCourtIds = tournamentCourts.map((c) => c.id);

  const items = unscheduledMatches.map((row) => {
    const divisionId = row.poolDivisionId ?? row.bracketDivisionId;
    let allowed = tournamentCourts
      .filter((c) => {
        const linked = divisionIdsByCourt.get(c.id);
        if (!linked || linked.size === 0) {
          return true;
        }
        return divisionId != null && linked.has(divisionId);
      })
      .map((c) => c.id);
    if (allowed.length === 0) {
      allowed = allCourtIds;
    }
    return { matchId: row.id, courtIds: allowed };
  });

  const warmupMinutes = warmupMinutesForFormat(tournament.warmupFormat);
  const schedule = autoScheduleMatchesWithCourtSets(
    items,
    startTime,
    matchDuration,
    warmupMinutes
  );

  for (const slot of schedule) {
    await db
      .update(matches)
      .set({
        courtId: slot.courtId,
        scheduledTime: slot.scheduledTime,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, slot.matchId));
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/schedule");
  return { success: true, scheduled: schedule.length };
}

export async function updateMatchSchedule(
  matchId: string,
  courtId: string,
  scheduledTime: string
) {
  const user = await requireUser();

  const tournamentId = await getMatchTournamentId(matchId);
  if (!tournamentId) {
    return { error: "Match not found" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canScheduleMatches(tournament, user)) {
    return { error: "Only the organizer can update match schedules during setup." };
  }

  const [court] = await db
    .select({ tournamentId: courts.tournamentId })
    .from(courts)
    .where(eq(courts.id, courtId))
    .limit(1);

  if (!court) {
    return { error: "Resource not found or access denied" };
  }

  try {
    assertScheduledCourtBelongsToMatchTournament({
      matchTournamentId: tournamentId,
      courtTournamentId: court.tournamentId,
    });
  } catch {
    return { error: "Resource not found or access denied" };
  }

  const [updatedMatch] = await db
    .update(matches)
    .set({
      courtId,
      scheduledTime: new Date(scheduledTime),
      updatedAt: new Date(),
    })
    .where(
      and(eq(matches.id, matchId), eq(matches.tournamentId, tournamentId))
    )
    .returning({ id: matches.id });

  if (!updatedMatch) {
    return { error: "Resource not found or access denied" };
  }

  revalidatePath("/schedule");
  return { success: true };
}
