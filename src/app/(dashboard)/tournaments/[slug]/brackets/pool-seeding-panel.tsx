"use client";

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

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  updateEliminationSeeding,
  updatePoolSeeding,
} from "./actions";
import { cn } from "@/lib/utils";

type PoolTeam = {
  id: string;
  name: string;
  university: string;
  seed: number | null;
};

export function PoolSeedingPanel({
  tournamentId,
  poolId,
  poolName,
  teams,
  canEdit,
  matchesStarted,
  mode = "pool",
}: {
  tournamentId: string;
  poolId: string;
  poolName: string;
  teams: PoolTeam[];
  canEdit: boolean;
  matchesStarted: boolean;
  mode?: "pool" | "elimination";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sorted = [...teams].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  const [order, setOrder] = useState<string[]>(() =>
    sorted.map((t) => t.id)
  );

  const move = useCallback((index: number, direction: -1 | 1) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const teamById = new Map(teams.map((t) => [t.id, t]));

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result =
        mode === "elimination"
          ? await updateEliminationSeeding(tournamentId, poolId, order)
          : await updatePoolSeeding(tournamentId, poolId, order);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (teams.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Add at least 2 confirmed teams to this{" "}
        {mode === "elimination" ? "division" : "pool"} before setting seeds.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Seeding — {poolName}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Set seed order (1 = top seed).{" "}
          {mode === "elimination"
            ? "Saving creates the elimination bracket without pool-play matches."
            : "Saving creates round-robin matches in that order."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-1">
          {order.map((teamId, index) => {
            const team = teamById.get(teamId);
            if (!team) return null;
            return (
              <li
                key={teamId}
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm",
                  pending && "opacity-60"
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {team.name}
                  <span className="ml-1 text-muted-foreground">
                    ({team.university})
                  </span>
                </span>
                {canEdit && !matchesStarted && (
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${team.name} up`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={pending || index === order.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${team.name} down`}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {matchesStarted && (
          <p className="text-xs text-warning">
            Matches have started — seeding is locked.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {canEdit && !matchesStarted && (
          <Button
            type="button"
            disabled={pending}
            onClick={handleSave}
            className="w-full sm:w-auto"
          >
            {pending && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            Save seeding &amp; generate matches
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
