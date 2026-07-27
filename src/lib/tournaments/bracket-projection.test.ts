import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectBracketGraph,
  type GraphEdge,
  type GraphMatchState,
} from "./bracket-projection";
import { isActiveMatch } from "./match-visibility";

function match(
  id: string,
  teamAId: string | null = null,
  teamBId: string | null = null
): GraphMatchState {
  return {
    id,
    activation: id === "GF2" ? "conditional" : "required",
    status: "upcoming",
    teamAId,
    teamBId,
    winnerId: null,
  };
}

const resetEdges: GraphEdge[] = [
  {
    sourceMatchId: "GF1",
    sourceOutcome: "loser",
    targetMatchId: "GF2",
    targetSlot: "team_a",
    condition: "source_team_b_wins",
  },
  {
    sourceMatchId: "GF1",
    sourceOutcome: "winner",
    targetMatchId: "GF2",
    targetSlot: "team_b",
    condition: "source_team_b_wins",
  },
];

describe("projectBracketGraph", () => {
  it("propagates automatic walkovers and void paths", () => {
    const matches = [match("A", "team-1"), match("B"), match("C")];
    const edges: GraphEdge[] = [
      {
        sourceMatchId: "A",
        sourceOutcome: "winner",
        targetMatchId: "C",
        targetSlot: "team_a",
        condition: "always",
      },
      {
        sourceMatchId: "B",
        sourceOutcome: "winner",
        targetMatchId: "C",
        targetSlot: "team_b",
        condition: "always",
      },
    ];

    const projected = projectBracketGraph(matches, edges);
    assert.deepEqual(projected.get("A"), {
      ...matches[0],
      status: "completed",
      winnerId: "team-1",
    });
    assert.equal(projected.get("B")?.activation, "not_required");
    assert.deepEqual(projected.get("C"), {
      ...matches[2],
      status: "completed",
      teamAId: "team-1",
      winnerId: "team-1",
    });
  });

  it("waits for every source while exposing resolved slots", () => {
    const first = {
      ...match("A", "team-1", "team-2"),
      status: "completed" as const,
      winnerId: "team-1",
    };
    const projected = projectBracketGraph(
      [first, match("B", "team-3", "team-4"), match("C")],
      [
        {
          sourceMatchId: "A",
          sourceOutcome: "winner",
          targetMatchId: "C",
          targetSlot: "team_a",
          condition: "always",
        },
        {
          sourceMatchId: "B",
          sourceOutcome: "winner",
          targetMatchId: "C",
          targetSlot: "team_b",
          condition: "always",
        },
      ]
    );

    assert.equal(projected.get("C")?.teamAId, "team-1");
    assert.equal(projected.get("C")?.teamBId, null);
    assert.equal(projected.get("C")?.status, "upcoming");
  });

  it("keeps guaranteed walkovers off schedules while their feeder resolves", () => {
    const bye = match("A", "team-1");
    const contest = match("B", "team-2", "team-3");
    const walkover = match("C");
    const edges: GraphEdge[] = [
      {
        sourceMatchId: "A",
        sourceOutcome: "loser",
        targetMatchId: "C",
        targetSlot: "team_a",
        condition: "always",
      },
      {
        sourceMatchId: "B",
        sourceOutcome: "loser",
        targetMatchId: "C",
        targetSlot: "team_b",
        condition: "always",
      },
    ];

    const waiting = projectBracketGraph([bye, contest, walkover], edges);
    assert.equal(waiting.get("C")?.activation, "conditional");
    assert.equal(
      isActiveMatch({
        bracketId: "bracket-1",
        bracketActivation: waiting.get("C")!.activation,
        status: waiting.get("C")!.status,
        teamAId: waiting.get("C")!.teamAId,
        teamBId: waiting.get("C")!.teamBId,
      }),
      false
    );

    const completedContest = {
      ...contest,
      status: "completed" as const,
      winnerId: "team-2",
    };
    const settled = projectBracketGraph(
      [waiting.get("A")!, completedContest, waiting.get("C")!],
      edges
    );
    assert.deepEqual(settled.get("C"), {
      ...walkover,
      activation: "required",
      status: "completed",
      teamBId: "team-3",
      winnerId: "team-3",
    });
    assert.equal(
      isActiveMatch({
        bracketId: "bracket-1",
        bracketActivation: settled.get("C")!.activation,
        status: settled.get("C")!.status,
        teamAId: settled.get("C")!.teamAId,
        teamBId: settled.get("C")!.teamBId,
      }),
      false
    );
  });

  it("skips the reset final when the undefeated finalist wins GF1", () => {
    const gf1 = {
      ...match("GF1", "winners-team", "losers-team"),
      status: "completed" as const,
      winnerId: "winners-team",
    };
    const projected = projectBracketGraph([gf1, match("GF2")], resetEdges);
    assert.equal(projected.get("GF2")?.activation, "not_required");
    assert.equal(projected.get("GF2")?.teamAId, null);
    assert.equal(projected.get("GF2")?.teamBId, null);
  });

  it("activates the reset final when team B wins GF1", () => {
    const gf1 = {
      ...match("GF1", "winners-team", "losers-team"),
      status: "completed" as const,
      winnerId: "losers-team",
    };
    const projected = projectBracketGraph([gf1, match("GF2")], resetEdges);
    assert.equal(projected.get("GF2")?.activation, "required");
    assert.equal(projected.get("GF2")?.teamAId, "winners-team");
    assert.equal(projected.get("GF2")?.teamBId, "losers-team");
    assert.equal(projected.get("GF2")?.status, "upcoming");
  });

  it("rejects cyclic topology", () => {
    assert.throws(
      () =>
        projectBracketGraph(
          [match("A"), match("B")],
          [
            {
              sourceMatchId: "A",
              sourceOutcome: "winner",
              targetMatchId: "B",
              targetSlot: "team_a",
              condition: "always",
            },
            {
              sourceMatchId: "B",
              sourceOutcome: "winner",
              targetMatchId: "A",
              targetSlot: "team_a",
              condition: "always",
            },
          ]
        ),
      /contains a cycle/
    );
  });
});
