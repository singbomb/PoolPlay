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
  allActiveBracketsHaveChampions,
  allActiveBracketsMatchCurrentRoster,
  allCompetitionDivisionsHaveChampions,
  bracketHasChampion,
  bracketIsActive,
  bracketMatchesCurrentRoster,
} from "./tournament-completion";

const final = (
  overrides: Partial<{
    status: string;
    winnerId: string | null;
    teamAId: string | null;
    teamBId: string | null;
  }> = {}
) => ({
  bracketRound: 2,
  status: "completed",
  winnerId: "t1",
  teamAId: "t1",
  teamBId: "t2",
  ...overrides,
});

const semi = (position: number) => ({
  bracketRound: 1,
  status: "completed" as const,
  winnerId: "t1",
  teamAId: "t1",
  teamBId: "t3",
  bracketPosition: position,
});

describe("bracketIsActive", () => {
  it("is false for an empty shell", () => {
    assert.equal(
      bracketIsActive([
        { bracketRound: 1, status: "upcoming", winnerId: null, teamAId: null, teamBId: null },
      ]),
      false
    );
  });

  it("is true when any match has a team", () => {
    assert.equal(
      bracketIsActive([
        { bracketRound: 1, status: "upcoming", winnerId: null, teamAId: "t1", teamBId: null },
      ]),
      true
    );
  });
});

describe("bracketHasChampion", () => {
  it("requires a completed final with a winner", () => {
    assert.equal(bracketHasChampion([semi(1), final()]), true);
    assert.equal(
      bracketHasChampion([semi(1), final({ status: "in_progress", winnerId: null })]),
      false
    );
    assert.equal(
      bracketHasChampion([semi(1), final({ winnerId: null })]),
      false
    );
  });

  it("uses the highest bracket round as the final", () => {
    assert.equal(
      bracketHasChampion([
        semi(1),
        { ...final(), bracketRound: 3 },
      ]),
      true
    );
  });

  it("requires the reset final after the losers-side finalist wins GF1", () => {
    const grandFinal = {
      ...final(),
      bracketRound: 1,
      bracketSection: "grand_final",
      teamAId: "winners-team",
      teamBId: "losers-team",
      winnerId: "losers-team",
    };
    const resetFinal = {
      ...final(),
      bracketRound: 2,
      bracketSection: "grand_final",
      bracketActivation: "required",
      status: "upcoming",
      winnerId: null,
    };

    assert.equal(
      bracketHasChampion(
        [grandFinal, resetFinal],
        "double_elimination"
      ),
      false
    );
    assert.equal(
      bracketHasChampion(
        [
          grandFinal,
          {
            ...resetFinal,
            status: "completed",
            winnerId: "winners-team",
          },
        ],
        "double_elimination"
      ),
      true
    );
  });

  it("uses GF1 when the reset final is not required", () => {
    assert.equal(
      bracketHasChampion(
        [
          {
            ...final(),
            bracketRound: 1,
            bracketSection: "grand_final",
          },
          {
            ...final(),
            bracketRound: 2,
            bracketSection: "grand_final",
            bracketActivation: "not_required",
            status: "upcoming",
            winnerId: null,
            teamAId: null,
            teamBId: null,
          },
        ],
        "double_elimination"
      ),
      true
    );
  });

  it("does not complete while the reset condition is unresolved", () => {
    assert.equal(
      bracketHasChampion(
        [
          {
            ...final(),
            bracketRound: 1,
            bracketSection: "grand_final",
          },
          {
            ...final(),
            bracketRound: 2,
            bracketSection: "grand_final",
            bracketActivation: "conditional",
            status: "upcoming",
            winnerId: null,
            teamAId: null,
            teamBId: null,
          },
        ],
        "double_elimination"
      ),
      false
    );
  });
});

describe("allActiveBracketsHaveChampions", () => {
  it("ignores inactive bracket shells", () => {
    assert.equal(
      allActiveBracketsHaveChampions([
        {
          matches: [
            { bracketRound: 1, status: "upcoming", winnerId: null, teamAId: null, teamBId: null },
          ],
        },
        { matches: [semi(1), final()] },
      ]),
      true
    );
  });

  it("requires every active bracket to have a champion", () => {
    assert.equal(
      allActiveBracketsHaveChampions([
        { matches: [semi(1), final()] },
        { matches: [semi(1), final({ status: "upcoming", winnerId: null })] },
      ]),
      false
    );
  });

  it("is false when no brackets are active", () => {
    assert.equal(
      allActiveBracketsHaveChampions([
        {
          matches: [
            { bracketRound: 1, status: "upcoming", winnerId: null, teamAId: null, teamBId: null },
          ],
        },
      ]),
      false
    );
  });
});

describe("allCompetitionDivisionsHaveChampions", () => {
  it("does not finish while another straight-elimination division is unseeded", () => {
    assert.equal(
      allCompetitionDivisionsHaveChampions(
        [
          {
            bracketType: "single_elimination",
            divisionId: "division-a",
            seedCount: 3,
            matches: [semi(1), final()],
          },
          {
            bracketType: "double_elimination",
            divisionId: "division-b",
            seedCount: 0,
            matches: [],
          },
        ],
        new Set(["division-a", "division-b"])
      ),
      false
    );
  });

  it("finishes after every competition-bearing division has a champion", () => {
    assert.equal(
      allCompetitionDivisionsHaveChampions(
        [
          {
            bracketType: "single_elimination",
            divisionId: "division-a",
            seedCount: 3,
            matches: [semi(1), final()],
          },
          {
            bracketType: "single_elimination",
            divisionId: "division-b",
            seedCount: 3,
            matches: [semi(1), final()],
          },
          {
            bracketType: "single_elimination",
            divisionId: "unused-pool-tier",
            seedCount: 0,
            matches: [],
          },
        ],
        new Set(["division-a", "division-b"])
      ),
      true
    );
  });
});

describe("bracketMatchesCurrentRoster", () => {
  const seededBracket = {
    bracketType: "single_elimination",
    divisionId: "division-a",
    seedCount: 3,
    matches: [semi(1), final()],
  };

  it("accepts the exact seeded team set", () => {
    assert.equal(
      bracketMatchesCurrentRoster(
        seededBracket,
        new Set(["t1", "t2", "t3"])
      ),
      true
    );
  });

  it("rejects added, removed, and same-count swapped teams", () => {
    assert.equal(
      bracketMatchesCurrentRoster(
        seededBracket,
        new Set(["t1", "t2", "t3", "t4"])
      ),
      false
    );
    assert.equal(
      bracketMatchesCurrentRoster(seededBracket, new Set(["t1", "t2"])),
      false
    );
    assert.equal(
      bracketMatchesCurrentRoster(
        seededBracket,
        new Set(["t1", "t2", "replacement"])
      ),
      false
    );
    assert.equal(
      bracketMatchesCurrentRoster(seededBracket, new Set(["t1"])),
      false
    );
  });
});

describe("allActiveBracketsMatchCurrentRoster", () => {
  it("rejects any stale active bracket and rosters below two teams", () => {
    const current = {
      bracketType: "single_elimination",
      divisionId: "division-a",
      seedCount: 2,
      matches: [
        {
          bracketRound: 1,
          status: "upcoming",
          winnerId: null,
          teamAId: "t1",
          teamBId: "t2",
        },
      ],
    };
    const stale = {
      ...current,
      matches: [
        {
          bracketRound: 1,
          status: "completed",
          winnerId: "t1",
          teamAId: "t1",
          teamBId: "old-team",
        },
      ],
    };

    assert.equal(
      allActiveBracketsMatchCurrentRoster(
        [current],
        new Set(["t1", "t2"])
      ),
      true
    );
    assert.equal(
      allActiveBracketsMatchCurrentRoster(
        [current, stale],
        new Set(["t1", "t2"])
      ),
      false
    );
    assert.equal(
      allActiveBracketsMatchCurrentRoster([stale], new Set(["t1"])),
      false
    );
  });
});
