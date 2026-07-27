import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260727104441_competition_operation_concurrency.sql"
);
const migration = readFileSync(migrationPath, "utf8").toLowerCase();

describe("competition operation concurrency migration", () => {
  it("adds optimistic revisions and immutable score events", () => {
    assert.match(
      migration,
      /alter table public\.matches[\s\S]*add column score_revision integer not null default 0/
    );
    assert.match(migration, /create table public\.match_score_events/);
    assert.match(
      migration,
      /unique \(match_id, revision\)/
    );
  });

  it("adds registration and payment transition histories", () => {
    assert.match(migration, /create table public\.registration_status_events/);
    assert.match(migration, /create table public\.registration_payment_events/);
    assert.match(
      migration,
      /unique \(tournament_id, team_id, operation_id\)/
    );
    assert.match(migration, /unique \(operation_id\)/);
  });

  it("retains operation history after a registration is removed", () => {
    assert.match(
      migration,
      /registration_id uuid[\s\S]*?references public\.registrations \(id\) on delete set null/
    );
    assert.match(
      migration,
      /payment_id uuid[\s\S]*?references public\.registration_payments \(id\) on delete set null/
    );
  });

  it("enforces parent and bracket coordinate invariants", () => {
    assert.match(
      migration,
      /foreign key \(division_id, tournament_id\)[\s\S]*references public\.divisions \(id, tournament_id\)/
    );
    assert.match(migration, /pool_teams_pool_team_unique/);
    assert.match(migration, /matches_bracket_coordinate_unique/);
  });

  it("handles legacy duplicate data without guessing match outcomes", () => {
    assert.match(migration, /with ranked_pool_teams as/);
    assert.match(migration, /ranked\.duplicate_rank > 1/);
    assert.match(
      migration,
      /cannot enforce unique bracket coordinates: found % double-elimination bracket match rows/
    );
    assert.match(
      migration,
      /match=%s bracket=%s division=%s round=%s position=%s/
    );
    assert.match(
      migration,
      /or tournament_row\.play_format = 'double_elimination'/
    );
    assert.ok(
      migration.indexOf(
        "found % double-elimination bracket match rows"
      ) <
        migration.indexOf(
          "create unique index matches_bracket_coordinate_unique"
        )
    );
    assert.match(
      migration,
      /cannot enforce unique bracket coordinates/
    );
    assert.match(
      migration,
      /resolve the listed duplicate matches before retrying this migration/
    );
  });

  it("keeps all new audit tables inaccessible to browser roles", () => {
    for (const table of [
      "registration_status_events",
      "registration_payment_events",
      "match_score_events",
    ]) {
      assert.match(
        migration,
        new RegExp(
          `alter table public\\.${table} enable row level security`
        )
      );
      assert.match(
        migration,
        new RegExp(
          `revoke all privileges on table public\\.${table}[\\s\\S]*?from anon, authenticated`
        )
      );
    }
  });
});
