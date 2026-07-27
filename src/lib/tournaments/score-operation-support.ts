/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  matchScoreEvents,
  matches,
  pools,
  schoolMembers,
  teamMembers,
  tournaments,
  users,
} from "@/lib/db/schema";
import {
  advanceBracketWinner,
  tryFillBracketFromPoolPlay,
} from "@/lib/tournaments/bracket-structure";
import {
  OperationConflictError,
  OperationValidationError,
  assertExpectedRevision,
  assertParticipantWinner,
} from "@/lib/tournaments/competition-operation-rules";
import { tryCompleteTournamentWhenBracketsDone } from "@/lib/tournaments/tournament-completion";

export type DbClient = typeof db;
export type MatchStatus = "upcoming" | "in_progress" | "completed";

export type LockedMatch = {
  id: string;
  tournamentId: string;
  tournamentStatus: string;
  organizerId: string;
  hostSchoolId: string | null;
  poolId: string | null;
  divisionId: string | null;
  bracketId: string | null;
  bracketRound: number | null;
  bracketPosition: number | null;
  teamAId: string | null;
  teamBId: string | null;
  refTeamId: string | null;
  winnerId: string | null;
  status: MatchStatus;
  warmupStartedAt: Date | null;
  startedAt: Date | null;
  scoreRevision: number;
  matchFormat: "play_all_3" | "best_of_2" | "two_with_tiebreak";
  setTargetScore: number;
  tiebreakTargetScore: number;
};

export type ScoreEventInput = {
  matchId: string;
  revision: number;
  actorUserId: string;
  eventType:
    | "set_score_saved"
    | "match_finalized"
    | "match_reopened"
    | "downstream_invalidated"
    | "warmup_started"
    | "match_started"
    | "match_paused";
  setNumber?: number;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  correctionReason?: string;
};

async function lockTournamentAndMatch(
  matchId: string,
  executor: DbClient
): Promise<void> {
  const [identity] = await executor
    .select({ tournamentId: matches.tournamentId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!identity) throw new OperationValidationError("Match not found.");

  await executor.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${identity.tournamentId}
    FOR UPDATE
  `);
  await executor.execute(sql`
    SELECT id
    FROM ${matches}
    WHERE ${matches.id} = ${matchId}
    FOR UPDATE
  `);
}

export async function loadLockedMatch(
  matchId: string,
  executor: DbClient
): Promise<LockedMatch> {
  await lockTournamentAndMatch(matchId, executor);
  const [row] = await executor
    .select({
      id: matches.id,
      tournamentId: matches.tournamentId,
      tournamentStatus: tournaments.status,
      organizerId: tournaments.organizerId,
      hostSchoolId: tournaments.hostSchoolId,
      poolId: matches.poolId,
      divisionId: pools.divisionId,
      bracketId: matches.bracketId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      refTeamId: matches.refTeamId,
      winnerId: matches.winnerId,
      status: matches.status,
      warmupStartedAt: matches.warmupStartedAt,
      startedAt: matches.startedAt,
      scoreRevision: matches.scoreRevision,
      matchFormat: tournaments.matchFormat,
      setTargetScore: tournaments.setTargetScore,
      tiebreakTargetScore: tournaments.tiebreakTargetScore,
    })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .leftJoin(pools, eq(matches.poolId, pools.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw new OperationValidationError("Match not found.");
  return row;
}

async function actorIsCurrentOrganizer(
  match: LockedMatch,
  actorUserId: string,
  actorRole: string,
  executor: DbClient
): Promise<boolean> {
  if (match.organizerId === actorUserId || actorRole === "admin") {
    return true;
  }
  if (!match.hostSchoolId) return false;
  const [officer] = await executor
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, match.hostSchoolId),
        eq(schoolMembers.userId, actorUserId),
        or(
          eq(schoolMembers.role, "president"),
          eq(schoolMembers.role, "officer")
        )
      )
    )
    .for("share")
    .limit(1);
  return officer != null;
}

async function actorIsCurrentRefMember(
  match: LockedMatch,
  actorUserId: string,
  executor: DbClient
): Promise<boolean> {
  if (match.tournamentStatus !== "in_progress" || !match.refTeamId) {
    return false;
  }
  const [membership] = await executor
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, match.refTeamId),
        eq(teamMembers.userId, actorUserId)
      )
    )
    .for("share")
    .limit(1);
  return membership != null;
}

export async function assertActorCanMutateLockedMatch(
  match: LockedMatch,
  actorUserId: string,
  executor: DbClient,
  organizerOnly = false
): Promise<void> {
  const [actor] = await executor
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actorUserId))
    .for("share")
    .limit(1);
  if (!actor || actor.disabledAt != null) {
    throw new OperationValidationError(
      "Your account is no longer allowed to control this match."
    );
  }
  if (
    await actorIsCurrentOrganizer(
      match,
      actorUserId,
      actor.role,
      executor
    )
  ) {
    return;
  }
  if (
    !organizerOnly &&
    await actorIsCurrentRefMember(match, actorUserId, executor)
  ) {
    return;
  }
  throw new OperationValidationError(
    organizerOnly
      ? "Only the current organizer can reopen this match."
      : "You no longer have permission to control this match."
  );
}

export async function insertScoreEvent(
  executor: DbClient,
  input: ScoreEventInput
): Promise<void> {
  await executor.insert(matchScoreEvents).values({
    matchId: input.matchId,
    revision: input.revision,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    setNumber: input.setNumber,
    previousValue: input.previousValue,
    newValue: input.newValue,
    correctionReason: input.correctionReason,
  });
}

export type MatchLifecycleAction = "warmup" | "start" | "pause";

type MatchLifecycleInput = {
  matchId: string;
  action: MatchLifecycleAction;
  expectedRevision: number;
  actorUserId: string;
};

type LifecycleMutation = {
  status?: MatchStatus;
  warmupStartedAt?: Date | null;
  startedAt?: Date | null;
};

function assertLifecycleTransition(
  match: LockedMatch,
  input: MatchLifecycleInput
): void {
  assertExpectedRevision(match.scoreRevision, input.expectedRevision);
  if (match.tournamentStatus !== "in_progress") {
    throw new OperationValidationError(
      "Match lifecycle can only change while the tournament is in progress."
    );
  }
  if (!match.teamAId || !match.teamBId) {
    throw new OperationValidationError(
      "Both teams must be assigned before changing the match lifecycle."
    );
  }
  if (
    input.action === "warmup" &&
    (match.status !== "upcoming" ||
      match.warmupStartedAt !== null ||
      match.startedAt !== null)
  ) {
    throw new OperationConflictError(
      "Warmup can only start before the match begins.",
      match.scoreRevision
    );
  }
  if (input.action === "start" && match.status !== "upcoming") {
    throw new OperationConflictError(
      match.status === "completed"
        ? "This match is already completed."
        : "This match has already started.",
      match.scoreRevision
    );
  }
  if (input.action === "pause" && match.status !== "in_progress") {
    throw new OperationConflictError(
      "Only an in-progress match can be paused.",
      match.scoreRevision
    );
  }
}

function lifecycleMutation(
  match: LockedMatch,
  action: MatchLifecycleAction,
  now: Date
): LifecycleMutation {
  if (action === "warmup") {
    return { warmupStartedAt: now };
  }
  if (action === "start") {
    return {
      status: "in_progress",
      startedAt: match.startedAt ?? now,
      warmupStartedAt: match.warmupStartedAt ?? now,
    };
  }
  return {
    status: "upcoming",
    warmupStartedAt: null,
    startedAt: match.startedAt ?? now,
  };
}

function lifecycleSnapshot(match: {
  status: MatchStatus;
  warmupStartedAt: Date | null;
  startedAt: Date | null;
}): Record<string, unknown> {
  return {
    status: match.status,
    warmupStartedAt: match.warmupStartedAt?.toISOString() ?? null,
    startedAt: match.startedAt?.toISOString() ?? null,
  };
}

const lifecycleEventType: Record<
  MatchLifecycleAction,
  "warmup_started" | "match_started" | "match_paused"
> = {
  warmup: "warmup_started",
  start: "match_started",
  pause: "match_paused",
};

async function transitionMatchLifecycleInsideTransaction(
  input: MatchLifecycleInput,
  executor: DbClient
): Promise<{ nextRevision: number }> {
  const match = await loadLockedMatch(input.matchId, executor);
  await assertActorCanMutateLockedMatch(
    match,
    input.actorUserId,
    executor
  );
  assertLifecycleTransition(match, input);
  const now = new Date();
  const mutation = lifecycleMutation(match, input.action, now);
  const nextRevision = match.scoreRevision + 1;
  const [updated] = await executor
    .update(matches)
    .set({
      ...mutation,
      scoreRevision: nextRevision,
      updatedAt: now,
    })
    .where(
      and(
        eq(matches.id, match.id),
        eq(matches.scoreRevision, match.scoreRevision)
      )
    )
    .returning({ id: matches.id });
  if (!updated) {
    throw new OperationConflictError(
      "This match changed on another device. Refresh and try again.",
      match.scoreRevision
    );
  }
  await insertScoreEvent(executor, {
    matchId: match.id,
    revision: nextRevision,
    actorUserId: input.actorUserId,
    eventType: lifecycleEventType[input.action],
    previousValue: lifecycleSnapshot(match),
    newValue: lifecycleSnapshot({ ...match, ...mutation }),
  });
  return { nextRevision };
}

export async function transitionMatchLifecycleTransactional(
  input: MatchLifecycleInput
): Promise<{ nextRevision: number }> {
  return db.transaction((tx) =>
    transitionMatchLifecycleInsideTransaction(
      input,
      tx as unknown as DbClient
    )
  );
}

async function updateMatchAsCompleted(
  match: LockedMatch,
  winnerId: string | null,
  executor: DbClient
): Promise<number> {
  const nextRevision = match.scoreRevision + 1;
  const [updated] = await executor
    .update(matches)
    .set({
      status: "completed",
      winnerId,
      scoreRevision: nextRevision,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(matches.id, match.id),
        eq(matches.scoreRevision, match.scoreRevision),
        ne(matches.status, "completed")
      )
    )
    .returning({ id: matches.id });
  if (!updated) {
    throw new OperationConflictError(
      "This match was completed on another device. Refresh to see the result."
    );
  }
  return nextRevision;
}

export async function finalizeLockedMatch(
  match: LockedMatch,
  winnerId: string | null,
  actorUserId: string,
  executor: DbClient
): Promise<number> {
  assertParticipantWinner(
    winnerId,
    match.teamAId,
    match.teamBId,
    match.matchFormat === "best_of_2"
  );
  const nextRevision = await updateMatchAsCompleted(
    match,
    winnerId,
    executor
  );
  await insertScoreEvent(executor, {
    matchId: match.id,
    revision: nextRevision,
    actorUserId,
    eventType: "match_finalized",
    previousValue: { status: match.status, winnerId: match.winnerId },
    newValue: { status: "completed", winnerId },
  });

  await advanceBracketWinner(match.id, executor);
  if (match.divisionId) {
    await tryFillBracketFromPoolPlay(match.divisionId, executor);
  }
  await tryCompleteTournamentWhenBracketsDone(match.tournamentId, executor);
  return nextRevision;
}
