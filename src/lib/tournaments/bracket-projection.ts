/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export type GraphActivation = "required" | "conditional" | "not_required";
export type GraphMatchStatus = "upcoming" | "in_progress" | "completed";
export type GraphOutcome = "winner" | "loser";
export type GraphTargetSlot = "team_a" | "team_b";
export type GraphCondition = "always" | "source_team_b_wins";

export interface GraphMatchState {
  id: string;
  activation: GraphActivation;
  status: GraphMatchStatus;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
}

export interface GraphEdge {
  sourceMatchId: string;
  sourceOutcome: GraphOutcome;
  targetMatchId: string;
  targetSlot: GraphTargetSlot;
  condition: GraphCondition;
}

interface GraphOutcomePossibilities {
  winner: boolean;
  loser: boolean;
  canHaveTwoParticipants: boolean;
}

function outcomeTeam(
  source: GraphMatchState,
  outcome: GraphOutcome
): string | null {
  if (source.status !== "completed" || !source.winnerId) return null;
  if (outcome === "winner") return source.winnerId;
  if (source.winnerId === source.teamAId) return source.teamBId;
  if (source.winnerId === source.teamBId) return source.teamAId;
  return null;
}

function isResolved(match: GraphMatchState): boolean {
  return match.status === "completed" || match.activation === "not_required";
}

function conditionMatches(edge: GraphEdge, source: GraphMatchState): boolean {
  if (edge.condition === "always") return true;
  return (
    source.status === "completed" &&
    source.teamBId !== null &&
    source.winnerId === source.teamBId
  );
}

function topologicalOrder(
  matches: GraphMatchState[],
  edges: GraphEdge[]
): string[] {
  const index = new Map(matches.map((match, position) => [match.id, position]));
  const indegree = new Map(matches.map((match) => [match.id, 0]));
  const targets = new Map<string, string[]>();

  for (const edge of edges) {
    if (!indegree.has(edge.sourceMatchId) || !indegree.has(edge.targetMatchId)) {
      throw new Error("Bracket graph references a missing match.");
    }
    indegree.set(edge.targetMatchId, indegree.get(edge.targetMatchId)! + 1);
    const list = targets.get(edge.sourceMatchId) ?? [];
    list.push(edge.targetMatchId);
    targets.set(edge.sourceMatchId, list);
  }

  const ready = matches
    .filter((match) => indegree.get(match.id) === 0)
    .map((match) => match.id);
  const ordered: string[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const sourceId = ready.shift()!;
    ordered.push(sourceId);
    for (const targetId of targets.get(sourceId) ?? []) {
      const next = indegree.get(targetId)! - 1;
      indegree.set(targetId, next);
      if (next === 0) ready.push(targetId);
    }
  }

  if (ordered.length !== matches.length) {
    throw new Error("Bracket graph contains a cycle.");
  }
  return ordered;
}

function settleParticipants(
  match: GraphMatchState,
  allInputsResolved: boolean,
  canHaveTwoParticipants: boolean
): GraphMatchState {
  if (!allInputsResolved) {
    return {
      ...match,
      activation: canHaveTwoParticipants ? "required" : "conditional",
      status: "upcoming",
      winnerId: null,
    };
  }

  const participants = [match.teamAId, match.teamBId].filter(
    (teamId): teamId is string => teamId !== null
  );
  if (participants.length === 0) {
    return {
      ...match,
      activation: "not_required",
      status: "upcoming",
      winnerId: null,
    };
  }
  if (participants.length === 1) {
    return {
      ...match,
      activation: "required",
      status: "completed",
      winnerId: participants[0],
    };
  }
  return { ...match, activation: "required" };
}

function projectConditionalMatch(
  match: GraphMatchState,
  inputs: GraphEdge[],
  stateById: Map<string, GraphMatchState>
): GraphMatchState {
  const sources = inputs.map((edge) => stateById.get(edge.sourceMatchId)!);
  if (!sources.every(isResolved)) {
    return {
      ...match,
      activation: "conditional",
      status: "upcoming",
      teamAId: null,
      teamBId: null,
      winnerId: null,
    };
  }
  if (!inputs.every((edge, index) => conditionMatches(edge, sources[index]))) {
    return {
      ...match,
      activation: "not_required",
      status: "upcoming",
      teamAId: null,
      teamBId: null,
      winnerId: null,
    };
  }
  let teamAId: string | null = null;
  let teamBId: string | null = null;
  for (let index = 0; index < inputs.length; index++) {
    const teamId = outcomeTeam(sources[index], inputs[index].sourceOutcome);
    if (inputs[index].targetSlot === "team_a") teamAId = teamId;
    else teamBId = teamId;
  }
  return settleParticipants(
    {
      ...match,
      activation: "required",
      teamAId,
      teamBId,
    },
    true,
    teamAId !== null && teamBId !== null
  );
}

function projectFedMatch(
  match: GraphMatchState,
  inputs: GraphEdge[],
  stateById: Map<string, GraphMatchState>,
  canHaveTwoParticipants: boolean
): GraphMatchState {
  let teamAId: string | null = null;
  let teamBId: string | null = null;
  let allInputsResolved = true;

  for (const edge of inputs) {
    const source = stateById.get(edge.sourceMatchId)!;
    if (!isResolved(source)) {
      allInputsResolved = false;
      continue;
    }
    const teamId = outcomeTeam(source, edge.sourceOutcome);
    if (edge.targetSlot === "team_a") teamAId = teamId;
    else teamBId = teamId;
  }

  return settleParticipants(
    { ...match, teamAId, teamBId },
    allInputsResolved,
    canHaveTwoParticipants
  );
}

function possibleOutcomes(
  match: GraphMatchState,
  inputs: GraphEdge[],
  possibilitiesById: Map<string, GraphOutcomePossibilities>
): GraphOutcomePossibilities {
  let teamAPossible = match.teamAId !== null;
  let teamBPossible = match.teamBId !== null;

  if (inputs.length > 0) {
    teamAPossible = false;
    teamBPossible = false;
    for (const edge of inputs) {
      const source = possibilitiesById.get(edge.sourceMatchId)!;
      const conditionPossible =
        edge.condition === "always" || source.canHaveTwoParticipants;
      const outcomePossible =
        edge.sourceOutcome === "winner" ? source.winner : source.loser;
      if (!conditionPossible || !outcomePossible) continue;
      if (edge.targetSlot === "team_a") teamAPossible = true;
      else teamBPossible = true;
    }
  }

  return {
    winner: teamAPossible || teamBPossible,
    loser: teamAPossible && teamBPossible,
    canHaveTwoParticipants: teamAPossible && teamBPossible,
  };
}

/**
 * Materialize team slots and automatic walkovers from an explicit bracket DAG.
 * Input arrays are never mutated.
 */
export function projectBracketGraph(
  matches: GraphMatchState[],
  edges: GraphEdge[]
): Map<string, GraphMatchState> {
  const stateById = new Map(
    matches.map((match) => [match.id, { ...match }])
  );
  const inputsByTarget = new Map<string, GraphEdge[]>();
  const possibilitiesById = new Map<string, GraphOutcomePossibilities>();
  for (const edge of edges) {
    const list = inputsByTarget.get(edge.targetMatchId) ?? [];
    list.push(edge);
    inputsByTarget.set(edge.targetMatchId, list);
  }

  for (const matchId of topologicalOrder(matches, edges)) {
    const current = stateById.get(matchId)!;
    const inputs = inputsByTarget.get(matchId) ?? [];
    const possibilities = possibleOutcomes(
      current,
      inputs,
      possibilitiesById
    );
    possibilitiesById.set(matchId, possibilities);
    let projected: GraphMatchState;

    if (inputs.length === 0) {
      projected = settleParticipants(
        current,
        true,
        possibilities.canHaveTwoParticipants
      );
    } else if (inputs.some((edge) => edge.condition !== "always")) {
      projected = projectConditionalMatch(current, inputs, stateById);
    } else {
      projected = projectFedMatch(
        current,
        inputs,
        stateById,
        possibilities.canHaveTwoParticipants
      );
    }
    stateById.set(matchId, projected);
  }

  return stateById;
}
