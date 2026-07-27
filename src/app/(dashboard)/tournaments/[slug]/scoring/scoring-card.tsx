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

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { updateScore, finalizeMatch, startMatch } from "./actions";
import { format } from "date-fns";
import {
  formatMatchFormatLabel,
  type MatchFormat,
} from "@/lib/labels/match-format";
import {
  targetForSet,
  totalSetsForFormat,
} from "@/lib/tournaments/match-format";
import {
  warmupMinutesForFormat,
  type WarmupFormat,
} from "@/lib/labels/warmup-format";

interface MatchSet {
  id: string;
  setNumber: number;
  teamAScore: number;
  teamBScore: number;
}

interface ScoringMatch {
  id: string;
  status: string;
  scheduledTime: Date | null;
  teamA: { id: string; name: string } | null;
  teamB: { id: string; name: string } | null;
  courtName: string | null;
  refTeamName: string | null;
  contextLabel: string | null;
  winnerId: string | null;
  scoreRevision: number;
  sets: MatchSet[];
}

interface MatchFormatProps {
  matchFormat: MatchFormat;
  setStartingScore: number;
  setTargetScore: number;
  tiebreakTargetScore: number;
  warmupFormat: WarmupFormat;
}

export function ScoringCard({
  match,
  canScore,
  matchFormat,
  setStartingScore,
  setTargetScore,
  tiebreakTargetScore,
  warmupFormat,
}: {
  match: ScoringMatch;
  canScore: boolean;
} & MatchFormatProps) {
  const router = useRouter();
  const [newSetNumber, setNewSetNumber] = useState(
    (match.sets.length || 0) + 1
  );
  const [teamAScore, setTeamAScore] = useState(setStartingScore);
  const [teamBScore, setTeamBScore] = useState(setStartingScore);
  const [loading, setLoading] = useState(false);
  const [scoreRevision, setScoreRevision] = useState(match.scoreRevision);

  const { max: maxSets } = totalSetsForFormat(matchFormat);
  const targetThisSet = targetForSet(
    {
      format: matchFormat,
      targetScore: setTargetScore,
      tiebreakTargetScore: tiebreakTargetScore,
    },
    newSetNumber
  );
  const setsLocked = match.sets.length >= maxSets;

  async function handleScoreSubmit() {
    setLoading(true);
    const formData = new FormData();
    formData.set("matchId", match.id);
    formData.set("setNumber", String(newSetNumber));
    formData.set("teamAScore", String(teamAScore));
    formData.set("teamBScore", String(teamBScore));
    formData.set("expectedRevision", String(scoreRevision));
    const result = await updateScore(formData);
    if (result?.error) {
      toast.error(result.error);
      setLoading(false);
      router.refresh();
      return;
    }
    if (result?.nextRevision == null) {
      toast.error("Could not confirm the saved score. Refresh and try again.");
      setLoading(false);
      router.refresh();
      return;
    }
    setScoreRevision(result.nextRevision);
    setNewSetNumber((prev) => prev + 1);
    setTeamAScore(setStartingScore);
    setTeamBScore(setStartingScore);
    setLoading(false);
    router.refresh();
  }

  async function handleFinalize(winnerId: string) {
    setLoading(true);
    const result = await finalizeMatch(match.id, winnerId, scoreRevision);
    if (result?.error) {
      toast.error(result.error);
      setLoading(false);
      router.refresh();
      return;
    }
    if (result?.nextRevision == null) {
      toast.error("Could not confirm the match result. Refresh and try again.");
      setLoading(false);
      router.refresh();
      return;
    }
    setScoreRevision(result.nextRevision);
    setLoading(false);
    router.refresh();
  }

  async function handleStart() {
    setLoading(true);
    const result = await startMatch(match.id, scoreRevision);
    if (result?.error) {
      toast.error(result.error);
      setLoading(false);
      router.refresh();
      return;
    }
    if (result?.nextRevision == null) {
      toast.error("Could not confirm the match start. Refresh and try again.");
      setLoading(false);
      router.refresh();
      return;
    }
    setScoreRevision(result.nextRevision);
    setLoading(false);
    router.refresh();
  }

  const teamASetsWon = match.sets.filter(
    (s) => s.teamAScore > s.teamBScore
  ).length;
  const teamBSetsWon = match.sets.filter(
    (s) => s.teamBScore > s.teamAScore
  ).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {match.teamA?.name ?? "TBD"} vs {match.teamB?.name ?? "TBD"}
          </CardTitle>
          <StatusBadge kind="match" status={match.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {match.contextLabel}
          {match.contextLabel && match.courtName && " · "}
          {match.courtName && `${match.courtName}`}
          {match.scheduledTime && (() => {
            const warmupMinutes = warmupMinutesForFormat(warmupFormat);
            const warmupTime =
              warmupMinutes > 0
                ? new Date(
                    match.scheduledTime.getTime() - warmupMinutes * 60 * 1000
                  )
                : null;
            return ` \u00B7 ${
              warmupTime ? `Warmup ${format(warmupTime, "h:mm")} \u2192 ` : ""
            }${format(match.scheduledTime, "h:mm a")}`;
          })()}
          {match.refTeamName && ` \u00B7 Ref ${match.refTeamName}`}
          {` \u00B7 ${formatMatchFormatLabel(matchFormat)} \u00B7 To ${setTargetScore}${
            matchFormat === "two_with_tiebreak"
              ? ` (3rd to ${tiebreakTargetScore})`
              : ""
          }`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Score display */}
        <div className="flex items-center justify-center gap-6 text-center">
          <div>
            <p className="text-2xl font-bold">{teamASetsWon}</p>
            <p className="text-xs text-muted-foreground">
              {match.teamA?.name ?? "A"}
            </p>
          </div>
          <span className="text-muted-foreground">-</span>
          <div>
            <p className="text-2xl font-bold">{teamBSetsWon}</p>
            <p className="text-xs text-muted-foreground">
              {match.teamB?.name ?? "B"}
            </p>
          </div>
        </div>

        {/* Set scores */}
        {match.sets.length > 0 && (
          <div className="space-y-1">
            {match.sets.map((s) => (
              <div
                key={s.id}
                className="flex justify-between text-sm px-4"
              >
                <span>Set {s.setNumber}</span>
                <span>
                  <span
                    className={
                      s.teamAScore > s.teamBScore ? "font-semibold" : ""
                    }
                  >
                    {s.teamAScore}
                  </span>
                  {" - "}
                  <span
                    className={
                      s.teamBScore > s.teamAScore ? "font-semibold" : ""
                    }
                  >
                    {s.teamBScore}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Scoring controls */}
        {canScore && match.status === "upcoming" && match.teamA && match.teamB && (
          <Button onClick={handleStart} className="w-full" disabled={loading}>
            Start Match
          </Button>
        )}

        {canScore && match.status === "in_progress" && !setsLocked && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Add Set {newSetNumber}
                <span className="ml-2 font-normal text-muted-foreground">
                  to {targetThisSet}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    type="number"
                    min={0}
                    value={teamAScore}
                    onChange={(e) =>
                      setTeamAScore(parseInt(e.target.value, 10) || 0)
                    }
                    placeholder={match.teamA?.name ?? "A"}
                  />
                </div>
                <span className="text-muted-foreground">-</span>
                <div className="flex-1">
                  <Input
                    type="number"
                    min={0}
                    value={teamBScore}
                    onChange={(e) =>
                      setTeamBScore(parseInt(e.target.value, 10) || 0)
                    }
                    placeholder={match.teamB?.name ?? "B"}
                  />
                </div>
                <Button
                  onClick={handleScoreSubmit}
                  size="sm"
                  disabled={loading}
                >
                  Save
                </Button>
              </div>
            </div>

            <Separator />
            <div className="flex gap-2">
              {match.teamA && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFinalize(match.teamA!.id)}
                  disabled={loading}
                >
                  {match.teamA.name} Wins
                </Button>
              )}
              {match.teamB && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFinalize(match.teamB!.id)}
                  disabled={loading}
                >
                  {match.teamB.name} Wins
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
