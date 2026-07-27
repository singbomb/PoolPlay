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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignBracketTiers,
  rankTeamsForCombinedBrackets,
} from "./combined-bracket-standings";

describe("rankTeamsForCombinedBrackets", () => {
  it("groups by pool place then cross-pool tiebreaks", () => {
    const poolA = [
      { teamId: "a1", place: 1, wins: 2, pointDiff: 10, seed: 1 },
      { teamId: "a2", place: 2, wins: 1, pointDiff: 0, seed: 2 },
    ];
    const poolB = [
      { teamId: "b1", place: 1, wins: 3, pointDiff: 15, seed: 1 },
      { teamId: "b2", place: 2, wins: 0, pointDiff: -5, seed: 2 },
    ];

    assert.deepEqual(rankTeamsForCombinedBrackets([poolA, poolB]), [
      "b1",
      "a1",
      "a2",
      "b2",
    ]);
  });
});

describe("assignBracketTiers", () => {
  it("splits teams into gold and silver", () => {
    const ranked = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const tiers = assignBracketTiers(ranked, 2, 4, null);
    assert.equal(tiers.get("t1")?.tierName, "Gold");
    assert.equal(tiers.get("t4")?.tierName, "Gold");
    assert.equal(tiers.get("t5")?.tierName, "Silver");
    assert.equal(tiers.get("t1")?.seed, 1);
    assert.equal(tiers.get("t5")?.seed, 1);
    assert.equal(tiers.get("t6")?.seed, 2);
  });
});
