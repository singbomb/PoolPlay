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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format as formatDate } from "date-fns";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Minus,
  Pause,
  Plus,
  Play,
  SkipForward,
  Timer,
  Trophy,
  MapPin,
  Clock,
  Users,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  buildMatchScoreState,
  matchPhase,
  targetForSet,
  type MatchPhase,
} from "@/lib/tournaments/match-format";
import {
  formatMatchFormatLabel,
  type MatchFormat,
} from "@/lib/labels/match-format";
import {
  warmupPhasesForFormat,
  type WarmupFormat,
  type WarmupPhase,
  type WarmupTeamKey,
} from "@/lib/labels/warmup-format";
import {
  startWarmup,
  startMatch,
  pauseMatch,
  saveSetScore,
  finalizeMatch,
  reopenMatch,
} from "../actions";
import { MatchStartTimeEditor } from "../match-start-time-editor";

interface ConsoleMatch {
  id: string;
  status: string;
  scheduledTime: string | null;
  warmupStartedAt: string | null;
  startedAt: string | null;
  winnerId: string | null;
  scoreRevision: number;
  teamA: { id: string; name: string } | null;
  teamB: { id: string; name: string } | null;
  refTeamName: string | null;
  courtName: string | null;
  sets: { setNumber: number; teamAScore: number; teamBScore: number }[];
}

interface ConsoleSettings {
  matchFormat: MatchFormat;
  setStartingScore: number;
  setTargetScore: number;
  tiebreakTargetScore: number;
  warmupFormat: WarmupFormat;
}

const SAVE_DEBOUNCE_MS = 1000;

export function MatchConsole({
  slug,
  tournamentDate,
  match,
  settings,
  canControl,
  isOrganizer,
  isRefMember,
}: {
  slug: string;
  tournamentId: string;
  tournamentDate: string;
  match: ConsoleMatch;
  settings: ConsoleSettings;
  canControl: boolean;
  isOrganizer: boolean;
  isRefMember: boolean;
}) {
  const router = useRouter();

  const phase: MatchPhase = matchPhase({
    status: match.status,
    warmupStartedAt: match.warmupStartedAt
      ? new Date(match.warmupStartedAt)
      : null,
    startedAt: match.startedAt ? new Date(match.startedAt) : null,
  });

  const scoreState = buildMatchScoreState(
    {
      format: settings.matchFormat,
      targetScore: settings.setTargetScore,
      tiebreakTargetScore: settings.tiebreakTargetScore,
    },
    match.sets.map((s) => ({
      teamAScore: s.teamAScore,
      teamBScore: s.teamBScore,
    }))
  );

  const liveSetNumber = scoreState.currentSetNumber;
  const startingScore = settings.setStartingScore;

  const teamAName = match.teamA?.name ?? "TBD";
  const teamBName = match.teamB?.name ?? "TBD";
  const hasTeams = Boolean(match.teamA && match.teamB);

  const [busy, setBusy] = useState(false);
  const scoreRevisionRef = useRef(match.scoreRevision);
  /** Local only: which side is left/right for the ref's view of the court. */
  const [sidesFlipped, setSidesFlipped] = useState(false);
  /** Explicit past-set selection; null means follow the live set automatically. */
  const [pastSetSelection, setPastSetSelection] = useState<{
    matchId: string;
    setNumber: number;
  } | null>(null);
  const handleScoreRevisionChange = useCallback((revision: number) => {
    scoreRevisionRef.current = revision;
  }, []);

  useEffect(() => {
    scoreRevisionRef.current = match.scoreRevision;
  }, [match.scoreRevision]);

  const activeSetNumber =
    pastSetSelection?.matchId === match.id &&
    pastSetSelection.setNumber < liveSetNumber
      ? Math.max(pastSetSelection.setNumber, 1)
      : liveSetNumber;
  const selectSet = (setNumber: number) => {
    setPastSetSelection(
      setNumber < liveSetNumber ? { matchId: match.id, setNumber } : null
    );
  };
  const activeSet = match.sets.find((s) => s.setNumber === activeSetNumber);
  const activeTarget = targetForSet(
    {
      format: settings.matchFormat,
      targetScore: settings.setTargetScore,
      tiebreakTargetScore: settings.tiebreakTargetScore,
    },
    activeSetNumber
  );
  const storedA = activeSet?.teamAScore ?? startingScore;
  const storedB = activeSet?.teamBScore ?? startingScore;
  const editingPastSet = activeSetNumber < liveSetNumber;

  const leftName = sidesFlipped ? teamBName : teamAName;
  const rightName = sidesFlipped ? teamAName : teamBName;
  const leftSetsWon = sidesFlipped
    ? scoreState.setsWonB
    : scoreState.setsWonA;
  const rightSetsWon = sidesFlipped
    ? scoreState.setsWonA
    : scoreState.setsWonB;
  const leftWinner =
    match.winnerId === (sidesFlipped ? match.teamB?.id : match.teamA?.id);
  const rightWinner =
    match.winnerId === (sidesFlipped ? match.teamA?.id : match.teamB?.id);

  // ── Realtime: keep spectators (and the other team) in sync ──────────────
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`match-${match.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sets",
          filter: `match_id=eq.${match.id}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `id=eq.${match.id}`,
        },
        refresh
      )
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [match.id, router]);

  async function runLifecycle(
    fn: () => Promise<
      {
        error?: string | null;
        success?: true;
        nextRevision?: number;
      } | undefined
    >
  ) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    if (result?.nextRevision != null) {
      scoreRevisionRef.current = result.nextRevision;
    }
    router.refresh();
  }

  function requestCorrection() {
    const reason = window.prompt(
      "Why is this match being reopened? This note will be saved in the score history."
    );
    if (!reason?.trim()) return;
    void runLifecycle(() =>
      reopenMatch(match.id, scoreRevisionRef.current, reason)
    );
  }

  const winnerName =
    match.winnerId === match.teamA?.id
      ? teamAName
      : match.winnerId === match.teamB?.id
        ? teamBName
        : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-xl">
              {teamAName} <span className="text-muted-foreground">vs</span>{" "}
              {teamBName}
            </CardTitle>
            <StatusBadge
              kind="match"
              status={
                phase === "warmup"
                  ? "in_progress"
                  : phase === "paused"
                    ? "paused"
                    : match.status
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {match.courtName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {match.courtName}
              </span>
            )}
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {isOrganizer ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground/80">Scheduled</span>
                  <MatchStartTimeEditor
                    matchId={match.id}
                    scheduledTime={match.scheduledTime}
                    tournamentDate={tournamentDate}
                  />
                </span>
              ) : (
                match.scheduledTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Scheduled{" "}
                    {formatDate(new Date(match.scheduledTime), "h:mm a")}
                  </span>
                )
              )}
              {match.startedAt && (
                <span className="flex items-center gap-1 text-foreground/80">
                  <Play className="h-3.5 w-3.5" />
                  Started{" "}
                  {formatDate(new Date(match.startedAt), "h:mm a")}
                </span>
              )}
            </span>
            {match.refTeamName && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Ref: {match.refTeamName}
              </span>
            )}
            <span>
              {formatMatchFormatLabel(settings.matchFormat)} · to{" "}
              {settings.setTargetScore}
              {settings.matchFormat === "two_with_tiebreak" &&
                ` (3rd to ${settings.tiebreakTargetScore})`}
            </span>
          </div>
          {isRefMember && (
            <p className="text-xs font-medium text-info">
              You&apos;re on the working/ref team for this match — you can run
              warmup, start play, and keep score.
            </p>
          )}
        </CardHeader>
      </Card>

      {/* Lifecycle / scorekeeper — live score sits above sets */}
      {phase === "completed" ? (
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <Trophy className="mx-auto h-8 w-8 text-info" />
            <p className="text-lg font-semibold">
              {winnerName ? `${winnerName} wins` : "Match complete (tie)"}
            </p>
            {isOrganizer && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={requestCorrection}
              >
                <RotateCcw className="h-4 w-4" />
                Reopen for corrections
              </Button>
            )}
          </CardContent>
        </Card>
      ) : !canControl ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {phase === "warmup"
              ? "Warmup in progress."
              : phase === "in_progress"
                ? "Match in progress — scores update live."
                : phase === "paused"
                  ? "Match is paused. Scores are saved until the ref resumes."
                  : "Waiting for the ref team or host to start the match."}
          </CardContent>
        </Card>
      ) : phase === "paused" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              Match paused. Set scores are saved.
            </p>
            <Button
              disabled={busy || !hasTeams}
              onClick={() =>
                void runLifecycle(() =>
                  startMatch(match.id, scoreRevisionRef.current)
                )
              }
            >
              <Play className="h-4 w-4" />
              Resume match
            </Button>
          </CardContent>
        </Card>
      ) : phase === "upcoming" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:justify-center">
            <Button
              disabled={busy || !hasTeams}
              onClick={() =>
                void runLifecycle(() =>
                  startWarmup(match.id, scoreRevisionRef.current)
                )
              }
            >
              <Timer className="h-4 w-4" />
              Start warmup
            </Button>
            <Button
              variant="outline"
              disabled={busy || !hasTeams}
              onClick={() =>
                void runLifecycle(() =>
                  startMatch(match.id, scoreRevisionRef.current)
                )
              }
            >
              <Play className="h-4 w-4" />
              Start match
            </Button>
          </CardContent>
        </Card>
      ) : phase === "warmup" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6">
            <WarmupTimer
              format={settings.warmupFormat}
              teamAName={teamAName}
              teamBName={teamBName}
            />
            <Button
              disabled={busy}
              onClick={() =>
                void runLifecycle(() =>
                  startMatch(match.id, scoreRevisionRef.current)
                )
              }
            >
              <Play className="h-4 w-4" />
              Start match
            </Button>
          </CardContent>
        </Card>
      ) : (
        // in_progress + canControl → scorekeeper
        <Card>
          <Scorekeeper
            key={`${match.id}-${activeSetNumber}-${match.scoreRevision}`}
            matchId={match.id}
            setNumber={activeSetNumber}
            liveSetNumber={liveSetNumber}
            target={activeTarget}
            initialA={storedA}
            initialB={storedB}
            teamAName={teamAName}
            teamBName={teamBName}
            sidesFlipped={sidesFlipped}
            onFlipSides={() => setSidesFlipped((f) => !f)}
            onSelectSet={selectSet}
            editingPastSet={editingPastSet}
            initialRevision={match.scoreRevision}
            onRevisionChange={handleScoreRevisionChange}
          />
          <CardContent className="space-y-4 pt-0">
            <Separator />

            <div className="space-y-2">
              <p className="text-center text-xs text-muted-foreground">
                Pause play or record the result
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void runLifecycle(() =>
                      pauseMatch(match.id, scoreRevisionRef.current)
                    )
                  }
                >
                  <Pause className="h-4 w-4" />
                  Pause match
                </Button>
                {match.teamA && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runLifecycle(() =>
                        finalizeMatch(
                          match.id,
                          match.teamA!.id,
                          scoreRevisionRef.current
                        )
                      )
                    }
                  >
                    {teamAName} wins
                  </Button>
                )}
                {match.teamB && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runLifecycle(() =>
                        finalizeMatch(
                          match.id,
                          match.teamB!.id,
                          scoreRevisionRef.current
                        )
                      )
                    }
                  >
                    {teamBName} wins
                  </Button>
                )}
                {settings.matchFormat === "best_of_2" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runLifecycle(() =>
                        finalizeMatch(
                          match.id,
                          null,
                          scoreRevisionRef.current
                        )
                      )
                    }
                  >
                    Record tie
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sets won — below live score */}
      <Card>
        <CardContent className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] items-center gap-2 py-6 sm:gap-4">
          <ScoreColumn
            name={leftName}
            value={leftSetsWon}
            highlight={leftWinner}
          />
          <div className="flex w-full flex-col items-center gap-1">
            <span className="text-sm text-muted-foreground">sets</span>
            {canControl && phase !== "completed" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-full gap-1 px-1.5 text-xs"
                aria-label="Flip team sides"
                title="Flip left/right to match the court"
                onClick={() => setSidesFlipped((f) => !f)}
              >
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                Flip
              </Button>
            ) : (
              <span className="h-7" aria-hidden />
            )}
          </div>
          <ScoreColumn
            name={rightName}
            value={rightSetsWon}
            highlight={rightWinner}
          />
        </CardContent>
      </Card>

      {/* Set tracker */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Set tracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {scoreState.tracker.map((entry) => {
            const leftScore = sidesFlipped
              ? entry.teamBScore
              : entry.teamAScore;
            const rightScore = sidesFlipped
              ? entry.teamAScore
              : entry.teamBScore;
            const selectable =
              canControl &&
              phase === "in_progress" &&
              entry.setNumber <= liveSetNumber;
            const selected =
              phase === "in_progress" &&
              canControl &&
              entry.setNumber === activeSetNumber;
            const isLive =
              entry.setNumber === liveSetNumber && phase !== "completed";
            return (
              <button
                key={entry.setNumber}
                type="button"
                disabled={!selectable}
                onClick={() => selectSet(entry.setNumber)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  selected
                    ? "bg-primary/10 ring-1 ring-primary/20"
                    : "bg-muted/40",
                  selectable && !selected && "hover:bg-muted/70",
                  !selectable && "cursor-default"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">Set {entry.setNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    to {entry.target}
                  </span>
                  {selected && (
                    <span className="text-xs font-medium text-primary">
                      {editingPastSet ? "editing" : "current"}
                    </span>
                  )}
                  {!selected && isLive && (
                    <span className="text-xs font-medium text-muted-foreground">
                      live
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  <span
                    className={cn(
                      entry.complete && leftScore > rightScore && "font-semibold"
                    )}
                  >
                    {leftScore}
                  </span>
                  {" – "}
                  <span
                    className={cn(
                      entry.complete && rightScore > leftScore && "font-semibold"
                    )}
                  >
                    {rightScore}
                  </span>
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Live +/-1 scorekeeper for the current set. Keyed by set number in the parent
 * so it remounts (and reseeds) whenever play advances to a new set. Debounces
 * writes so rapid taps collapse into a single save.
 */
function Scorekeeper({
  matchId,
  setNumber,
  liveSetNumber,
  target,
  initialA,
  initialB,
  teamAName,
  teamBName,
  sidesFlipped,
  onFlipSides,
  onSelectSet,
  editingPastSet,
  initialRevision,
  onRevisionChange,
}: {
  matchId: string;
  setNumber: number;
  liveSetNumber: number;
  target: number;
  initialA: number;
  initialB: number;
  teamAName: string;
  teamBName: string;
  sidesFlipped: boolean;
  onFlipSides: () => void;
  onSelectSet: (setNumber: number) => void;
  editingPastSet: boolean;
  initialRevision: number;
  onRevisionChange: (revision: number) => void;
}) {
  const router = useRouter();
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(initialRevision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) {
      revisionRef.current = initialRevision;
    }
  }, [initialRevision]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setSaving(true);
        const fd = new FormData();
        fd.set("matchId", matchId);
        fd.set("setNumber", String(setNumber));
        fd.set("teamAScore", String(a));
        fd.set("teamBScore", String(b));
        fd.set("expectedRevision", String(revisionRef.current));
        const result = await saveSetScore(fd);
        setSaving(false);
        if (result?.error) {
          toast.error(result.error);
          dirtyRef.current = false;
          router.refresh();
          return;
        }
        if (result?.nextRevision == null) {
          toast.error("Could not confirm the saved score. Refresh and try again.");
          dirtyRef.current = false;
          router.refresh();
          return;
        }
        revisionRef.current = result.nextRevision;
        onRevisionChange(result.nextRevision);
        dirtyRef.current = false;
        router.refresh();
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    a,
    b,
    matchId,
    onRevisionChange,
    router,
    setNumber,
  ]);

  function bump(team: "a" | "b", delta: number) {
    if (saving) return;
    dirtyRef.current = true;
    if (team === "a") setA((prev) => Math.max(0, prev + delta));
    else setB((prev) => Math.max(0, prev + delta));
  }

  const left = sidesFlipped
    ? { name: teamBName, value: b, team: "b" as const }
    : { name: teamAName, value: a, team: "a" as const };
  const right = sidesFlipped
    ? { name: teamAName, value: a, team: "a" as const }
    : { name: teamBName, value: b, team: "b" as const };

  return (
    <>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">
            Set {setNumber} · to {target}
          </CardTitle>
          {editingPastSet && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Editing a previous set
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Previous set"
              disabled={setNumber <= 1}
              onClick={() => onSelectSet(setNumber - 1)}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Next set"
              disabled={setNumber >= liveSetNumber}
              onClick={() => onSelectSet(setNumber + 1)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-label="Flip team sides"
            title="Flip left/right to match the court"
            onClick={onFlipSides}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Flip sides
          </Button>
          <span className="text-xs text-muted-foreground">
            {saving ? "Saving…" : "Saved"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <Stepper
              name={left.name}
              value={left.value}
              onBump={(d) => bump(left.team, d)}
              disabled={saving}
            />
          </div>
          <div className="min-w-0">
            <Stepper
              name={right.name}
              value={right.value}
              onBump={(d) => bump(right.team, d)}
              disabled={saving}
            />
          </div>
        </div>
        {editingPastSet && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => onSelectSet(liveSetNumber)}
            >
              Back to live set {liveSetNumber}
            </Button>
          </div>
        )}
      </CardContent>
    </>
  );
}

function ScoreColumn({
  name,
  value,
  highlight,
}: {
  name: string;
  value: number;
  highlight: boolean;
}) {
  return (
    <div className="min-w-0 w-full text-center">
      <p
        className={cn(
          "font-heading text-4xl font-bold tabular-nums leading-none",
          highlight && "text-primary"
        )}
      >
        {value}
      </p>
      <p
        className="mt-1.5 truncate px-1 text-xs text-muted-foreground"
        title={name}
      >
        {name}
      </p>
    </div>
  );
}

function Stepper({
  name,
  value,
  onBump,
  disabled = false,
}: {
  name: string;
  value: number;
  onBump: (delta: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 rounded-lg border bg-muted/30 p-3">
      <p
        className="h-5 w-full truncate px-1 text-center text-sm font-medium leading-5"
        title={name}
      >
        {name}
      </p>
      <p className="font-heading text-5xl font-bold tabular-nums leading-none">
        {value}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Decrease ${name} score`}
          onClick={() => onBump(-1)}
          disabled={disabled || value <= 0}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          aria-label={`Increase ${name} score`}
          onClick={() => onBump(1)}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatCountdown(totalSeconds: number): string {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Phased on-court warmup clock. Each team runs hitting then serving; order is
 * chosen after rock-paper-scissors. Pause / play / next / reset are local to
 * the ref console.
 */
function WarmupTimer({
  format,
  teamAName,
  teamBName,
}: {
  format: WarmupFormat;
  teamAName: string;
  teamBName: string;
}) {
  const [firstTeam, setFirstTeam] = useState<WarmupTeamKey>("a");
  const phases = warmupPhasesForFormat(
    format,
    teamAName,
    teamBName,
    firstTeam
  );
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => phases[0]?.durationSeconds ?? 0
  );
  const [running, setRunning] = useState(false);

  function goToPhase(index: number, autoplay: boolean) {
    const nextPhases = warmupPhasesForFormat(
      format,
      teamAName,
      teamBName,
      firstTeam
    );
    if (nextPhases.length === 0) {
      setPhaseIndex(0);
      setRemainingSeconds(0);
      setRunning(false);
      return;
    }
    const clamped = Math.min(Math.max(index, 0), nextPhases.length - 1);
    setPhaseIndex(clamped);
    setRemainingSeconds(nextPhases[clamped].durationSeconds);
    setRunning(autoplay);
  }

  useEffect(() => {
    goToPhase(0, false);
    // Reset when format, names, or order change — always start paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, teamAName, teamBName, firstTeam]);

  useEffect(() => {
    if (!running || phases.length === 0) return;
    const id = setInterval(() => {
      setRemainingSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [running, phases.length, phaseIndex]);

  useEffect(() => {
    if (remainingSeconds > 0 || phases.length === 0 || !running) return;
    if (phaseIndex < phases.length - 1) {
      const next = phaseIndex + 1;
      setPhaseIndex(next);
      setRemainingSeconds(phases[next].durationSeconds);
      return;
    }
    setRunning(false);
  }, [remainingSeconds, phaseIndex, phases, running]);

  if (phases.length === 0) {
    return (
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Warmup
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          No warmup configured for this tournament.
        </p>
      </div>
    );
  }

  const phase: WarmupPhase = phases[phaseIndex] ?? phases[phases.length - 1];
  const complete =
    !running && phaseIndex === phases.length - 1 && remainingSeconds <= 0;

  const teamBlocks: { key: WarmupTeamKey; name: string; indices: number[] }[] =
    (() => {
      const order: WarmupTeamKey[] =
        firstTeam === "a" ? ["a", "b"] : ["b", "a"];
      return order.map((key) => {
        const indices = phases
          .map((p, i) => (p.teamKey === key ? i : -1))
          .filter((i) => i >= 0);
        return {
          key,
          name: key === "a" ? teamAName : teamBName,
          indices,
        };
      });
    })();

  function selectFirstTeam(team: WarmupTeamKey) {
    if (team === firstTeam) return;
    setFirstTeam(team);
  }

  function reset() {
    goToPhase(0, false);
  }

  function nextPhase() {
    if (phaseIndex >= phases.length - 1) {
      setRemainingSeconds(0);
      setRunning(false);
      return;
    }
    goToPhase(phaseIndex + 1, running);
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <div className="w-full space-y-2">
        <p className="text-center text-xs text-muted-foreground">
          Who won rock-paper-scissors? They warm up first.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={firstTeam === "a" ? "default" : "outline"}
            size="sm"
            className="h-auto min-h-9 whitespace-normal px-2 py-1.5 text-xs"
            onClick={() => selectFirstTeam("a")}
          >
            <span className="line-clamp-2">{teamAName} first</span>
          </Button>
          <Button
            type="button"
            variant={firstTeam === "b" ? "default" : "outline"}
            size="sm"
            className="h-auto min-h-9 whitespace-normal px-2 py-1.5 text-xs"
            onClick={() => selectFirstTeam("b")}
          >
            <span className="line-clamp-2">{teamBName} first</span>
          </Button>
        </div>
      </div>

      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Warmup · {phaseIndex + 1} of {phases.length}
        </p>
        <p className="mt-1 text-sm font-medium">{phase.label}</p>
        <p
          className={cn(
            "font-heading text-5xl font-bold tabular-nums",
            complete && "text-muted-foreground"
          )}
        >
          {formatCountdown(complete ? 0 : remainingSeconds)}
        </p>
        {complete && (
          <p className="mt-1 text-xs text-muted-foreground">Warmup complete</p>
        )}
      </div>

      <div className="grid w-full gap-2 sm:grid-cols-2">
        {teamBlocks.map((block, blockIndex) => (
          <div
            key={block.key}
            className={cn(
              "rounded-md border border-border/70 p-2",
              block.indices.includes(phaseIndex) && !complete
                ? "border-primary/40 bg-primary/5"
                : "bg-muted/20"
            )}
          >
            <p className="mb-1.5 truncate text-xs font-medium">
              {blockIndex === 0 ? "1st" : "2nd"} · {block.name}
            </p>
            <ol className="space-y-1">
              {block.indices.map((i) => {
                const p = phases[i];
                const active = i === phaseIndex && !complete;
                const done = i < phaseIndex || complete;
                return (
                  <li
                    key={`${p.label}-${i}`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px]",
                      active
                        ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                        : done
                          ? "border-border/50 bg-muted/40 text-muted-foreground"
                          : "border-border/50 text-muted-foreground"
                    )}
                  >
                    <span className="capitalize">{p.activity}</span>
                    <span className="tabular-nums">
                      {formatCountdown(p.durationSeconds)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={running ? "Pause warmup timer" : "Play warmup timer"}
          disabled={complete}
          onClick={() => setRunning((r) => !r)}
        >
          {running ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next warmup phase"
          disabled={complete}
          onClick={nextPhase}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Reset warmup timer"
          onClick={reset}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
