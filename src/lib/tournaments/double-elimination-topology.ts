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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

export type DoubleEliminationSection =
  | "winners"
  | "losers"
  | "grand_final";

export type DoubleEliminationActivation = "required" | "conditional";

export type DoubleEliminationOutcome = "winner" | "loser";

export type DoubleEliminationTargetSlot = "A" | "B";

export type DoubleEliminationEdgeCondition =
  | "always"
  | "source_team_b_wins";

export interface DoubleEliminationMatchNode {
  /** Stable identifier, e.g. W2-M1, L3-M1, GF1, or GF2. */
  key: string;
  section: DoubleEliminationSection;
  round: number;
  position: number;
  activation: DoubleEliminationActivation;
  /** Full-draw seed numbers. Seeds above teamCount represent byes. */
  seedA: number | null;
  seedB: number | null;
}

export interface DoubleEliminationEdge {
  sourceKey: string;
  outcome: DoubleEliminationOutcome;
  targetKey: string;
  targetSlot: DoubleEliminationTargetSlot;
  condition: DoubleEliminationEdgeCondition;
}

export interface DoubleEliminationTopology {
  teamCount: number;
  bracketSize: number;
  winnerRoundCount: number;
  nodes: DoubleEliminationMatchNode[];
  edges: DoubleEliminationEdge[];
}

type TopologyParts = Pick<DoubleEliminationTopology, "nodes" | "edges">;

function winnersKey(round: number, position: number): string {
  return `W${round}-M${position}`;
}

function losersKey(round: number, position: number): string {
  return `L${round}-M${position}`;
}

function bracketSizeForTeamCount(teamCount: number): number {
  let bracketSize = 2;
  while (bracketSize < teamCount) bracketSize *= 2;
  return bracketSize;
}

function standardSeedOrder(bracketSize: number): number[] {
  if (bracketSize === 1) return [1];
  const half = standardSeedOrder(bracketSize / 2);
  return half.flatMap((seed) => [seed, bracketSize + 1 - seed]);
}

function matchNode(
  key: string,
  section: DoubleEliminationSection,
  round: number,
  position: number,
  activation: DoubleEliminationActivation = "required",
  seedA: number | null = null,
  seedB: number | null = null
): DoubleEliminationMatchNode {
  return { key, section, round, position, activation, seedA, seedB };
}

function addEdge(
  parts: TopologyParts,
  sourceKey: string,
  outcome: DoubleEliminationOutcome,
  targetKey: string,
  targetSlot: DoubleEliminationTargetSlot,
  condition: DoubleEliminationEdgeCondition = "always"
): void {
  parts.edges.push({
    sourceKey,
    outcome,
    targetKey,
    targetSlot,
    condition,
  });
}

function addWinnersBracket(
  parts: TopologyParts,
  bracketSize: number,
  winnerRoundCount: number
): void {
  const seeds = standardSeedOrder(bracketSize);
  const openingMatchCount = bracketSize / 2;

  for (let position = 1; position <= openingMatchCount; position++) {
    parts.nodes.push(
      matchNode(
        winnersKey(1, position),
        "winners",
        1,
        position,
        "required",
        seeds[(position - 1) * 2],
        seeds[(position - 1) * 2 + 1]
      )
    );
  }

  for (let round = 2; round <= winnerRoundCount; round++) {
    const matchCount = bracketSize / 2 ** round;
    for (let position = 1; position <= matchCount; position++) {
      const targetKey = winnersKey(round, position);
      parts.nodes.push(
        matchNode(targetKey, "winners", round, position)
      );
      addEdge(
        parts,
        winnersKey(round - 1, position * 2 - 1),
        "winner",
        targetKey,
        "A"
      );
      addEdge(
        parts,
        winnersKey(round - 1, position * 2),
        "winner",
        targetKey,
        "B"
      );
    }
  }
}

/** Cross an incoming winners-bracket loser into the neighboring path. */
function crossoverPosition(position: number, matchCount: number): number {
  if (matchCount === 1) return 1;
  return position % 2 === 1 ? position + 1 : position - 1;
}

function addFirstLosersRound(
  parts: TopologyParts,
  bracketSize: number
): void {
  const matchCount = bracketSize / 4;
  for (let position = 1; position <= matchCount; position++) {
    const targetKey = losersKey(1, position);
    parts.nodes.push(matchNode(targetKey, "losers", 1, position));
    addEdge(
      parts,
      winnersKey(1, position * 2 - 1),
      "loser",
      targetKey,
      "A"
    );
    addEdge(
      parts,
      winnersKey(1, position * 2),
      "loser",
      targetKey,
      "B"
    );
  }
}

function addLosersStage(
  parts: TopologyParts,
  bracketSize: number,
  winnerRoundCount: number,
  stage: number
): void {
  const evenRound = stage * 2;
  const matchCount = bracketSize / 2 ** (stage + 1);

  for (let position = 1; position <= matchCount; position++) {
    const targetKey = losersKey(evenRound, position);
    parts.nodes.push(
      matchNode(targetKey, "losers", evenRound, position)
    );
    addEdge(
      parts,
      losersKey(evenRound - 1, position),
      "winner",
      targetKey,
      "A"
    );
    addEdge(
      parts,
      winnersKey(
        stage + 1,
        crossoverPosition(position, matchCount)
      ),
      "loser",
      targetKey,
      "B"
    );
  }

  if (stage >= winnerRoundCount - 1) return;
  addLosersConsolidationRound(parts, evenRound + 1, matchCount / 2);
}

function addLosersConsolidationRound(
  parts: TopologyParts,
  round: number,
  matchCount: number
): void {
  for (let position = 1; position <= matchCount; position++) {
    const targetKey = losersKey(round, position);
    parts.nodes.push(matchNode(targetKey, "losers", round, position));
    addEdge(
      parts,
      losersKey(round - 1, position * 2 - 1),
      "winner",
      targetKey,
      "A"
    );
    addEdge(
      parts,
      losersKey(round - 1, position * 2),
      "winner",
      targetKey,
      "B"
    );
  }
}

function addLosersBracket(
  parts: TopologyParts,
  bracketSize: number,
  winnerRoundCount: number
): string | null {
  if (winnerRoundCount === 1) return null;

  addFirstLosersRound(parts, bracketSize);
  for (let stage = 1; stage < winnerRoundCount; stage++) {
    addLosersStage(parts, bracketSize, winnerRoundCount, stage);
  }
  return losersKey((winnerRoundCount - 1) * 2, 1);
}

function addGrandFinals(
  parts: TopologyParts,
  winnerRoundCount: number,
  losersFinalKey: string | null
): void {
  const winnersFinalKey = winnersKey(winnerRoundCount, 1);
  parts.nodes.push(matchNode("GF1", "grand_final", 1, 1));
  parts.nodes.push(
    matchNode("GF2", "grand_final", 2, 1, "conditional")
  );

  addEdge(parts, winnersFinalKey, "winner", "GF1", "A");
  addEdge(
    parts,
    losersFinalKey ?? winnersFinalKey,
    losersFinalKey ? "winner" : "loser",
    "GF1",
    "B"
  );
  addEdge(
    parts,
    "GF1",
    "loser",
    "GF2",
    "A",
    "source_team_b_wins"
  );
  addEdge(
    parts,
    "GF1",
    "winner",
    "GF2",
    "B",
    "source_team_b_wins"
  );
}

/**
 * Build a complete, deterministic double-elimination DAG.
 *
 * The graph is padded to a power of two. Consumers resolve seeds greater than
 * teamCount as byes, then propagate zero- or one-team matches as automatic
 * advances. GF2 activates only when the losers-bracket entrant wins GF1.
 */
export function generateDoubleEliminationTopology(
  teamCount: number
): DoubleEliminationTopology {
  if (!Number.isSafeInteger(teamCount) || teamCount < 2) {
    throw new RangeError("Double elimination requires at least 2 teams.");
  }

  const bracketSize = bracketSizeForTeamCount(teamCount);
  const winnerRoundCount = Math.log2(bracketSize);
  const parts: TopologyParts = { nodes: [], edges: [] };

  addWinnersBracket(parts, bracketSize, winnerRoundCount);
  const losersFinalKey = addLosersBracket(
    parts,
    bracketSize,
    winnerRoundCount
  );
  addGrandFinals(parts, winnerRoundCount, losersFinalKey);

  return {
    teamCount,
    bracketSize,
    winnerRoundCount,
    nodes: parts.nodes,
    edges: parts.edges,
  };
}
