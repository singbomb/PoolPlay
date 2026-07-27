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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertChildBelongsToAuthorizedParent,
  assertMatchBelongsToAuthorizedTournament,
  assertScheduledCourtBelongsToMatchTournament,
  assertTeamSchoolAttachmentAuthorized,
} from "./authorization-invariants";

const AUTHORIZATION_DENIED_MESSAGE = "Resource not found or access denied";

function assertAuthorizationDenied(action: () => void): void {
  assert.throws(action, { message: AUTHORIZATION_DENIED_MESSAGE });
}

describe("child-resource authorization invariants", () => {
  it("accepts a child only when its stored parent is the authorized parent", () => {
    assert.doesNotThrow(() =>
      assertChildBelongsToAuthorizedParent({
        childParentId: "team-a",
        authorizedParentId: "team-a",
      })
    );

    assert.doesNotThrow(() =>
      assertChildBelongsToAuthorizedParent({
        childParentId: "team-\u{1F3D0}' OR 1=1 --",
        authorizedParentId: "team-\u{1F3D0}' OR 1=1 --",
      })
    );
  });

  it("rejects cross-parent and missing-parent child mutations", () => {
    for (const childParentId of ["team-b", "", null, undefined]) {
      assertAuthorizationDenied(() =>
        assertChildBelongsToAuthorizedParent({
          childParentId,
          authorizedParentId: "team-a",
        })
      );
    }

    assertAuthorizationDenied(() =>
      assertChildBelongsToAuthorizedParent({
        childParentId: "",
        authorizedParentId: "",
      })
    );
  });
});

describe("match tournament authorization invariants", () => {
  it("accepts a match mutation for its derived tournament", () => {
    assert.doesNotThrow(() =>
      assertMatchBelongsToAuthorizedTournament({
        matchTournamentId: "tournament-a",
        authorizedTournamentId: "tournament-a",
      })
    );
  });

  it("rejects a caller-supplied tournament mismatch or missing match parent", () => {
    for (const matchTournamentId of ["tournament-b", "", null, undefined]) {
      assertAuthorizationDenied(() =>
        assertMatchBelongsToAuthorizedTournament({
          matchTournamentId,
          authorizedTournamentId: "tournament-a",
        })
      );
    }
  });
});

describe("scheduled court authorization invariants", () => {
  it("accepts an unscheduled match or a court in the match tournament", () => {
    for (const courtTournamentId of [
      "tournament-a",
      null,
      undefined,
    ]) {
      assert.doesNotThrow(() =>
        assertScheduledCourtBelongsToMatchTournament({
          matchTournamentId: "tournament-a",
          courtTournamentId,
        })
      );
    }
  });

  it("rejects a scheduled court from another tournament", () => {
    assertAuthorizationDenied(() =>
      assertScheduledCourtBelongsToMatchTournament({
        matchTournamentId: "tournament-a",
        courtTournamentId: "tournament-b",
      })
    );
  });
});

describe("team-to-school authorization invariants", () => {
  it("requires authority over both the team and destination school", () => {
    assert.doesNotThrow(() =>
      assertTeamSchoolAttachmentAuthorized({
        canManageTeam: true,
        canManageSchool: true,
      })
    );

    for (const input of [
      { canManageTeam: true, canManageSchool: false },
      { canManageTeam: false, canManageSchool: true },
      { canManageTeam: false, canManageSchool: false },
    ]) {
      assertAuthorizationDenied(() =>
        assertTeamSchoolAttachmentAuthorized(input)
      );
    }
  });
});
