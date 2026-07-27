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

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  brackets,
  divisions,
  matches,
  pools,
  schoolMembers,
  tournaments,
} from "@/lib/db/schema";
import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarClock } from "lucide-react";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { ScheduleControls } from "./schedule-controls";
import { enrichScheduledMatches } from "@/lib/schedule/enrich-scheduled-matches";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("Schedule");

const schedulePoolDivision = alias(divisions, "schedule_page_pool_division");
const scheduleBracketDivision = alias(
  divisions,
  "schedule_page_bracket_division"
);

export default async function SchedulePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const schoolMembershipRows = await db
    .select({
      schoolId: schoolMembers.schoolId,
      role: schoolMembers.role,
    })
    .from(schoolMembers)
    .where(eq(schoolMembers.userId, user.id));
  const memberSchoolIds = schoolMembershipRows.map((row) => row.schoolId);
  const officerSchoolIds = schoolMembershipRows
    .filter((row) => row.role === "president" || row.role === "officer")
    .map((row) => row.schoolId);
  const managesTournament =
    officerSchoolIds.length > 0
      ? or(
          eq(tournaments.organizerId, user.id),
          inArray(tournaments.hostSchoolId, officerSchoolIds)
        )
      : eq(tournaments.organizerId, user.id);
  const releasedPlay = or(
    isNotNull(schedulePoolDivision.poolsReleasedAt),
    isNotNull(scheduleBracketDivision.poolsReleasedAt)
  );
  const canViewPublishedTournament =
    memberSchoolIds.length > 0
      ? or(
          ne(tournaments.status, "draft"),
          inArray(tournaments.hostSchoolId, memberSchoolIds)
        )
      : ne(tournaments.status, "draft");
  const canViewScheduledMatch =
    user.role === "admin"
      ? sql<boolean>`true`
      : or(
          managesTournament,
          and(canViewPublishedTournament, releasedPlay)
        );

  const [scheduledMatches, userTournaments] = await Promise.all([
    db
      .select(getTableColumns(matches))
      .from(matches)
      .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
      .leftJoin(pools, eq(matches.poolId, pools.id))
      .leftJoin(
        schedulePoolDivision,
        eq(pools.divisionId, schedulePoolDivision.id)
      )
      .leftJoin(brackets, eq(matches.bracketId, brackets.id))
      .leftJoin(
        scheduleBracketDivision,
        eq(brackets.divisionId, scheduleBracketDivision.id)
      )
      .where(and(isNotNull(matches.scheduledTime), canViewScheduledMatch))
      .orderBy(asc(matches.scheduledTime)),
    user.role === "admin"
      ? db
          .select({ id: tournaments.id, name: tournaments.name })
          .from(tournaments)
          .orderBy(asc(tournaments.name))
      : db
          .select({ id: tournaments.id, name: tournaments.name })
          .from(tournaments)
          .where(managesTournament)
          .orderBy(asc(tournaments.name)),
  ]);

  const enrichedMatches = await enrichScheduledMatches(scheduledMatches);

  // Group by date
  const byDate = new Map<string, typeof enrichedMatches>();
  for (const match of enrichedMatches) {
    const dateKey = match.scheduledTime
      ? format(match.scheduledTime, "yyyy-MM-dd")
      : "unscheduled";
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(match);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="View all scheduled matches across tournaments."
      />

      {userTournaments.length > 0 && (
        <ScheduleControls tournaments={userTournaments} />
      )}

      {enrichedMatches.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled matches yet"
          description="Create a tournament and generate pools or brackets, then auto-schedule to see matches here."
        />
      ) : (
        [...byDate.entries()].map(([dateKey, dayMatches]) => (
          <div key={dateKey} className="space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {dateKey === "unscheduled"
                ? "Unscheduled"
                : format(new Date(dateKey + "T00:00:00"), "EEE, MMM d, yyyy")}
            </h2>
            <div className="list-stack border-y border-border/70">
              {dayMatches.map((match) => (
                <div
                  key={match.id}
                  className="list-row"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    {match.scheduledTime && (
                      <div className="flex min-w-[4.5rem] flex-col items-end text-sm font-medium tabular-nums text-muted-foreground">
                        <span>{format(match.scheduledTime, "h:mm a")}</span>
                        {match.warmupStart && (
                          <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                            Warmup {format(match.warmupStart, "h:mm")}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {match.teamAName} vs {match.teamBName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {match.courtName}
                        {match.contextLabel && `\u00A0\u00B7\u00A0${match.contextLabel}`}
                        {match.refTeamName && `\u00A0\u00B7\u00A0Ref ${match.refTeamName}`}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    kind="match"
                    status={match.status}
                    className="shrink-0"
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
