/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const actionManifest: Record<string, string[]> = {
  "src/app/(dashboard)/tournaments/actions.ts": [
    "renameTournament",
    "updateTournamentListingDetails",
    "updateTournamentMatchFormat",
    "deleteTournament",
    "updateTournamentStatus",
    "updateTournamentDate",
    "removeDivision",
    "releaseDivisionPools",
    "removeCourt",
    "updateRegistrationStatus",
    "confirmPendingRegistrations",
    "updateDivision",
    "setRegistrationDivision",
    "bulkAssignRegistrationsToDivision",
    "bulkRemoveRegistrations",
  ],
  "src/app/(dashboard)/tournaments/[slug]/brackets/actions.ts": [
    "updatePoolSeeding",
    "updateEliminationSeeding",
    "updateBracketMatchCourt",
    "updateTournamentBracketSettings",
    "regenerateTournamentBrackets",
  ],
  "src/app/(dashboard)/tournaments/[slug]/scoring/actions.ts": [
    "updateScore",
    "finalizeMatch",
    "startMatch",
  ],
  "src/app/(dashboard)/tournaments/[slug]/matches/actions.ts": [
    "changeMatchLifecycle",
    "saveSetScore",
    "finalizeMatch",
    "reopenMatch",
    "updateMatchScheduledTime",
  ],
  "src/app/(dashboard)/schedule/actions.ts": [
    "autoScheduleTournament",
    "updateMatchSchedule",
  ],
  "src/app/(dashboard)/tournaments/[slug]/register/actions.ts": [
    "withdrawRegistration",
  ],
  "src/app/(dashboard)/admin/actions.ts": [
    "adminRenameTournament",
    "adminUpdateTournamentStatus",
    "adminDeleteTournament",
    "adminRenameTeam",
    "adminDeleteTeam",
    "adminApproveSchool",
    "adminRejectSchool",
    "adminResetSchoolToPending",
    "adminDeleteSchool",
  ],
  "src/app/(dashboard)/schools/actions.ts": [
    "updateSchool",
    "deleteSchool",
    "submitForVerification",
  ],
  "src/app/(dashboard)/teams/actions.ts": ["deleteTeam"],
};

const idBasedInvalidationManifest: Record<string, string[]> = {
  "src/app/(dashboard)/tournaments/actions.ts": [
    "updateTournamentListingDetails",
    "updateTournamentMatchFormat",
    "updateTournamentStatus",
    "updateTournamentDate",
    "removeDivision",
    "releaseDivisionPools",
    "removeCourt",
    "updateRegistrationStatus",
    "confirmPendingRegistrations",
    "updateDivision",
    "setRegistrationDivision",
    "bulkAssignRegistrationsToDivision",
    "bulkRemoveRegistrations",
  ],
  "src/app/(dashboard)/tournaments/[slug]/brackets/actions.ts": [
    "updatePoolSeeding",
    "updateEliminationSeeding",
    "updateBracketMatchCourt",
    "updateTournamentBracketSettings",
    "regenerateTournamentBrackets",
  ],
  "src/app/(dashboard)/tournaments/[slug]/scoring/actions.ts": [
    "updateScore",
    "finalizeMatch",
    "startMatch",
  ],
  "src/app/(dashboard)/tournaments/[slug]/matches/actions.ts": [
    "changeMatchLifecycle",
    "saveSetScore",
    "finalizeMatch",
    "reopenMatch",
    "updateMatchScheduledTime",
  ],
  "src/app/(dashboard)/schedule/actions.ts": [
    "autoScheduleTournament",
    "updateMatchSchedule",
  ],
  "src/app/(dashboard)/tournaments/[slug]/register/actions.ts": [
    "withdrawRegistration",
  ],
  "src/app/(dashboard)/admin/actions.ts": [
    "adminUpdateTournamentStatus",
    "adminRenameTeam",
    "adminDeleteTeam",
    "adminApproveSchool",
    "adminRejectSchool",
    "adminResetSchoolToPending",
    "adminDeleteSchool",
  ],
  "src/app/(dashboard)/schools/actions.ts": [
    "updateSchool",
    "deleteSchool",
    "submitForVerification",
  ],
  "src/app/(dashboard)/teams/actions.ts": ["deleteTeam"],
};

function functionBody(source: string, functionName: string): string {
  const signature = new RegExp(
    `(?:export\\s+)?async\\s+function\\s+${functionName}\\s*\\(`
  );
  const match = signature.exec(source);
  assert.ok(match, `Missing action ${functionName}`);

  const openParen = source.indexOf("(", match.index);
  let parenDepth = 0;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        closeParen = index;
        break;
      }
    }
  }
  assert.notEqual(closeParen, -1, `Missing parameters for ${functionName}`);

  const openBrace = source.indexOf("{", closeParen);
  assert.notEqual(openBrace, -1, `Missing body for ${functionName}`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace, index + 1);
    }
  }
  assert.fail(`Unclosed body for ${functionName}`);
}

describe("public tournament cache invalidation policy", () => {
  for (const [file, actionNames] of Object.entries(actionManifest)) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");

    for (const actionName of actionNames) {
      it(`${actionName} invalidates every affected public cache`, () => {
        assert.match(
          functionBody(source, actionName),
          /invalidatePublicTournament/,
          `${file}#${actionName} must use the centralized invalidation helper`
        );
      });
    }
  }

  for (const [file, actionNames] of Object.entries(
    idBasedInvalidationManifest
  )) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");

    for (const actionName of actionNames) {
      it(`${actionName} resolves the current slug after its mutation`, () => {
        assert.match(
          functionBody(source, actionName),
          /await\s+invalidatePublicTournamentCachesByIds/,
          `${file}#${actionName} must avoid a concurrent-rename cache race`
        );
      });
    }
  }

  for (const file of [
    "src/app/(dashboard)/tournaments/actions.ts",
    "src/app/(dashboard)/admin/actions.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const actionName =
      file.includes("/admin/") ? "adminRenameTournament" : "renameTournament";

    it(`${actionName} serializes and expires both slug generations`, () => {
      const body = functionBody(source, actionName);
      assert.match(body, /db\.transaction/);
      assert.match(
        body,
        /\.for\("update"\)|loadLockedTournamentForOrganizer/
      );
      assert.match(body, /oldSlug/);
      assert.match(body, /newSlug/);
      assert.match(body, /invalidatePublicTournamentCaches/);
    });
  }

  it("deleteTournament invalidates the slug read under its delete lock", () => {
    const file = "src/app/(dashboard)/tournaments/actions.ts";
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const body = functionBody(source, "deleteTournament");

    assert.match(body, /\.for\("update"\)/);
    assert.match(body, /lockedTournament\.slug/);
    assert.match(body, /invalidatePublicTournamentCaches/);
  });

  it("the organizer tournament loader takes the row lock used by rename", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/lib/tournaments/locked-tournament-authorization.ts"
      ),
      "utf8"
    );
    assert.match(source, /\.for\("update"\)|FOR UPDATE/i);
  });
});
