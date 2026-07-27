import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isActiveMatch, isPlayableMatch } from "./match-visibility";

const poolMatch = {
  bracketId: null,
  bracketActivation: null,
  status: "upcoming",
  teamAId: null,
  teamBId: null,
};

describe("isPlayableMatch", () => {
  it("keeps pool matches while their teams are being assigned", () => {
    assert.equal(isPlayableMatch(poolMatch), true);
  });

  it("keeps required bracket matches with both teams", () => {
    assert.equal(
      isPlayableMatch({
        bracketId: "bracket-1",
        bracketActivation: "required",
        status: "upcoming",
        teamAId: "team-a",
        teamBId: "team-b",
      }),
      true
    );
  });

  it("hides conditional, skipped, and automatic bracket paths", () => {
    for (const bracketActivation of [
      "conditional",
      "not_required",
    ] as const) {
      assert.equal(
        isPlayableMatch({
          bracketId: "bracket-1",
          bracketActivation,
          status: "upcoming",
          teamAId: null,
          teamBId: null,
        }),
        false
      );
    }
    assert.equal(
      isPlayableMatch({
        bracketId: "bracket-1",
        bracketActivation: "required",
        status: "upcoming",
        teamAId: "team-a",
        teamBId: null,
      }),
      false
    );
  });
});

describe("isActiveMatch", () => {
  it("keeps future required rounds on schedules", () => {
    assert.equal(
      isActiveMatch({
        bracketId: "bracket-1",
        bracketActivation: "required",
        status: "upcoming",
        teamAId: null,
        teamBId: null,
      }),
      true
    );
  });

  it("hides conditional and skipped paths from schedules", () => {
    for (const bracketActivation of [
      "conditional",
      "not_required",
    ] as const) {
      assert.equal(
        isActiveMatch({
          bracketId: "bracket-1",
          bracketActivation,
          status: "upcoming",
          teamAId: null,
          teamBId: null,
        }),
        false
      );
    }
  });

  it("hides completed walkovers but keeps completed two-team contests", () => {
    assert.equal(
      isActiveMatch({
        bracketId: "bracket-1",
        bracketActivation: "required",
        status: "completed",
        teamAId: "team-a",
        teamBId: null,
      }),
      false
    );
    assert.equal(
      isActiveMatch({
        bracketId: "bracket-1",
        bracketActivation: "required",
        status: "completed",
        teamAId: "team-a",
        teamBId: "team-b",
      }),
      true
    );
  });
});
