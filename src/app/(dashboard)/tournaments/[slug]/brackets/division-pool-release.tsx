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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Eye, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { releaseDivisionPools } from "../../actions";
import { cn } from "@/lib/utils";

export function DivisionPoolRelease({
  tournamentId,
  divisionId,
  divisionName,
  poolsReleasedAt,
  matchCount,
  completedMatchCount,
  kind = "pool",
}: {
  tournamentId: string;
  divisionId: string;
  divisionName: string;
  poolsReleasedAt: Date | null;
  matchCount: number;
  completedMatchCount: number;
  kind?: "pool" | "bracket";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const released = poolsReleasedAt != null;
  const poolPlayComplete =
    matchCount > 0 && completedMatchCount === matchCount;

  function handleRelease() {
    setError(null);
    startTransition(async () => {
      const result = await releaseDivisionPools(tournamentId, divisionId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (released) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
        <Badge
          variant="outline"
          className="border-success/25 bg-success/10 text-success"
        >
          Released
        </Badge>
        <span className="text-muted-foreground">
          {divisionName} is visible to all participants
          {poolsReleasedAt
            ? ` · ${format(new Date(poolsReleasedAt), "MMM d, h:mm a")}`
            : ""}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border border-dashed bg-muted/30 px-3 py-2.5",
        pending && "opacity-70"
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Host only — not released yet</p>
          <p className="text-xs text-muted-foreground">
            Only you can see {divisionName} until you release it. Participants
            will then see{" "}
            {kind === "bracket"
              ? "the bracket and its matches."
              : "standings, matches, and brackets."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={pending || matchCount === 0}
          onClick={handleRelease}
        >
          {pending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Eye className="mr-1 h-3 w-3" />
          )}
          Release to participants
        </Button>
      </div>
      {matchCount === 0 ? (
        <p className="text-xs text-muted-foreground">
          Save seeding on the {kind === "bracket" ? "Bracket" : "Pools"} tab
          to generate matches before releasing.
        </p>
      ) : kind === "bracket" ? (
        <p className="text-xs text-muted-foreground">
          Bracket generated with {matchCount} match
          {matchCount === 1 ? "" : "es"}. Ready to release.
        </p>
      ) : !poolPlayComplete ? (
        <p className="text-xs text-warning">
          {completedMatchCount} of {matchCount} pool matches complete — you can
          still release early if needed.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          All pool matches are complete. Ready to release.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
