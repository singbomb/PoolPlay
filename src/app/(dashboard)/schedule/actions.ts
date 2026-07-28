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
  pools,
  brackets,
  bracketMatchEdges,
  divisions,
} from "@/lib/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireUser } from "@/lib/auth";
import {
  autoScheduleMatchesWithCourtSets,
  buildBracketScheduleDependencies,
  isAutoScheduleCandidate,
  SchedulePlanningError,
  type ScheduleDependency,
  type ScheduleItem,
} from "@/lib/utils/scheduling";
import { warmupMinutesForFormat } from "@/lib/labels/warmup-format";
import { loadLockedTournamentForOrganizer } from "@/lib/tournaments/locked-tournament-authorization";
import { isTournamentArchived } from "@/lib/tournament-status";
import { invalidatePublicTournamentCachesByIds } from "@/lib/tournaments/public-cache-invalidation";

type DbClient = typeof db;

const divFromPool = alias(divisions, "schedule_div_pool");
const divFromBracket = alias(divisions, "schedule_div_bracket");

async function loadTournamentCourts(
  tournamentId: string,
  executor: DbClient
) {
  await executor.execute(sql`
    SELECT id
    FROM ${courts}
    WHERE ${courts.tournamentId} = ${tournamentId}
    FOR SHARE
  `);
  const tournamentCourts = await executor
    .select()
    .from(courts)
    .where(eq(courts.tournamentId, tournamentId))
    .orderBy(asc(courts.name), asc(courts.id));
  const links = await executor
    .select({
      courtId: courtDivisions.courtId,
      divisionId: courtDivisions.divisionId,
    })
    .from(courtDivisions)
    .innerJoin(courts, eq(courtDivisions.courtId, courts.id))
    .where(eq(courts.tournamentId, tournamentId));
  const divisionIdsByCourt = new Map<string, Set<string>>();
  for (const row of links) {
    const divisionIds =
      divisionIdsByCourt.get(row.courtId) ?? new Set<string>();
    divisionIds.add(row.divisionId);
    divisionIdsByCourt.set(row.courtId, divisionIds);
  }
  return { tournamentCourts, divisionIdsByCourt };
}

async function loadTournamentMatchRows(
  tournamentId: string,
  executor: DbClient
) {
  await executor.execute(sql`
    SELECT id
    FROM ${matches}
    WHERE ${matches.tournamentId} = ${tournamentId}
    FOR UPDATE
  `);
  return executor
    .select({
      id: matches.id,
      poolDivisionId: divFromPool.id,
      bracketDivisionId: divFromBracket.id,
      bracketId: matches.bracketId,
      bracketType: brackets.bracketType,
      bracketSection: matches.bracketSection,
      bracketActivation: matches.bracketActivation,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      courtId: matches.courtId,
      scheduledTime: matches.scheduledTime,
      status: matches.status,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
    })
    .from(matches)
    .leftJoin(pools, eq(matches.poolId, pools.id))
    .leftJoin(divFromPool, eq(pools.divisionId, divFromPool.id))
    .leftJoin(brackets, eq(matches.bracketId, brackets.id))
    .leftJoin(divFromBracket, eq(brackets.divisionId, divFromBracket.id))
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(
      asc(matches.bracketId),
      asc(matches.bracketSection),
      asc(matches.bracketRound),
      asc(matches.bracketPosition),
      asc(matches.createdAt),
      asc(matches.id)
    );
}

type TournamentMatchRow = Awaited<
  ReturnType<typeof loadTournamentMatchRows>
>[number];

async function loadScheduleDependencies(
  tournamentId: string,
  rows: TournamentMatchRow[],
  executor: DbClient
): Promise<ScheduleDependency[]> {
  const persisted = await executor
    .select({
      bracketId: bracketMatchEdges.bracketId,
      sourceMatchId: bracketMatchEdges.sourceMatchId,
      targetMatchId: bracketMatchEdges.targetMatchId,
    })
    .from(bracketMatchEdges)
    .innerJoin(brackets, eq(bracketMatchEdges.bracketId, brackets.id))
    .innerJoin(divisions, eq(brackets.divisionId, divisions.id))
    .where(eq(divisions.tournamentId, tournamentId))
    .orderBy(
      asc(bracketMatchEdges.bracketId),
      asc(bracketMatchEdges.sourceMatchId),
      asc(bracketMatchEdges.targetMatchId)
    );
  const bracketRows = rows.flatMap((row) =>
    row.bracketId != null &&
    row.bracketType != null &&
    row.bracketSection != null &&
    row.bracketRound != null &&
    row.bracketPosition != null
      ? [
          {
            matchId: row.id,
            bracketId: row.bracketId,
            bracketType: row.bracketType,
            bracketSection: row.bracketSection,
            bracketRound: row.bracketRound,
            bracketPosition: row.bracketPosition,
          },
        ]
      : []
  );
  return buildBracketScheduleDependencies(bracketRows, persisted);
}

function buildScheduleItems(
  rows: TournamentMatchRow[],
  tournamentCourts: Awaited<
    ReturnType<typeof loadTournamentCourts>
  >["tournamentCourts"],
  divisionIdsByCourt: Map<string, Set<string>>
): ScheduleItem[] {
  return rows
    .filter(isAutoScheduleCandidate)
    .map((row) => {
      const divisionId = row.poolDivisionId ?? row.bracketDivisionId;
      const scopedCourtIds = tournamentCourts
        .filter((court) => {
          const linked = divisionIdsByCourt.get(court.id);
          return (
            !linked ||
            linked.size === 0 ||
            (divisionId != null && linked.has(divisionId))
          );
        })
        .map((court) => court.id);
      return {
        matchId: row.id,
        courtIds: scopedCourtIds,
        teamAId: row.teamAId,
        teamBId: row.teamBId,
      };
    });
}

async function scheduleTournamentLocked(
  tournamentId: string,
  actorUserId: string,
  startTime: Date,
  matchDuration: number,
  executor: DbClient
) {
  const tournament = await loadLockedTournamentForOrganizer(
    tournamentId,
    actorUserId,
    executor
  );
  if (
    !tournament ||
    tournament.status !== "registration_closed" ||
    isTournamentArchived(tournament.date)
  ) {
    return {
      error:
        "Matches can only be scheduled after registration closes. Only the organizer can schedule.",
    };
  }

  const { tournamentCourts, divisionIdsByCourt } =
    await loadTournamentCourts(tournamentId, executor);
  if (tournamentCourts.length === 0) {
    return { error: "Add courts before scheduling" };
  }
  const rows = await loadTournamentMatchRows(tournamentId, executor);
  const items = buildScheduleItems(
    rows,
    tournamentCourts,
    divisionIdsByCourt
  );
  if (items.length === 0) {
    return { error: "No unscheduled matches found" };
  }
  const dependencies = await loadScheduleDependencies(
    tournamentId,
    rows,
    executor
  );
  const warmupMinutes = warmupMinutesForFormat(tournament.warmupFormat);
  const schedule = autoScheduleMatchesWithCourtSets(
    items,
    startTime,
    matchDuration,
    warmupMinutes,
    {
      dependencies,
      matchStates: rows.map((row) => ({
        matchId: row.id,
        status: row.status,
        activation: row.bracketActivation,
        scheduledTime: row.scheduledTime,
        courtId: row.courtId,
        teamAId: row.teamAId,
        teamBId: row.teamBId,
      })),
    }
  );
  const updatedAt = new Date();
  for (const slot of schedule) {
    await executor
      .update(matches)
      .set({
        courtId: slot.courtId,
        scheduledTime: slot.scheduledTime,
        updatedAt,
      })
      .where(
        and(
          eq(matches.id, slot.matchId),
          eq(matches.tournamentId, tournamentId)
        )
      );
  }
  return { success: true as const, scheduled: schedule.length };
}

export async function autoScheduleTournament(
  tournamentId: string,
  startTimeISO: string,
  matchDuration: number
) {
  const user = await requireUser();
  const startTime = new Date(startTimeISO);
  if (!Number.isFinite(startTime.getTime())) {
    return { error: "Choose a valid schedule start time.", scheduled: 0 };
  }
  if (!Number.isFinite(matchDuration) || matchDuration <= 0) {
    return {
      error: "Match duration must be greater than zero.",
      scheduled: 0,
    };
  }

  let result;
  try {
    result = await db.transaction((tx) =>
      scheduleTournamentLocked(
        tournamentId,
        user.id,
        startTime,
        matchDuration,
        tx as unknown as DbClient
      )
    );
  } catch (error) {
    if (error instanceof SchedulePlanningError) {
      return { error: error.message, scheduled: 0 };
    }
    console.error("Failed to auto-schedule tournament", error);
    return {
      error: "Unable to save the tournament schedule.",
      scheduled: 0,
    };
  }
  if ("error" in result) return { ...result, scheduled: 0 };
  await invalidatePublicTournamentCachesByIds([tournamentId]);
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/schedule");
  return result;
}

export async function updateMatchSchedule(
  matchId: string,
  courtId: string,
  scheduledTime: string
) {
  const user = await requireUser();
  let changedTournamentId = "";
  const nextScheduledTime = new Date(scheduledTime);
  if (!Number.isFinite(nextScheduledTime.getTime())) {
    return { error: "Choose a valid match time." };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as DbClient;
      const [identity] = await executor
        .select({ tournamentId: matches.tournamentId })
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);
      if (!identity) return { error: "Match not found" };

      const tournament = await loadLockedTournamentForOrganizer(
        identity.tournamentId,
        user.id,
        executor
      );
      if (
        !tournament ||
        tournament.status !== "registration_closed" ||
        isTournamentArchived(tournament.date)
      ) {
        return {
          error:
            "Only the organizer can update match schedules during setup.",
        };
      }

      const [match] = await executor
        .select({
          bracketId: matches.bracketId,
          bracketActivation: matches.bracketActivation,
          status: matches.status,
        })
        .from(matches)
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournament.id)
          )
        )
        .for("update")
        .limit(1);
      if (
        !match ||
        match.status !== "upcoming" ||
        (match.bracketId != null &&
          match.bracketActivation !== "required")
      ) {
        return { error: "Resource not found or access denied" };
      }

      const [court] = await executor
        .select({ id: courts.id })
        .from(courts)
        .where(
          and(
            eq(courts.id, courtId),
            eq(courts.tournamentId, tournament.id)
          )
        )
        .for("share")
        .limit(1);
      if (!court) {
        return { error: "Resource not found or access denied" };
      }

      const [updatedMatch] = await executor
        .update(matches)
        .set({
          courtId,
          scheduledTime: nextScheduledTime,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournament.id),
            eq(matches.status, "upcoming")
          )
        )
        .returning({ id: matches.id });
      return updatedMatch
        ? { success: true as const, tournamentId: tournament.id }
        : { error: "Resource not found or access denied" };
    });
    if ("error" in result) return result;
    changedTournamentId = result.tournamentId;
  } catch (error) {
    console.error("Failed to update match schedule", error);
    return { error: "Unable to update the match schedule." };
  }

  await invalidatePublicTournamentCachesByIds([changedTournamentId]);
  revalidatePath("/schedule");
  return { success: true };
}
