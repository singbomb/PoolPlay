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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateDoubleEliminationTopology,
  type DoubleEliminationEdge,
  type DoubleEliminationMatchNode,
  type DoubleEliminationTopology,
} from "./double-elimination-topology";

const expectedByTeamCount = new Map([
  [2, { bracketSize: 2, winners: 1, losers: 0, total: 3 }],
  [3, { bracketSize: 4, winners: 3, losers: 2, total: 7 }],
  [4, { bracketSize: 4, winners: 3, losers: 2, total: 7 }],
  [5, { bracketSize: 8, winners: 7, losers: 6, total: 15 }],
  [8, { bracketSize: 8, winners: 7, losers: 6, total: 15 }],
]);

const openingSeedsByBracketSize = new Map([
  [2, [[1, 2]]],
  [4, [[1, 4], [2, 3]]],
  [8, [[1, 8], [4, 5], [2, 7], [3, 6]]],
]);

function nodeByKey(
  topology: DoubleEliminationTopology,
  key: string
): DoubleEliminationMatchNode {
  const node = topology.nodes.find((candidate) => candidate.key === key);
  assert.ok(node, `Missing topology node ${key}`);
  return node;
}

function inboundEdges(
  topology: DoubleEliminationTopology,
  targetKey: string
): DoubleEliminationEdge[] {
  return topology.edges.filter((edge) => edge.targetKey === targetKey);
}

function seedAncestry(
  topology: DoubleEliminationTopology,
  key: string,
  cache = new Map<string, Set<number>>()
): Set<number> {
  const cached = cache.get(key);
  if (cached) return cached;

  const node = nodeByKey(topology, key);
  const seeds = new Set(
    [node.seedA, node.seedB].filter(
      (seed): seed is number => seed !== null
    )
  );
  for (const edge of inboundEdges(topology, key)) {
    for (const seed of seedAncestry(topology, edge.sourceKey, cache)) {
      seeds.add(seed);
    }
  }
  cache.set(key, seeds);
  return seeds;
}

describe("generateDoubleEliminationTopology", () => {
  for (const [teamCount, expected] of expectedByTeamCount) {
    it(`builds the expected ${teamCount}-team structure`, () => {
      const topology = generateDoubleEliminationTopology(teamCount);
      const winners = topology.nodes.filter(
        (node) => node.section === "winners"
      );
      const losers = topology.nodes.filter(
        (node) => node.section === "losers"
      );

      assert.equal(topology.bracketSize, expected.bracketSize);
      assert.equal(winners.length, expected.winners);
      assert.equal(losers.length, expected.losers);
      assert.equal(topology.nodes.length, expected.total);
      assert.equal(
        topology.edges.length,
        expected.total * 2 - expected.bracketSize
      );
    });
  }

  it("rejects invalid team counts", () => {
    assert.throws(
      () => generateDoubleEliminationTopology(1),
      /requires at least 2 teams/
    );
    assert.throws(
      () => generateDoubleEliminationTopology(2.5),
      /requires at least 2 teams/
    );
  });

  it("uses stable, unique keys and section-aware coordinates", () => {
    const topology = generateDoubleEliminationTopology(8);
    const keys = topology.nodes.map((node) => node.key);
    const coordinates = topology.nodes.map(
      (node) => `${node.section}:${node.round}:${node.position}`
    );

    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(coordinates).size, coordinates.length);
    assert.deepEqual(
      generateDoubleEliminationTopology(8),
      topology
    );
  });

  it("gives every match exactly two input slots", () => {
    for (const teamCount of expectedByTeamCount.keys()) {
      const topology = generateDoubleEliminationTopology(teamCount);

      for (const node of topology.nodes) {
        const edges = inboundEdges(topology, node.key);
        if (node.section === "winners" && node.round === 1) {
          assert.notEqual(node.seedA, null);
          assert.notEqual(node.seedB, null);
          assert.equal(edges.length, 0);
          continue;
        }

        assert.equal(node.seedA, null);
        assert.equal(node.seedB, null);
        assert.deepEqual(
          edges.map((edge) => edge.targetSlot).sort(),
          ["A", "B"]
        );
      }
    }
  });

  it("orders every source before its target", () => {
    for (const teamCount of expectedByTeamCount.keys()) {
      const topology = generateDoubleEliminationTopology(teamCount);
      const indexByKey = new Map(
        topology.nodes.map((node, index) => [node.key, index])
      );

      for (const edge of topology.edges) {
        const sourceIndex = indexByKey.get(edge.sourceKey);
        const targetIndex = indexByKey.get(edge.targetKey);
        assert.notEqual(sourceIndex, undefined);
        assert.notEqual(targetIndex, undefined);
        assert.ok(sourceIndex! < targetIndex!);
      }
    }
  });

  it("places every full-draw seed once in standard opening matchups", () => {
    for (const [teamCount, expected] of expectedByTeamCount) {
      const topology = generateDoubleEliminationTopology(teamCount);
      const opening = topology.nodes.filter(
        (node) => node.section === "winners" && node.round === 1
      );
      const actualPairs = opening.map((node) => [node.seedA, node.seedB]);
      const expectedPairs = openingSeedsByBracketSize.get(
        expected.bracketSize
      );

      assert.deepEqual(actualPairs, expectedPairs);
      const seeds = actualPairs.flat().sort((a, b) => a! - b!);
      assert.deepEqual(
        seeds,
        Array.from({ length: expected.bracketSize }, (_, index) => index + 1)
      );
      assert.equal(
        seeds.filter((seed) => seed! > teamCount).length,
        expected.bracketSize - teamCount
      );
    }
  });

  it("routes each source outcome at most once", () => {
    for (const teamCount of expectedByTeamCount.keys()) {
      const topology = generateDoubleEliminationTopology(teamCount);
      const outputs = topology.edges.map(
        (edge) => `${edge.sourceKey}:${edge.outcome}`
      );
      assert.equal(new Set(outputs).size, outputs.length);
    }
  });

  it("crosses winners-bracket losers away from immediate rematches", () => {
    for (const teamCount of [5, 8]) {
      const topology = generateDoubleEliminationTopology(teamCount);
      const evenLosersRounds = topology.nodes.filter(
        (node) =>
          node.section === "losers" &&
          node.round % 2 === 0 &&
          topology.nodes.filter(
            (candidate) =>
              candidate.section === "losers" &&
              candidate.round === node.round
          ).length > 1
      );

      for (const target of evenLosersRounds) {
        const incoming = inboundEdges(topology, target.key);
        const survivor = incoming.find((edge) =>
          edge.sourceKey.startsWith("L")
        );
        const drop = incoming.find((edge) =>
          edge.sourceKey.startsWith("W")
        );
        assert.ok(survivor);
        assert.ok(drop);

        const survivorSeeds = seedAncestry(topology, survivor.sourceKey);
        const dropSeeds = seedAncestry(topology, drop.sourceKey);
        const overlap = [...survivorSeeds].filter((seed) =>
          dropSeeds.has(seed)
        );
        assert.deepEqual(overlap, []);
      }
    }
  });

  it("models the grand-final reset as a team-B-win condition", () => {
    for (const teamCount of expectedByTeamCount.keys()) {
      const topology = generateDoubleEliminationTopology(teamCount);
      const gf1 = nodeByKey(topology, "GF1");
      const gf2 = nodeByKey(topology, "GF2");

      assert.equal(gf1.activation, "required");
      assert.equal(gf2.activation, "conditional");
      assert.deepEqual(
        inboundEdges(topology, "GF2")
          .map((edge) => ({
            sourceKey: edge.sourceKey,
            outcome: edge.outcome,
            targetSlot: edge.targetSlot,
            condition: edge.condition,
          }))
          .sort((a, b) => a.targetSlot.localeCompare(b.targetSlot)),
        [
          {
            sourceKey: "GF1",
            outcome: "loser",
            targetSlot: "A",
            condition: "source_team_b_wins",
          },
          {
            sourceKey: "GF1",
            outcome: "winner",
            targetSlot: "B",
            condition: "source_team_b_wins",
          },
        ]
      );
    }
  });

  it("feeds the two-team loser directly into GF1", () => {
    const topology = generateDoubleEliminationTopology(2);
    assert.deepEqual(
      inboundEdges(topology, "GF1"),
      [
        {
          sourceKey: "W1-M1",
          outcome: "winner",
          targetKey: "GF1",
          targetSlot: "A",
          condition: "always",
        },
        {
          sourceKey: "W1-M1",
          outcome: "loser",
          targetKey: "GF1",
          targetSlot: "B",
          condition: "always",
        },
      ]
    );
  });
});
