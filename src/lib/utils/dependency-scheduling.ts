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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

import type {
  ScheduleConstraints,
  ScheduleDependency,
  ScheduleItem,
  ScheduleMatchState,
  ScheduleSlot,
} from "./scheduling";
import { maximumCourtMatching } from "./court-matching";

type EffectivePrerequisite =
  | { kind: "candidate"; matchId: string }
  | { kind: "scheduled"; matchId: string; scheduledTime: Date };

const MINUTE_MS = 60 * 1000;

export class SchedulePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulePlanningError";
  }
}

function assertValidScheduleInputs(
  items: ScheduleItem[],
  startTime: Date,
  matchDurationMinutes: number,
  warmupMinutes: number
): void {
  if (!Number.isFinite(startTime.getTime())) {
    throw new SchedulePlanningError("Choose a valid schedule start time.");
  }
  if (!Number.isFinite(matchDurationMinutes) || matchDurationMinutes <= 0) {
    throw new SchedulePlanningError(
      "Match duration must be greater than zero."
    );
  }
  if (!Number.isFinite(warmupMinutes) || warmupMinutes < 0) {
    throw new SchedulePlanningError("Warmup duration cannot be negative.");
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.matchId)) {
      throw new SchedulePlanningError(
        `Match ${item.matchId} appears more than once in the schedule.`
      );
    }
    seen.add(item.matchId);
    if (item.courtIds.length === 0) {
      throw new SchedulePlanningError(
        `Match ${item.matchId} has no available court.`
      );
    }
  }
}

function assertAcyclicDependencies(
  dependencies: ScheduleDependency[]
): void {
  const targetsBySource = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    const key = `${dependency.sourceMatchId}:${dependency.targetMatchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    indegree.set(
      dependency.sourceMatchId,
      indegree.get(dependency.sourceMatchId) ?? 0
    );
    indegree.set(
      dependency.targetMatchId,
      (indegree.get(dependency.targetMatchId) ?? 0) + 1
    );
    const targets =
      targetsBySource.get(dependency.sourceMatchId) ?? new Set<string>();
    targets.add(dependency.targetMatchId);
    targetsBySource.set(dependency.sourceMatchId, targets);
  }
  const ready = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([matchId]) => matchId)
    .sort();
  let visited = 0;
  while (ready.length > 0) {
    const sourceId = ready.shift()!;
    visited += 1;
    for (const targetId of targetsBySource.get(sourceId) ?? []) {
      const next = indegree.get(targetId)! - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(targetId);
        ready.sort();
      }
    }
  }
  if (visited !== indegree.size) {
    throw new SchedulePlanningError(
      "Cannot auto-schedule because the bracket dependency graph contains a cycle."
    );
  }
}

function normalizedTeams(
  match: Pick<ScheduleMatchState, "teamAId" | "teamBId">
): string[] {
  return [...new Set([match.teamAId, match.teamBId].filter(Boolean))] as string[];
}

function intervalsOverlap(
  playTimeA: number,
  playTimeB: number,
  matchDurationMs: number,
  warmupMs: number
): boolean {
  const startA = playTimeA - warmupMs;
  const endA = playTimeA + matchDurationMs;
  const startB = playTimeB - warmupMs;
  const endB = playTimeB + matchDurationMs;
  return startA < endB && startB < endA;
}

/**
 * Auto-schedules matches across courts while respecting bracket dependencies.
 * Targets wait for an actual later block, not only topological ordering.
 */
export function autoScheduleMatchesWithCourtSets(
  items: ScheduleItem[],
  startTime: Date,
  matchDurationMinutes: number = 30,
  warmupMinutes: number = 0,
  constraints: ScheduleConstraints = {}
): ScheduleSlot[] {
  if (items.length === 0) return [];
  assertValidScheduleInputs(
    items,
    startTime,
    matchDurationMinutes,
    warmupMinutes
  );
  const dependencies = constraints.dependencies ?? [];
  assertAcyclicDependencies(dependencies);
  const candidateById = new Map(
    items.map((item, index) => [
      item.matchId,
      {
        ...item,
        courtIds: [...new Set(item.courtIds)],
        index,
      },
    ])
  );
  const stateById = new Map<string, ScheduleMatchState>();
  for (const state of constraints.matchStates ?? []) {
    if (stateById.has(state.matchId)) {
      throw new SchedulePlanningError(
        `Match ${state.matchId} has duplicate scheduling state.`
      );
    }
    stateById.set(state.matchId, state);
  }
  for (const item of items) {
    if (!stateById.has(item.matchId)) {
      stateById.set(item.matchId, {
        matchId: item.matchId,
        status: "upcoming",
        activation: "required",
        scheduledTime: null,
        courtId: null,
        teamAId: item.teamAId ?? null,
        teamBId: item.teamBId ?? null,
      });
    }
  }

  const incomingByTarget = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (
      !stateById.has(dependency.sourceMatchId) ||
      !stateById.has(dependency.targetMatchId)
    ) {
      throw new SchedulePlanningError(
        "Cannot auto-schedule because a bracket dependency references a missing match."
      );
    }
    const incoming = incomingByTarget.get(dependency.targetMatchId) ?? [];
    if (!incoming.includes(dependency.sourceMatchId)) {
      incoming.push(dependency.sourceMatchId);
      incoming.sort();
      incomingByTarget.set(dependency.targetMatchId, incoming);
    }
  }

  const resolvePrerequisites = (
    sourceId: string,
    path: Set<string>
  ): EffectivePrerequisite[] => {
    if (path.has(sourceId)) {
      throw new SchedulePlanningError(
        "Cannot auto-schedule because the bracket dependency graph contains a cycle."
      );
    }
    const state = stateById.get(sourceId);
    if (!state) {
      throw new SchedulePlanningError(
        "Cannot auto-schedule because a bracket dependency references a missing match."
      );
    }
    if (state.status === "completed") return [];
    if (candidateById.has(sourceId)) {
      return [{ kind: "candidate", matchId: sourceId }];
    }
    if (state.scheduledTime) {
      if (!Number.isFinite(state.scheduledTime.getTime())) {
        throw new SchedulePlanningError(
          `Match ${sourceId} has an invalid scheduled time.`
        );
      }
      return [
        {
          kind: "scheduled",
          matchId: sourceId,
          scheduledTime: state.scheduledTime,
        },
      ];
    }
    const incoming = incomingByTarget.get(sourceId) ?? [];
    const automatic =
      state.activation === "conditional" ||
      state.activation === "not_required" ||
      (state.status === "upcoming" &&
        normalizedTeams(state).length < 2);
    if (automatic && incoming.length > 0) {
      const nextPath = new Set(path);
      nextPath.add(sourceId);
      return incoming.flatMap((matchId) =>
        resolvePrerequisites(matchId, nextPath)
      );
    }
    if (state.activation === "not_required" && incoming.length === 0) {
      return [];
    }
    throw new SchedulePlanningError(
      `Cannot auto-schedule because feeder match ${sourceId} is neither completed nor scheduled.`
    );
  };

  const candidateDependencies = new Map<string, Set<string>>();
  const earliestPlayTime = new Map<string, number>();
  const latestPlayTime = new Map<string, number>();
  const slotMs = (matchDurationMinutes + warmupMinutes) * MINUTE_MS;
  const matchDurationMs = matchDurationMinutes * MINUTE_MS;
  const warmupMs = warmupMinutes * MINUTE_MS;
  const effectiveForTarget = (
    targetId: string
  ): EffectivePrerequisite[] => {
    const deduped = new Map<string, EffectivePrerequisite>();
    for (const sourceId of incomingByTarget.get(targetId) ?? []) {
      for (const prerequisite of resolvePrerequisites(
        sourceId,
        new Set([targetId])
      )) {
        deduped.set(
          `${prerequisite.kind}:${prerequisite.matchId}`,
          prerequisite
        );
      }
    }
    return [...deduped.values()];
  };

  for (const item of items) {
    const candidateIds = new Set<string>();
    let earliest = startTime.getTime() + warmupMs;
    for (const prerequisite of effectiveForTarget(item.matchId)) {
      if (prerequisite.kind === "candidate") {
        candidateIds.add(prerequisite.matchId);
      } else {
        earliest = Math.max(
          earliest,
          prerequisite.scheduledTime.getTime() + slotMs
        );
      }
    }
    candidateDependencies.set(item.matchId, candidateIds);
    earliestPlayTime.set(item.matchId, earliest);
  }
  for (const state of stateById.values()) {
    if (
      candidateById.has(state.matchId) ||
      state.status === "completed" ||
      state.activation === "not_required" ||
      !state.scheduledTime
    ) {
      continue;
    }
    const targetTime = state.scheduledTime.getTime();
    for (const prerequisite of effectiveForTarget(state.matchId)) {
      const latestSourceTime = targetTime - slotMs;
      if (prerequisite.kind === "candidate") {
        latestPlayTime.set(
          prerequisite.matchId,
          Math.min(
            latestPlayTime.get(prerequisite.matchId) ?? Number.POSITIVE_INFINITY,
            latestSourceTime
          )
        );
      } else if (
        prerequisite.scheduledTime.getTime() > latestSourceTime
      ) {
        throw new SchedulePlanningError(
          `Match ${state.matchId} is scheduled before feeder match ${prerequisite.matchId} can finish.`
        );
      }
    }
  }
  let deadlineChanged = true;
  while (deadlineChanged) {
    deadlineChanged = false;
    for (const [targetId, sourceIds] of candidateDependencies) {
      const targetDeadline = latestPlayTime.get(targetId);
      if (targetDeadline == null) continue;
      for (const sourceId of sourceIds) {
        const propagatedDeadline = targetDeadline - slotMs;
        if (
          propagatedDeadline <
          (latestPlayTime.get(sourceId) ?? Number.POSITIVE_INFINITY)
        ) {
          latestPlayTime.set(sourceId, propagatedDeadline);
          deadlineChanged = true;
        }
      }
    }
  }

  const reservations = [...stateById.values()].filter(
    (state) =>
      !candidateById.has(state.matchId) &&
      state.status !== "completed" &&
      state.activation !== "not_required" &&
      state.scheduledTime != null
  );
  const firstPlayTime = startTime.getTime() + warmupMs;
  const scheduledById = new Map<string, ScheduleSlot>();
  const remaining = new Set(items.map((item) => item.matchId));
  const slots: ScheduleSlot[] = [];
  let blockIndex = 0;
  let iterations = 0;
  while (remaining.size > 0) {
    iterations += 1;
    if (iterations > 1_000_000) {
      throw new SchedulePlanningError(
        "Cannot auto-schedule the remaining matches within a practical time range."
      );
    }
    const playTime = firstPlayTime + blockIndex * slotMs;
    const topologicallyReady = [...remaining].filter((matchId) =>
      [...(candidateDependencies.get(matchId) ?? [])].every((sourceId) =>
        scheduledById.has(sourceId)
      )
    );
    if (topologicallyReady.length === 0) {
      throw new SchedulePlanningError(
        "Cannot auto-schedule because the remaining bracket matches have unresolved dependencies."
      );
    }
    for (const matchId of topologicallyReady) {
      for (const sourceId of candidateDependencies.get(matchId) ?? []) {
        const sourceTime = scheduledById.get(sourceId)!.scheduledTime.getTime();
        earliestPlayTime.set(
          matchId,
          Math.max(earliestPlayTime.get(matchId)!, sourceTime + slotMs)
        );
      }
      if ((latestPlayTime.get(matchId) ?? Number.POSITIVE_INFINITY) < playTime) {
        throw new SchedulePlanningError(
          `Cannot schedule match ${matchId} before its already-scheduled downstream match.`
        );
      }
    }
    const ready = topologicallyReady
      .filter((matchId) => earliestPlayTime.get(matchId)! <= playTime)
      .sort((leftId, rightId) => {
        const leftDeadline =
          latestPlayTime.get(leftId) ?? Number.POSITIVE_INFINITY;
        const rightDeadline =
          latestPlayTime.get(rightId) ?? Number.POSITIVE_INFINITY;
        if (leftDeadline !== rightDeadline) {
          return leftDeadline - rightDeadline;
        }
        const left = candidateById.get(leftId)!;
        const right = candidateById.get(rightId)!;
        const courtDifference = left.courtIds.length - right.courtIds.length;
        if (courtDifference !== 0) return courtDifference;
        if (left.index !== right.index) return left.index - right.index;
        return leftId.localeCompare(rightId);
      });
    const teamsUsed = new Set<string>();
    const conflictFreeReady: string[] = [];
    for (const matchId of ready) {
      const item = candidateById.get(matchId)!;
      const teams = normalizedTeams(item);
      if (teams.some((teamId) => teamsUsed.has(teamId))) continue;
      const reservationTeamConflict = reservations.some((reservation) => {
        if (
          !reservation.scheduledTime ||
          !intervalsOverlap(
            playTime,
            reservation.scheduledTime.getTime(),
            matchDurationMs,
            warmupMs
          )
        ) {
          return false;
        }
        const reservationTeams = new Set(normalizedTeams(reservation));
        return teams.some((teamId) => reservationTeams.has(teamId));
      });
      if (reservationTeamConflict) continue;
      conflictFreeReady.push(matchId);
      for (const teamId of teams) teamsUsed.add(teamId);
    }
    const courtByMatch = maximumCourtMatching(
      conflictFreeReady,
      (matchId) => candidateById.get(matchId)!.courtIds,
      (courtId) =>
        !reservations.some(
          (reservation) =>
            reservation.courtId === courtId &&
            reservation.scheduledTime != null &&
            intervalsOverlap(
              playTime,
              reservation.scheduledTime.getTime(),
              matchDurationMs,
              warmupMs
            )
        )
    );
    let scheduledThisBlock = 0;
    for (const matchId of conflictFreeReady) {
      const courtId = courtByMatch.get(matchId);
      if (!courtId) continue;
      const slot = {
        matchId,
        courtId,
        scheduledTime: new Date(playTime),
      };
      slots.push(slot);
      scheduledById.set(matchId, slot);
      remaining.delete(matchId);
      scheduledThisBlock += 1;
    }
    if (scheduledThisBlock === 0) {
      const nextBound = Math.min(
        ...topologicallyReady
          .map((matchId) => earliestPlayTime.get(matchId)!)
          .filter((time) => time > playTime)
      );
      if (Number.isFinite(nextBound)) {
        blockIndex = Math.max(
          blockIndex + 1,
          Math.ceil((nextBound - firstPlayTime) / slotMs)
        );
        continue;
      }
    }
    blockIndex += 1;
  }
  return slots;
}
