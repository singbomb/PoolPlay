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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PublicMatchTime, PublicScoreRows } from "./public-match-score";
import { StatusBadge } from "./ui/status-badge";
import type {
  PublicMatchView,
  PublicPoolStanding,
  PublicPoolView,
} from "@/lib/tournaments/public-projection";

function PoolStandingRow({
  poolName,
  standing,
}: {
  poolName: string;
  standing: PublicPoolStanding;
}) {
  return (
    <TableRow key={`${poolName}-${standing.rank}`}>
      <TableCell className="font-semibold">{standing.rank}</TableCell>
      <TableCell>
        <span className="font-medium">{standing.teamName}</span>
        {standing.university ? (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {standing.university}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-center tabular-nums">
        {standing.wins}-{standing.losses}
      </TableCell>
      <TableCell className="text-center tabular-nums">
        {standing.setsWon}-{standing.setsLost}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {standing.pointDiff > 0
          ? `+${standing.pointDiff}`
          : standing.pointDiff}
      </TableCell>
    </TableRow>
  );
}

function PoolStandings({ pool }: { pool: PublicPoolView }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-center">W-L</TableHead>
            <TableHead className="text-center">Sets</TableHead>
            <TableHead className="text-right">+/-</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pool.standings.map((standing) => (
            <PoolStandingRow
              key={`${pool.name}-${standing.rank}`}
              poolName={pool.name}
              standing={standing}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PoolMatch({ match }: { match: PublicMatchView }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <PublicMatchTime value={match.scheduledTime} />
        <StatusBadge kind="match" status={match.status} />
      </div>
      <PublicScoreRows
        teamAName={match.teamAName}
        teamBName={match.teamBName}
        winner={match.winner}
        sets={match.sets}
      />
    </div>
  );
}

function PoolMatches({ matches }: { matches: PublicMatchView[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Pool matches
      </h4>
      <div className="grid gap-2 md:grid-cols-2">
        {matches.map((match) => (
          <PoolMatch key={match.key} match={match} />
        ))}
      </div>
    </div>
  );
}

export function PublicPoolCard({ pool }: { pool: PublicPoolView }) {
  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader className="border-b border-border/60">
        <CardTitle>{pool.name}</CardTitle>
        <CardDescription>
          {pool.teams.length} team{pool.teams.length === 1 ? "" : "s"} ·{" "}
          {pool.matches.length} match{pool.matches.length === 1 ? "" : "es"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <PoolStandings pool={pool} />
        <PoolMatches matches={pool.matches} />
      </CardContent>
    </Card>
  );
}
