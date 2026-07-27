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
import { validateBracketTierSettings } from "./bracket-tiers";

describe("validateBracketTierSettings", () => {
  it("accepts a valid gold and silver split", () => {
    const result = validateBracketTierSettings(10, 2, 6, null);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.tiers, [6, 4]);
  });

  it("rejects gold leaving fewer than 2 teams for silver", () => {
    const result = validateBracketTierSettings(10, 2, 9, null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /at most 8 teams/);
    }
  });

  it("accepts a valid three-tier split", () => {
    const result = validateBracketTierSettings(12, 3, 4, 4);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.tiers, [4, 4, 4]);
  });

  it("rejects gold and silver that leave no bronze teams", () => {
    const result = validateBracketTierSettings(10, 3, 6, 4);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /bronze needs at least 2/);
    }
  });

  it("rejects three brackets when there are too few teams", () => {
    const result = validateBracketTierSettings(5, 3, 2, 2);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /at least 6 teams/);
    }
  });
});
