import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const panelDirectory = path.join(
  process.cwd(),
  "src",
  "app",
  "(dashboard)",
  "tournaments",
  "[slug]",
  "panels"
);

const bracketPanel = readFileSync(
  path.join(panelDirectory, "bracket-panel.tsx"),
  "utf8"
);
const poolPlayPanel = readFileSync(
  path.join(panelDirectory, "pool-play-panel.tsx"),
  "utf8"
);
const bracketStructure = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "lib",
    "tournaments",
    "bracket-structure.ts"
  ),
  "utf8"
);

describe("tournament render paths", () => {
  it("keeps the bracket panel free of bracket mutations", () => {
    for (const helper of [
      "ensureDivisionBracketSkeleton",
      "ensureTournamentCombinedBrackets",
      "repairBracketWinnerAdvances",
      "tryFillBracketFromDivisionSeeds",
      "tryFillTournamentCombinedBrackets",
    ]) {
      assert.doesNotMatch(bracketPanel, new RegExp(`\\b${helper}\\b`));
    }
  });

  it("keeps the pool-play panel free of bracket mutations", () => {
    assert.doesNotMatch(
      poolPlayPanel,
      /\bensureDivisionBracketSkeleton\b/
    );
  });

  it("keeps the bracket regenerate-state query read-only", () => {
    const start = bracketStructure.indexOf(
      "export async function tournamentCombinedBracketsRegenerateState"
    );
    const end = bracketStructure.indexOf(
      "\nasync function clearTournamentCombinedBracketTrees",
      start
    );
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const stateQuery = bracketStructure.slice(start, end);
    assert.doesNotMatch(stateQuery, /\bensure[A-Z]\w*\b/);
    assert.doesNotMatch(stateQuery, /\.(?:insert|update|delete)\(/);
  });
});
