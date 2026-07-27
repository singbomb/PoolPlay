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

import { LayoutGrid, Users } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { registrations, tournaments } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  canAssignTeamsToPools,
  resolveIsTournamentOrganizer,
  poolAssignmentBlockedMessage,
  type UserForPermissions,
} from "@/lib/tournaments/permissions";
import { getDivisionPlayData } from "../brackets/data";
import { DivisionPoolRelease } from "../brackets/division-pool-release";
import { PoolMatchFormatPanel } from "../brackets/pool-match-format-panel";
import { PoolSeedingPanel } from "../brackets/pool-seeding-panel";
import { PoolView } from "../brackets/pool-view";
import { ScrollToPool } from "./scroll-to-pool";

export async function TournamentPoolPlayPanel({
  tournament,
  user,
  initialDivisionId = null,
  focusPoolId = null,
}: {
  tournament: InferSelectModel<typeof tournaments>;
  user: UserForPermissions;
  /** Division tab to open when deep-linking from a match. */
  initialDivisionId?: string | null;
  /** Pool section to scroll into view when deep-linking from a match. */
  focusPoolId?: string | null;
}) {
  const isOrganizer = await resolveIsTournamentOrganizer(tournament, user);

  const [divisionPlayData, pendingCountRow] = await Promise.all([
    getDivisionPlayData(tournament.id, { forOrganizer: isOrganizer }),
    db
      .select({ value: count() })
      .from(registrations)
      .where(
        and(
          eq(registrations.tournamentId, tournament.id),
          eq(registrations.status, "pending")
        )
      ),
  ]);

  const pendingCount = pendingCountRow[0]?.value ?? 0;
  const canAssignPools = await canAssignTeamsToPools(
    tournament,
    user,
    pendingCount
  );
  const poolAssignmentBlocked = poolAssignmentBlockedMessage(pendingCount);

  const poolMatchesStartedByPoolId = new Map<string, boolean>();
  if (isOrganizer) {
    for (const div of divisionPlayData) {
      for (const pool of div.pools) {
        poolMatchesStartedByPoolId.set(
          pool.id,
          pool.matches.some((m) => m.status !== "upcoming")
        );
      }
    }
  }

  const eligibleDivisions = divisionPlayData.filter((d) => {
    if (d.format !== "pool_to_bracket") {
      return isOrganizer && d.pools.some((p) => p.matches.length > 0);
    }
    if (!isOrganizer && !d.poolsReleasedAt) return false;
    return isOrganizer || d.pools.some((p) => p.matches.length > 0);
  });

  const defaultDivisionId =
    (initialDivisionId &&
      eligibleDivisions.some((d) => d.id === initialDivisionId) &&
      initialDivisionId) ||
    eligibleDivisions[0]?.id;

  return (
    <div className="space-y-6">
      {focusPoolId ? <ScrollToPool poolId={focusPoolId} /> : null}
      {isOrganizer && (
        <PoolMatchFormatPanel
          tournamentId={tournament.id}
          matchFormat={tournament.matchFormat}
          setStartingScore={tournament.setStartingScore}
          setTargetScore={tournament.setTargetScore}
          tiebreakTargetScore={tournament.tiebreakTargetScore}
          warmupFormat={tournament.warmupFormat}
          poolTiebreakCriteria={tournament.poolTiebreakCriteria}
        />
      )}
      {isOrganizer && poolAssignmentBlocked && (
        <p className="text-sm text-muted-foreground">{poolAssignmentBlocked}</p>
      )}
      {eligibleDivisions.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No pool play yet"
          description={
            isOrganizer
              ? "Add pools on the Setup tab. Play format was set when you created the tournament."
              : "Pools haven’t been released for this tournament yet. Check back soon."
          }
        />
      ) : (
        <Tabs defaultValue={defaultDivisionId}>
          {eligibleDivisions.length > 1 && (
            <TabsList>
              {eligibleDivisions.map((div) => (
                <TabsTrigger key={div.id} value={div.id}>
                  {div.name}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {eligibleDivisions.map((div) => (
            <TabsContent
              key={div.id}
              value={div.id}
              className="mt-4 space-y-4"
            >
              {isOrganizer && (
                <DivisionPoolRelease
                  tournamentId={tournament.id}
                  divisionId={div.id}
                  divisionName={div.name}
                  poolsReleasedAt={div.poolsReleasedAt}
                  matchCount={div.pools.reduce(
                    (n, p) => n + p.matches.length,
                    0
                  )}
                  completedMatchCount={div.pools.reduce(
                    (n, p) =>
                      n +
                      p.matches.filter((m) => m.status === "completed").length,
                    0
                  )}
                />
              )}
              {div.pools.length === 0 ||
              div.pools.every((p) => p.teams.length === 0) ? (
                <EmptyState
                  icon={Users}
                  title="No teams in this pool yet"
                  description={
                    isOrganizer
                      ? "Assign confirmed teams to this pool from the Teams tab."
                      : "Teams will appear here once the host assigns them."
                  }
                />
              ) : (
                <div className="space-y-4">
                  {div.pools.map((pool) => (
                    <div
                      key={pool.id}
                      id={`pool-${pool.id}`}
                      className="scroll-mt-4 space-y-4"
                    >
                      {isOrganizer && div.format === "pool_to_bracket" && (
                        <PoolSeedingPanel
                          key={`${pool.id}-${pool.teams.map((t) => t.id).join(",")}`}
                          tournamentId={tournament.id}
                          poolId={pool.id}
                          poolName={pool.name}
                          teams={pool.teams}
                          canEdit={canAssignPools}
                          matchesStarted={
                            poolMatchesStartedByPoolId.get(pool.id) ?? false
                          }
                        />
                      )}
                      {pool.matches.length > 0 ? (
                        <PoolView
                          tournamentId={tournament.id}
                          slug={tournament.slug}
                          tournamentDate={tournament.date}
                          pool={pool}
                          canEditRefs={isOrganizer}
                          canEditSchedule={isOrganizer}
                          tiebreakCriteria={tournament.poolTiebreakCriteria}
                        />
                      ) : isOrganizer && div.format === "pool_to_bracket" ? (
                        <p className="text-sm text-muted-foreground">
                          Save seeding to create pool matches.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
