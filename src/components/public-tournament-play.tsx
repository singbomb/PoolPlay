"use client";

/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import {
  ArrowRight,
  CalendarClock,
  CircleDashed,
  LayoutGrid,
  LockKeyhole,
  MapPin,
  Radio,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  PublicBracketMatchView,
  PublicBracketView,
  PublicMatchView,
  PublicTournamentProjection,
} from "@/lib/tournaments/public-projection";
import { cn } from "@/lib/utils";
import {
  PublicMatchCard,
  PublicMatchTime,
  PublicScoreRows,
} from "@/components/public-match-score";
import { PublicPoolCard } from "@/components/public-pool-card";

export function PublicTournamentAction({
  authenticated,
  canRegister,
  slug,
}: {
  authenticated: boolean;
  canRegister: boolean;
  slug: string;
}) {
  const dashboardHref = `/tournaments/${slug}`;
  if (authenticated) {
    return (
      <Link href={dashboardHref} className={buttonVariants({ className: "group" })}>
        Open in dashboard
        <ArrowRight className="ml-1.5 size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  }
  if (!canRegister) return null;

  const registerHref = `${dashboardHref}/register`;
  return (
    <Link
      href={`/login?next=${encodeURIComponent(registerHref)}`}
      className={buttonVariants({ className: "group" })}
    >
      Sign in to register
      <ArrowRight className="ml-1.5 size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function ScheduleSection({
  title,
  matches,
  live = false,
}: {
  title: string;
  matches: PublicMatchView[];
  live?: boolean;
}) {
  if (matches.length === 0) return null;
  const headingId = `schedule-${title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-[0.12em]"
      >
        {live ? <Radio className="size-4 text-live" aria-hidden /> : null}
        {title}
        <span className="font-sans text-xs font-normal tracking-normal text-muted-foreground">
          {matches.length}
        </span>
      </h3>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {matches.map((match) => (
          <PublicMatchCard key={match.key} match={match} />
        ))}
      </div>
    </section>
  );
}

function SchedulePanel({ matches }: { matches: PublicMatchView[] }) {
  if (matches.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No public matches yet"
        description="The host has released competition details, but the schedule is still being prepared."
      />
    );
  }

  return (
    <div className="space-y-7">
      <ScheduleSection
        title="Live now"
        live
        matches={matches.filter((match) => match.status === "in_progress")}
      />
      <ScheduleSection
        title="Coming up"
        matches={matches.filter((match) => match.status === "upcoming")}
      />
      <ScheduleSection
        title="Final"
        matches={matches.filter((match) => match.status === "completed")}
      />
    </div>
  );
}

function PoolsPanel({
  divisions,
}: {
  divisions: PublicTournamentProjection["divisions"];
}) {
  const withPools = divisions.filter((division) => division.pools.length > 0);
  if (withPools.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No pool play for this tournament"
        description="This tournament may use direct elimination, or its pools have not been generated."
      />
    );
  }

  return (
    <div className="space-y-8">
      {withPools.map((division) => (
        <section key={division.name} className="space-y-3">
          <h3 className="font-heading text-lg font-bold">{division.name}</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {division.pools.map((pool) => (
              <PublicPoolCard
                key={`${division.name}-${pool.name}`}
                pool={pool}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function bracketStateLabel(match: PublicBracketMatchView): string | null {
  if (match.activation === "conditional") return "If needed";
  if (match.activation === "not_required") return "Not needed";
  return null;
}

function BracketMatchCard({ match }: { match: PublicBracketMatchView }) {
  const stateLabel = bracketStateLabel(match);

  return (
    <div
      className={cn(
        "rounded-md border border-border/70 bg-background p-3",
        match.status === "in_progress" && "border-live/45",
        match.activation === "not_required" && "opacity-55"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {stateLabel ?? <PublicMatchTime value={match.scheduledTime} />}
        </span>
        {match.activation === "required" ? (
          <StatusBadge kind="match" status={match.status} />
        ) : (
          <CircleDashed className="size-3.5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <PublicScoreRows
        teamAName={match.teamAName}
        teamBName={match.teamBName}
        winner={match.winner}
        sets={match.sets}
      />
      {match.courtName ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" aria-hidden />
          {match.courtName}
        </p>
      ) : null}
    </div>
  );
}

function BracketCard({ bracket }: { bracket: PublicBracketView }) {
  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="size-4 text-primary" aria-hidden />
          {bracket.name}
        </CardTitle>
        <CardDescription>
          {bracket.bracketType.replaceAll("_", " ")} · {bracket.seedCount}{" "}
          seeds
        </CardDescription>
      </CardHeader>
      <CardContent>
        {bracket.rounds.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="grid min-w-max grid-flow-col auto-cols-[16rem] gap-3">
              {bracket.rounds.map((round) => (
                <section key={round.key} className="space-y-2">
                  <h4 className="border-b border-border/60 pb-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {round.label}
                  </h4>
                  {round.matches.map((match) => (
                    <BracketMatchCard key={match.key} match={match} />
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This bracket is waiting for seeds.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BracketsPanel({
  divisions,
}: {
  divisions: PublicTournamentProjection["divisions"];
}) {
  const withBrackets = divisions.filter(
    (division) => division.brackets.length > 0
  );
  if (withBrackets.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No brackets yet"
        description="Brackets will appear here after the host generates them."
      />
    );
  }

  return (
    <div className="space-y-8">
      {withBrackets.map((division) => (
        <section key={division.name} className="space-y-3">
          <h3 className="font-heading text-lg font-bold">{division.name}</h3>
          <div className="space-y-4">
            {division.brackets.map((bracket) => (
              <BracketCard
                key={`${division.name}-${bracket.tier}-${bracket.name}`}
                bracket={bracket}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CompetitionUnavailable() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10">
        <EmptyState
          icon={LockKeyhole}
          title="Competition details are not public yet"
          description="The host will release schedules, pools, and brackets when they are ready. This page checks for updates automatically."
        />
      </CardContent>
    </Card>
  );
}

function CompetitionHeading() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        Public competition center
      </p>
      <h2
        id="competition-heading"
        className="mt-1 font-heading text-2xl font-bold tracking-tight"
      >
        Follow the tournament
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Schedules, standings, brackets, and live scores in one place.
      </p>
    </div>
  );
}

function CompetitionSummary({
  summary,
}: {
  summary: PublicTournamentProjection["summary"];
}) {
  const metrics = [
    ["Live", summary.liveMatches],
    ["Matches", summary.matches],
    ["Pools", summary.pools],
    ["Brackets", summary.brackets],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

function CompetitionTabs({
  defaultTab,
  divisions,
  schedule,
}: {
  defaultTab: string;
  divisions: PublicTournamentProjection["divisions"];
  schedule: PublicMatchView[];
}) {
  return (
    <Tabs defaultValue={defaultTab} className="min-w-0 max-w-full">
      <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4">
        <TabsList className="min-w-max" aria-label="Competition views">
          <TabsTrigger value="schedule">
            <CalendarClock data-icon="inline-start" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="pools">
            <LayoutGrid data-icon="inline-start" />
            Pools
          </TabsTrigger>
          <TabsTrigger value="brackets">
            <Trophy data-icon="inline-start" />
            Brackets
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="schedule" className="mt-4 min-w-0">
        <SchedulePanel matches={schedule} />
      </TabsContent>
      <TabsContent value="pools" className="mt-4 min-w-0">
        <PoolsPanel divisions={divisions} />
      </TabsContent>
      <TabsContent value="brackets" className="mt-4 min-w-0">
        <BracketsPanel divisions={divisions} />
      </TabsContent>
    </Tabs>
  );
}

export function PublicTournamentPlay({
  view,
}: {
  view: PublicTournamentProjection;
}) {
  const { summary, schedule, divisions } = view;
  if (summary.releasedDivisions === 0) return <CompetitionUnavailable />;
  const defaultTab =
    schedule.length > 0
      ? "schedule"
      : summary.pools > 0
        ? "pools"
        : "brackets";
  return (
    <section
      className="min-w-0 max-w-full space-y-5"
      aria-labelledby="competition-heading"
    >
      <CompetitionHeading />
      <CompetitionSummary summary={summary} />
      <CompetitionTabs
        defaultTab={defaultTab}
        divisions={divisions}
        schedule={schedule}
      />
    </section>
  );
}
