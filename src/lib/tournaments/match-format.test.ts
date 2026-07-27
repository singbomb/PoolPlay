import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMatchScoreState,
  evaluateMatchOutcome,
  matchFormatForMatch,
} from "./match-format";

describe("matchFormatForMatch", () => {
  it("keeps best-of-two ties for pool matches", () => {
    assert.equal(
      matchFormatForMatch("best_of_2", { bracketId: null }),
      "best_of_2"
    );
  });

  it("adds a deciding tiebreak for elimination matches", () => {
    const format = matchFormatForMatch("best_of_2", {
      bracketId: "bracket-1",
    });
    assert.equal(format, "two_with_tiebreak");

    const split = evaluateMatchOutcome(
      { format },
      "team-a",
      "team-b",
      [
        { teamAScore: 25, teamBScore: 20 },
        { teamAScore: 20, teamBScore: 25 },
      ]
    );
    assert.equal(split.shouldFinalize, false);

    const decided = evaluateMatchOutcome(
      { format },
      "team-a",
      "team-b",
      [
        { teamAScore: 25, teamBScore: 20 },
        { teamAScore: 20, teamBScore: 25 },
        { teamAScore: 15, teamBScore: 10 },
      ]
    );
    assert.equal(decided.winnerId, "team-a");
    assert.equal(decided.shouldFinalize, true);
  });

  it("counts only completed sets in bracket score summaries", () => {
    const partial = buildMatchScoreState(
      {
        format: "two_with_tiebreak",
        targetScore: 25,
        tiebreakTargetScore: 15,
      },
      [
        { teamAScore: 25, teamBScore: 20 },
        { teamAScore: 24, teamBScore: 23 },
      ]
    );
    assert.equal(partial.setsWonA, 1);
    assert.equal(partial.setsWonB, 0);

    const deuce = buildMatchScoreState(
      {
        format: "two_with_tiebreak",
        targetScore: 25,
        tiebreakTargetScore: 15,
      },
      [{ teamAScore: 26, teamBScore: 25 }]
    );
    assert.equal(deuce.setsWonA, 0);
    assert.equal(deuce.setsWonB, 0);
  });
});
