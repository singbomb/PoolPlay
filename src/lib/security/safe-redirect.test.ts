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
  loginRedirectPath,
  pathWithSafeNext,
  safeRedirectPath,
} from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("allows same-origin relative paths", () => {
    assert.equal(safeRedirectPath("/dashboard"), "/dashboard");
    assert.equal(safeRedirectPath("/tournaments/foo"), "/tournaments/foo");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    assert.equal(safeRedirectPath("//evil.com"), "/dashboard");
    assert.equal(safeRedirectPath("https://evil.com"), "/dashboard");
    assert.equal(safeRedirectPath("/\\evil.com"), "/dashboard");
  });

  it("rejects control characters that browsers normalize into off-site URLs", () => {
    for (const encodedControl of ["%09", "%0A", "%0D"]) {
      const target = decodeURIComponent(`/${encodedControl}/evil.example/steal`);
      assert.equal(safeRedirectPath(target), "/dashboard");
      assert.equal(loginRedirectPath(target), "/dashboard?welcome=1");
    }
  });

  it("uses fallback for empty values", () => {
    assert.equal(safeRedirectPath(null), "/dashboard");
    assert.equal(safeRedirectPath(""), "/dashboard");
    assert.equal(safeRedirectPath(undefined, "/login"), "/login");
  });

  it("resumes a safe password-login destination and rejects external targets", () => {
    assert.equal(
      loginRedirectPath("/tournaments/summer-classic/register"),
      "/tournaments/summer-classic/register"
    );
    for (const target of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example/steal",
      null,
    ]) {
      assert.equal(loginRedirectPath(target), "/dashboard?welcome=1");
    }
  });

  it("preserves a safe destination through signup and password reset handoffs", () => {
    const intended = "/tournaments/summer-classic/register";
    const signupPath = pathWithSafeNext("/signup", intended);
    assert.equal(signupPath, "/signup?next=%2Ftournaments%2Fsummer-classic%2Fregister");
    assert.equal(
      loginRedirectPath(new URL(signupPath, "https://poolplay.test").searchParams.get("next")),
      intended
    );

    const resetPath = pathWithSafeNext("/reset-password", intended);
    const callbackPath = pathWithSafeNext("/auth/callback", resetPath);
    const callbackNext = safeRedirectPath(
      new URL(callbackPath, "https://poolplay.test").searchParams.get("next")
    );
    assert.equal(
      callbackNext,
      "/reset-password?next=%2Ftournaments%2Fsummer-classic%2Fregister"
    );

    const resetNext = new URL(callbackNext, "https://poolplay.test").searchParams.get("next");
    const successPath = pathWithSafeNext("/login?reset=success", resetNext);
    assert.equal(
      loginRedirectPath(new URL(successPath, "https://poolplay.test").searchParams.get("next")),
      intended
    );
  });

  it("drops unsafe destinations while preserving existing auth defaults", () => {
    for (const unsafe of ["https://evil.example/steal", "//evil.example", null]) {
      assert.equal(pathWithSafeNext("/signup", unsafe), "/signup");
      assert.equal(pathWithSafeNext("/forgot-password", unsafe), "/forgot-password");
      assert.equal(pathWithSafeNext("/reset-password", unsafe), "/reset-password");
      assert.equal(
        pathWithSafeNext("/login?reset=success", unsafe),
        "/login?reset=success"
      );
    }
  });
});
