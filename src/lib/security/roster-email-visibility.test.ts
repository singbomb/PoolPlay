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
import { canViewRosterEmail } from "./roster-email-visibility";

describe("roster email visibility", () => {
  it("allows an authorized roster manager to see member emails", () => {
    assert.equal(
      canViewRosterEmail({
        viewerUserId: "manager",
        memberUserId: "member",
        canManageRoster: true,
      }),
      true
    );
  });

  it("allows a member to see their own email", () => {
    assert.equal(
      canViewRosterEmail({
        viewerUserId: "same-user",
        memberUserId: "same-user",
        canManageRoster: false,
      }),
      true
    );
  });

  it("hides another member's email from unrelated signed-in users", () => {
    assert.equal(
      canViewRosterEmail({
        viewerUserId: "viewer",
        memberUserId: "member",
        canManageRoster: false,
      }),
      false
    );
  });

  it("rejects empty identity values", () => {
    assert.equal(
      canViewRosterEmail({
        viewerUserId: "",
        memberUserId: "",
        canManageRoster: false,
      }),
      false
    );
  });
});
