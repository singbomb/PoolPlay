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

import { useSyncExternalStore } from "react";
import { Check, Clock3, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PublicMatchView } from "@/lib/tournaments/public-projection";
import { cn } from "@/lib/utils";

const PUBLIC_MATCH_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});
const LOCAL_MATCH_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const subscribeToHydration = () => () => {};

export function formatPublicMatchTime(value: string | null): string {
  return value ? PUBLIC_MATCH_TIME_FORMATTER.format(new Date(value)) : "Time TBD";
}

export function PublicMatchTime({ value }: { value: string | null }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  if (!value) return <span>Time TBD</span>;

  const date = new Date(value);
  const label = hydrated
    ? LOCAL_MATCH_TIME_FORMATTER.format(date)
    : formatPublicMatchTime(value);
  return <time dateTime={value}>{label}</time>;
}

function winnerClass(winner: "a" | "b" | null, side: "a" | "b"): string {
  return winner === side ? "font-semibold text-foreground" : "";
}

function PublicScoreRow({
  name,
  side,
  winner,
  sets,
}: {
  name: string | null;
  side: "a" | "b";
  winner: "a" | "b" | null;
  sets: PublicMatchView["sets"];
}) {
  const displayName = name ?? "TBD";

  return (
    <tr>
      <th
        scope="row"
        className={cn("truncate py-0.5 pr-2 text-left font-normal", winnerClass(winner, side))}
      >
        {winner === side ? (
          <Check className="mr-1 inline size-3.5 text-success" aria-hidden />
        ) : null}
        {displayName}
        {winner === side ? <span className="sr-only"> — Winner</span> : null}
      </th>
      {sets.length > 0 ? (
        sets.map((set, index) => (
          <td
            key={`${side}-${index}`}
            className={cn(
              "w-8 py-0.5 text-right tabular-nums",
              (side === "a" ? set.teamAScore > set.teamBScore : set.teamBScore > set.teamAScore) &&
                "font-semibold"
            )}
          >
            {side === "a" ? set.teamAScore : set.teamBScore}
          </td>
        ))
      ) : (
        <td className="w-8 py-0.5 text-right text-muted-foreground">—</td>
      )}
    </tr>
  );
}

export function PublicScoreRows({
  teamAName,
  teamBName,
  winner,
  sets,
}: Pick<PublicMatchView, "teamAName" | "teamBName" | "winner" | "sets">) {
  const scoreColumns = Math.max(sets.length, 1);

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Match score by set</caption>
        <colgroup>
          <col />
          {Array.from({ length: scoreColumns }, (_, index) => (
            <col key={index} className="w-8" />
          ))}
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Team</th>
            {sets.length > 0 ? (
              sets.map((_, index) => (
                <th key={index} scope="col">Set {index + 1}</th>
              ))
            ) : (
              <th scope="col">Score</th>
            )}
          </tr>
        </thead>
        <tbody>
          <PublicScoreRow name={teamAName} side="a" winner={winner} sets={sets} />
          <PublicScoreRow name={teamBName} side="b" winner={winner} sets={sets} />
        </tbody>
      </table>
    </div>
  );
}

export function PublicMatchCard({ match }: { match: PublicMatchView }) {
  const isLive = match.status === "in_progress";

  return (
    <Card
      className={cn(
        "min-w-0 max-w-full gap-0 py-0",
        isLive && "border-live/45 shadow-[inset_3px_0_0_0_var(--live)]"
      )}
    >
      <CardHeader className="gap-2 border-b border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">{match.context}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3" aria-hidden />
                <PublicMatchTime value={match.scheduledTime} />
              </span>
              {match.courtName ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {match.courtName}
                </span>
              ) : null}
            </CardDescription>
          </div>
          <StatusBadge
            kind="match"
            status={match.status}
            className="shrink-0"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <PublicScoreRows
          teamAName={match.teamAName}
          teamBName={match.teamBName}
          winner={match.winner}
          sets={match.sets}
        />
      </CardContent>
    </Card>
  );
}
