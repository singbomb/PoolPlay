import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBracketRoundLabel,
  formatBracketRulesSummary,
} from "./bracket-labels";

describe("formatBracketRoundLabel", () => {
  it("keeps traditional single-elimination stage names", () => {
    assert.equal(
      formatBracketRoundLabel({ section: "main", round: 3, maxRound: 3 }),
      "Final"
    );
    assert.equal(
      formatBracketRoundLabel({ section: "main", round: 1, maxRound: 3 }),
      "Quarterfinals"
    );
  });

  it("distinguishes winners and losers rounds", () => {
    assert.equal(
      formatBracketRoundLabel({ section: "winners", round: 2, maxRound: 3 }),
      "Winners Semifinals"
    );
    assert.equal(
      formatBracketRoundLabel({ section: "losers", round: 2 }),
      "Losers Round 2"
    );
  });

  it("names both championship matches explicitly", () => {
    assert.equal(
      formatBracketRoundLabel({ section: "grand_final", round: 1 }),
      "Grand Final"
    );
    assert.equal(
      formatBracketRoundLabel({ section: "grand_final", round: 2 }),
      "Reset Final"
    );
  });
});

describe("formatBracketRulesSummary", () => {
  it("explains the selected elimination format", () => {
    assert.match(
      formatBracketRulesSummary({
        playFormat: "double_elimination",
        bracketCount: 1,
        goldTeamCount: null,
        silverTeamCount: null,
      }),
      /two losses/
    );
    assert.match(
      formatBracketRulesSummary({
        playFormat: "single_elimination",
        bracketCount: 1,
        goldTeamCount: null,
        silverTeamCount: null,
      }),
      /One loss/
    );
  });

  it("keeps tier details for pool-to-bracket play", () => {
    assert.match(
      formatBracketRulesSummary({
        playFormat: "pool_to_bracket",
        bracketCount: 2,
        goldTeamCount: 8,
        silverTeamCount: null,
      }),
      /Gold \(8 teams\) and Silver/
    );
  });
});
