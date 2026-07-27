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

import Link from "next/link";
import { format as formatDate } from "date-fns";
import { ArrowUpRight, CalendarClock, Radio, Users } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  buildMatchScoreState,
  matchFormatForMatch,
} from "@/lib/tournaments/match-format";
import { formatBracketRoundLabel } from "@/lib/tournaments/bracket-labels";
import { isPlayableMatch } from "@/lib/tournaments/match-visibility";
import type { MatchFormat } from "@/lib/labels/match-format";
import { isBracketRoundOneByeMatch } from "@/lib/utils/bracket";
import { cn } from "@/lib/utils";
import type { DivisionPlayData } from "./brackets/data";

interface MatchSet {
  teamAScore: number;
  teamBScore: number;
}

interface BoardMatch {
  id: string;
  slug: string;
  status: string;
  scheduledTime: Date | null;
  context: string;
  teamAName: string | null;
  teamBName: string | null;
  winnerId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  refName: string | null;
  bracketId: string | null;
  sets: MatchSet[];
}

interface FormatSettings {
  format: MatchFormat;
  targetScore: number;
  tiebreakTargetScore: number;
}

function flattenMatches(divisions: DivisionPlayData[]): BoardMatch[] {
  const out: BoardMatch[] = [];
  for (const div of divisions) {
    for (const pool of div.pools) {
      for (const m of pool.matches) {
        out.push({
          id: m.id,
          slug: m.slug,
          status: m.status,
          scheduledTime: m.scheduledTime,
          context: `${div.name} · ${pool.name}`,
          teamAName: m.teamA?.name ?? null,
          teamBName: m.teamB?.name ?? null,
          winnerId: m.winnerId,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          refName: m.ref?.name ?? null,
          bracketId: null,
          sets: m.sets,
        });
      }
    }
    for (const bracket of div.brackets) {
      for (const m of bracket.matches) {
        if (!m.teamAName && !m.teamBName) continue;
        if (!isPlayableMatch({ ...m, bracketId: bracket.id })) continue;
        if (
          isBracketRoundOneByeMatch({
            bracketRound: m.bracketRound,
            teamAId: m.teamAId,
            teamBId: m.teamBId,
          })
        ) {
          continue;
        }
        out.push({
          id: m.id,
          slug: m.slug,
          status: m.status,
          scheduledTime: m.scheduledTime,
          context: `${div.name} · ${formatBracketRoundLabel({
            section: m.bracketSection,
            round: m.bracketRound ?? 1,
          })}`,
          teamAName: m.teamAName,
          teamBName: m.teamBName,
          winnerId: m.winnerId,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          refName: null,
          bracketId: bracket.id,
          sets: m.sets,
        });
      }
    }
  }
  return out;
}

function sortByTime(a: BoardMatch, b: BoardMatch): number {
  const at = a.scheduledTime ? a.scheduledTime.getTime() : Infinity;
  const bt = b.scheduledTime ? b.scheduledTime.getTime() : Infinity;
  return at - bt;
}

function MatchCard({
  slug,
  match,
  settings,
}: {
  slug: string;
  match: BoardMatch;
  settings: FormatSettings;
}) {
  const effectiveSettings = {
    ...settings,
    format: matchFormatForMatch(settings.format, match),
  };
  const { setsWonA, setsWonB } = buildMatchScoreState(
    effectiveSettings,
    match.sets
  );
  const teamA = match.teamAName ?? "TBD";
  const teamB = match.teamBName ?? "TBD";
  const aWon = match.winnerId != null && match.winnerId === match.teamAId;
  const bWon = match.winnerId != null && match.winnerId === match.teamBId;

  return (
    <Link
      href={`/tournaments/${slug}/matches/${match.slug}`}
      className="group block h-full rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <Card className="h-full gap-0 py-0 transition-colors duration-150 group-hover:border-primary/35 group-hover:bg-muted/30">
        <CardHeader className="gap-2 p-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold leading-tight">
              {teamA}{" "}
              <span className="font-normal text-muted-foreground">vs</span>{" "}
              {teamB}
            </h4>
            <StatusBadge
              kind="match"
              status={match.status}
              className="shrink-0"
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{match.context}</span>
            {match.scheduledTime && (
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                {formatDate(match.scheduledTime, "EEE h:mm a")}
              </span>
            )}
            {match.refName && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                Ref {match.refName}
              </span>
            )}
          </p>
        </CardHeader>

        <CardContent className="p-4 pt-0">
          <div className="flex items-center justify-center gap-6 text-center">
            <ScoreColumn name={teamA} value={setsWonA} won={aWon} />
            <span className="text-lg text-muted-foreground">–</span>
            <ScoreColumn name={teamB} value={setsWonB} won={bWon} />
          </div>

          {match.sets.length > 0 ? (
            <>
              <Separator className="my-3" />
              <div className="space-y-1">
                {match.sets.map((s, i) => (
                  <div
                    key={i}
                    className="flex justify-between px-1 text-xs tabular-nums"
                  >
                    <span className="text-muted-foreground">Set {i + 1}</span>
                    <span>
                      <span
                        className={cn(
                          s.teamAScore > s.teamBScore && "font-semibold"
                        )}
                      >
                        {s.teamAScore}
                      </span>
                      <span className="text-muted-foreground"> – </span>
                      <span
                        className={cn(
                          s.teamBScore > s.teamAScore && "font-semibold"
                        )}
                      >
                        {s.teamBScore}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {match.status === "in_progress"
                ? "In progress, no sets recorded yet"
                : "Not started"}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Open match
            <ArrowUpRight className="ml-0.5 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ScoreColumn({
  name,
  value,
  won,
}: {
  name: string;
  value: number;
  won: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "text-3xl font-bold tabular-nums",
          won ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {value}
      </p>
      <p className="max-w-[7rem] truncate text-xs text-muted-foreground">
        {name}
      </p>
    </div>
  );
}

/**
 * Read-friendly board of every match in a tournament, grouped by lifecycle and
 * rendered as live-scoring-style cards. Each card links to its match page,
 * where refs/host run warmup, scoring, and finalization.
 */
export function MatchBoard({
  slug,
  divisions,
  settings,
}: {
  slug: string;
  divisions: DivisionPlayData[];
  settings: FormatSettings;
}) {
  const all = flattenMatches(divisions);
  if (all.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No matches yet"
        description="Once pools or brackets are generated, every match shows up here with live status and scores."
      />
    );
  }

  const live = all.filter((m) => m.status === "in_progress").sort(sortByTime);
  const upcoming = all.filter((m) => m.status === "upcoming").sort(sortByTime);
  const completed = all
    .filter((m) => m.status === "completed")
    .sort(sortByTime);

  return (
    <div className="space-y-6">
      {live.length > 0 && (
        <Section title="Live" count={live.length} icon={<Radio className="h-4 w-4 text-live" />}>
          {live.map((m) => (
            <MatchCard key={m.id} slug={slug} match={m} settings={settings} />
          ))}
        </Section>
      )}
      <Section title="Upcoming" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No upcoming matches.
            </CardContent>
          </Card>
        ) : (
          upcoming.map((m) => (
            <MatchCard key={m.id} slug={slug} match={m} settings={settings} />
          ))
        )}
      </Section>
      {completed.length > 0 && (
        <Section title="Completed" count={completed.length}>
          {completed.map((m) => (
            <MatchCard key={m.id} slug={slug} match={m} settings={settings} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        {icon}
        {title}{" "}
        <span className="font-normal text-muted-foreground">({count})</span>
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}
