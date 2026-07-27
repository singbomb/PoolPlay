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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const SECURITY_MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260727070145_security_hardening.sql"
);
const RLS_HELPER_MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260727071941_rls_helper_hardening.sql"
);
const BROWSER_RLS_LOCKDOWN_MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260727074224_browser_rls_lockdown.sql"
);
const BROWSER_ROLES = ["anon", "authenticated"] as const;
const WRITE_PRIVILEGES = ["insert", "update", "delete"] as const;
const SENSITIVE_TABLES = [
  "tournament_waivers",
  "waiver_completions",
  "registration_payments",
  "tournament_email_sends",
] as const;
const SERVER_ONLY_TABLES = [
  "users",
  "teams",
  "team_members",
  "tournaments",
  "divisions",
  "registrations",
  "pools",
  "pool_teams",
  "brackets",
  "courts",
  "court_divisions",
  "schools",
  "school_members",
  "tournament_chat_channels",
  "tournament_chat_read_cursors",
  "content_flags",
] as const;
const REALTIME_READ_TABLES = [
  "matches",
  "sets",
  "tournament_chat_messages",
] as const;

function migrationStatements(path = SECURITY_MIGRATION_PATH): string[] {
  assert.ok(
    existsSync(path),
    `Expected the forward-only security migration at ${path}`
  );

  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .split(";")
    .map((statement) =>
      statement.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase()
    )
    .filter(Boolean);
}

function assertStatementIncludes(
  statements: string[],
  ...requiredFragments: string[]
): void {
  assert.ok(
    statements.some((statement) =>
      requiredFragments.every((fragment) => statement.includes(fragment))
    ),
    `Expected one SQL statement to include: ${requiredFragments.join(", ")}`
  );
}

function assertPrivilegeRevoked(
  statements: string[],
  table: string,
  role: string,
  privilege: string
): void {
  const matchingRevokes = statements.filter(
    (statement) =>
      statement.startsWith("revoke ") &&
      statement.includes(` on table public.${table} `) &&
      statement.includes(" from ") &&
      new RegExp(`\\b${role}\\b`).test(statement)
  );

  assert.ok(
    matchingRevokes.some((statement) => {
      const privileges = statement.slice(
        "revoke ".length,
        statement.indexOf(" on table ")
      );
      return (
        privileges.includes("all") ||
        new RegExp(`\\b${privilege}\\b`).test(privileges)
      );
    }),
    `Expected ${privilege.toUpperCase()} on public.${table} to be revoked from ${role}`
  );
}

function assertNoBrowserWriteGrant(
  statements: string[],
  table: string
): void {
  const unsafeGrant = statements.find((statement) => {
    if (
      !statement.startsWith("grant ") ||
      !statement.includes(` on table public.${table} `) ||
      !statement.includes(" to ")
    ) {
      return false;
    }

    const grantsBrowserRole = BROWSER_ROLES.some((role) =>
      new RegExp(`\\b${role}\\b`).test(statement)
    );
    const privileges = statement.slice(
      "grant ".length,
      statement.indexOf(" on table ")
    );
    const grantsWrite =
      privileges.includes("all") ||
      WRITE_PRIVILEGES.some((privilege) =>
        new RegExp(`\\b${privilege}\\b`).test(privileges)
      );

    return grantsBrowserRole && grantsWrite;
  });

  assert.equal(
    unsafeGrant,
    undefined,
    `The migration must not grant browser writes on public.${table}`
  );
}

describe("security hardening migration", () => {
  it("removes direct browser profile updates", () => {
    const statements = migrationStatements();

    assertStatementIncludes(
      statements,
      "drop policy if exists users_update_own",
      "on public.users"
    );
    for (const role of BROWSER_ROLES) {
      assertPrivilegeRevoked(statements, "users", role, "update");
    }
    assertNoBrowserWriteGrant(statements, "users");
    assertStatementIncludes(
      statements,
      "alter table public.users",
      "add column if not exists disabled_at timestamptz"
    );
  });

  it("enables row-level security on sensitive operational tables", () => {
    const statements = migrationStatements();

    for (const table of SENSITIVE_TABLES) {
      assertStatementIncludes(
        statements,
        `alter table public.${table}`,
        "enable row level security"
      );
    }
  });

  it("revokes browser writes on sensitive operational tables", () => {
    const statements = migrationStatements();

    for (const table of SENSITIVE_TABLES) {
      for (const role of BROWSER_ROLES) {
        for (const privilege of WRITE_PRIVILEGES) {
          assertPrivilegeRevoked(statements, table, role, privilege);
        }
      }
      assertNoBrowserWriteGrant(statements, table);
    }
  });
});

describe("RLS helper hardening migration", () => {
  it("reproduces the production RLS helpers with a fixed search path", () => {
    const statements = migrationStatements(RLS_HELPER_MIGRATION_PATH);

    for (const functionName of [
      "current_user_can_access_tournament_chat",
      "current_user_can_view_tournament",
    ]) {
      assertStatementIncludes(
        statements,
        `create or replace function public.${functionName}`,
        "security definer",
        "set search_path = ''"
      );
    }
  });

  it("limits direct helper execution to trusted signed-in roles", () => {
    const statements = migrationStatements(RLS_HELPER_MIGRATION_PATH);

    for (const functionName of [
      "current_user_can_access_tournament_chat",
      "current_user_can_view_tournament",
    ]) {
      assertStatementIncludes(
        statements,
        `revoke all on function public.${functionName}(uuid)`,
        "from public, anon, authenticated"
      );
      assertStatementIncludes(
        statements,
        `grant execute on function public.${functionName}(uuid)`,
        "to authenticated, service_role"
      );
    }
  });

  it("replaces broad match reads and routes protected reads through the helpers", () => {
    const statements = migrationStatements(RLS_HELPER_MIGRATION_PATH);

    assertStatementIncludes(
      statements,
      "drop policy if exists matches_select_authenticated",
      "on public.matches"
    );
    assertStatementIncludes(
      statements,
      "drop policy if exists sets_select_authenticated",
      "on public.sets"
    );
    assertStatementIncludes(
      statements,
      "create policy matches_select_visible_tournament",
      "current_user_can_view_tournament"
    );
    assertStatementIncludes(
      statements,
      "create policy sets_select_visible_tournament",
      "current_user_can_view_tournament"
    );
    assertStatementIncludes(
      statements,
      "create policy tournament_chat_channels_select",
      "current_user_can_access_tournament_chat"
    );
    assertStatementIncludes(
      statements,
      "create policy tournament_chat_messages_select",
      "current_user_can_access_tournament_chat"
    );
  });
});

describe("browser RLS lockdown migration", () => {
  it("moves policy helpers out of the exposed API schema", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    assertStatementIncludes(
      statements,
      "create schema if not exists app_private"
    );
    assertStatementIncludes(
      statements,
      "revoke all on schema app_private",
      "from public, anon, authenticated"
    );
    for (const functionName of [
      "current_user_can_access_tournament_chat",
      "current_user_can_view_match",
    ]) {
      assertStatementIncludes(
        statements,
        `create or replace function app_private.${functionName}`,
        "security definer",
        "set search_path = ''",
        "u.disabled_at is null"
      );
      assertStatementIncludes(
        statements,
        `grant execute on function app_private.${functionName}(uuid)`,
        "to authenticated, service_role"
      );
    }
    assertStatementIncludes(
      statements,
      "drop function if exists public.current_user_can_access_tournament_chat(uuid)"
    );
    assertStatementIncludes(
      statements,
      "drop function if exists public.current_user_can_view_tournament(uuid)"
    );
  });

  it("requires division release before ordinary users can read match data", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    assertStatementIncludes(
      statements,
      "create or replace function app_private.current_user_can_view_match",
      "pool_div.pools_released_at is not null",
      "bracket_div.pools_released_at is not null",
      "t.status <> 'draft'"
    );
    assertStatementIncludes(
      statements,
      "create policy matches_select_released_or_managed",
      "app_private.current_user_can_view_match(id)"
    );
    assertStatementIncludes(
      statements,
      "create policy sets_select_released_or_managed",
      "app_private.current_user_can_view_match(match_id)"
    );
  });

  it("removes browser privileges from server-only tables", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    for (const table of SERVER_ONLY_TABLES) {
      for (const role of BROWSER_ROLES) {
        assertPrivilegeRevoked(statements, table, role, "select");
        for (const privilege of WRITE_PRIVILEGES) {
          assertPrivilegeRevoked(statements, table, role, privilege);
        }
      }
      assertNoBrowserWriteGrant(statements, table);
    }
  });

  it("allows authenticated Realtime reads without browser writes", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    for (const table of REALTIME_READ_TABLES) {
      for (const role of BROWSER_ROLES) {
        for (const privilege of WRITE_PRIVILEGES) {
          assertPrivilegeRevoked(statements, table, role, privilege);
        }
      }
      assertStatementIncludes(
        statements,
        `grant select on table public.${table}`,
        "to authenticated"
      );
      assertNoBrowserWriteGrant(statements, table);
    }
  });

  it("drops the legacy broad authenticated read policies", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    for (const [table, policy] of [
      ["users", "users_select_own"],
      ["teams", "teams_select_authenticated"],
      ["team_members", "team_members_select_authenticated"],
      ["tournaments", "tournaments_select_authenticated"],
      ["divisions", "divisions_select_authenticated"],
      ["registrations", "registrations_select_authenticated"],
      ["pools", "pools_select_authenticated"],
      ["pool_teams", "pool_teams_select_authenticated"],
      ["brackets", "brackets_select_authenticated"],
      ["courts", "courts_select_authenticated"],
      ["court_divisions", "court_divisions_select_authenticated"],
      ["schools", "schools_select_authenticated"],
      ["school_members", "school_members_select_authenticated"],
      [
        "tournament_chat_read_cursors",
        "tournament_chat_read_cursors_select_own",
      ],
      ["tournament_chat_channels", "tournament_chat_channels_select"],
    ]) {
      assertStatementIncludes(
        statements,
        `drop policy if exists ${policy}`,
        `on public.${table}`
      );
    }
  });

  it("makes future public-schema objects private by default", () => {
    const statements = migrationStatements(BROWSER_RLS_LOCKDOWN_MIGRATION_PATH);

    for (const objectType of ["tables", "sequences"]) {
      assertStatementIncludes(
        statements,
        "alter default privileges for role postgres in schema public",
        `revoke all on ${objectType} from anon, authenticated`
      );
    }
    for (const schema of ["public", "app_private"]) {
      assertStatementIncludes(
        statements,
        `alter default privileges for role postgres in schema ${schema}`,
        "revoke execute on functions from public, anon, authenticated"
      );
    }
  });
});
