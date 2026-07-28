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

import { Calendar } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { HeaderNav } from "@/components/layout/header-nav";
import { PoolPlayMark } from "@/components/layout/poolplay-mark";
import { PublicSiteFooter } from "@/components/layout/public-site-footer";
import { UserMenu } from "@/components/layout/user-menu";
import {
  PublicTournamentAction,
  PublicTournamentPlay,
} from "@/components/public-tournament-play";
import { PublicMatchRefresh } from "@/components/realtime/public-match-refresh";
import { TeamAttributesBadges } from "@/components/team-attributes-badges";
import { ThemeToggle } from "@/components/theme-toggle";
import { TournamentHostSchoolLink } from "@/components/tournament-host-school-link";
import { TournamentLocationLink } from "@/components/tournament-location-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTournamentDateDisplay } from "@/lib/date-iso";
import { todayISO } from "@/lib/tournament-status";
import type { PublicTournamentProjection } from "@/lib/tournaments/public-projection";
import { publicTournamentLifecycle } from "@/lib/tournaments/public-refresh-policy";

interface AuthProfile {
  email: string;
  fullName: string;
}

function subscribeToLocalDate(onStoreChange: () => void): () => void {
  const timer = window.setInterval(onStoreChange, 60_000);
  document.addEventListener("visibilitychange", onStoreChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onStoreChange);
  };
}

function useLocalToday(): string {
  return useSyncExternalStore(subscribeToLocalDate, todayISO, () => "");
}

function PublicTournamentHeader({
  authProfile,
  returnHref,
}: {
  authProfile: AuthProfile | null;
  returnHref: string;
}) {
  const encodedReturnHref = encodeURIComponent(returnHref);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <PoolPlayMark href="/" wordmarkClassName="text-lg" />
          <HeaderNav />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          {authProfile ? (
            <UserMenu
              fullName={authProfile.fullName}
              email={authProfile.email}
            />
          ) : (
            <>
              <Link
                href={`/login?next=${encodedReturnHref}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Sign In
              </Link>
              <Link
                href={`/signup?next=${encodedReturnHref}`}
                className={buttonVariants({ size: "sm" })}
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function TournamentIdentity({
  archived,
  showStatus,
  tournament,
}: {
  archived: boolean;
  showStatus: boolean;
  tournament: PublicTournamentProjection["tournament"];
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-balance font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          {tournament.name}
        </h1>
        {showStatus ? (
          <StatusBadge
            kind="tournament"
            status={tournament.status}
            date={tournament.date}
            archived={archived}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <TournamentLocationLink
          location={tournament.location}
          address={tournament.address}
        />
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3.5" aria-hidden />
          {formatTournamentDateDisplay(tournament.date)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TeamAttributesBadges
          gender={tournament.gender}
          region={tournament.region}
        />
        <TournamentHostSchoolLink
          school={tournament.hostSchool}
          asLink={false}
        />
      </div>
      {tournament.description ? (
        <p className="max-w-3xl whitespace-pre-wrap text-pretty text-sm leading-relaxed text-muted-foreground">
          {tournament.description}
        </p>
      ) : null}
    </div>
  );
}

function TournamentHero({
  authenticated,
  view,
}: {
  authenticated: boolean;
  view: PublicTournamentProjection;
}) {
  const tournament = view.tournament;
  const today = useLocalToday();
  const lifecycle = publicTournamentLifecycle({
    date: tournament.date,
    hasLiveMatch: view.summary.liveMatches > 0,
    status: tournament.status,
    today,
  });
  return (
    <section className="space-y-6">
      <Link
        href="/explore"
        className="inline-flex rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← All tournaments
      </Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <TournamentIdentity
          archived={lifecycle.archived}
          showStatus={lifecycle.resolved}
          tournament={tournament}
        />
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <PublicTournamentAction
            authenticated={authenticated}
            canRegister={lifecycle.canRegister}
            slug={tournament.slug}
          />
          {lifecycle.resolved ? (
            <PublicMatchRefresh policy={lifecycle.refreshPolicy} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function PublicTournamentDetail({
  authProfile,
  view,
}: {
  authProfile: AuthProfile | null;
  view: PublicTournamentProjection;
}) {
  const returnHref = `/explore/tournaments/${view.tournament.slug}`;
  return (
    <div className="flex min-h-screen flex-col">
      <PublicTournamentHeader
        authProfile={authProfile}
        returnHref={returnHref}
      />
      <main className="relative min-w-0 flex-1 overflow-x-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 text-foreground/[0.055] bg-dot-grid [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="container mx-auto min-w-0 max-w-6xl space-y-10 px-4 py-8 sm:py-10">
          <TournamentHero authenticated={authProfile != null} view={view} />
          <PublicTournamentPlay view={view} />
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
