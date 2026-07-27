import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260727120309_double_elimination_graph.sql"
);
const schemaPath = path.join(
  process.cwd(),
  "src",
  "lib",
  "db",
  "schema.ts"
);
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const schema = readFileSync(schemaPath, "utf8");

describe("double-elimination graph migration", () => {
  it("defines the application-facing graph enums exactly", () => {
    assert.match(
      migration,
      /create type public\.bracket_section as enum\s*\(\s*'main',\s*'winners',\s*'losers',\s*'grand_final'\s*\)/
    );
    assert.match(
      migration,
      /create type public\.bracket_activation as enum\s*\(\s*'required',\s*'conditional',\s*'not_required'\s*\)/
    );
    assert.match(
      migration,
      /create type public\.bracket_outcome as enum\s*\(\s*'winner',\s*'loser'\s*\)/
    );
    assert.match(
      migration,
      /create type public\.bracket_target_slot as enum\s*\(\s*'team_a',\s*'team_b'\s*\)/
    );
    assert.match(
      migration,
      /create type public\.bracket_feed_condition as enum\s*\(\s*'always',\s*'source_team_b_wins'\s*\)/
    );
  });

  it("backfills legacy bracket matches before enforcing graph metadata", () => {
    assert.match(
      migration,
      /add column topology_version integer not null default 1/
    );
    assert.match(
      migration,
      /update public\.matches[\s\S]*bracket_section = 'main'[\s\S]*bracket_activation = 'required'[\s\S]*where bracket_id is not null/
    );
    assert.match(
      migration,
      /matches_bracket_id_brackets_id_fk[\s\S]*references public\.brackets \(id\)[\s\S]*on delete cascade/
    );
    assert.match(
      migration,
      /create unique index matches_bracket_coordinate_unique[\s\S]*bracket_id,\s*bracket_section,\s*bracket_round,\s*bracket_position/
    );
    assert.match(
      migration,
      /matches_completed_bracket_winner_check[\s\S]*bracket_activation = 'not_required'/
    );
    assert.match(
      migration,
      /matches_bracket_metadata_check[\s\S]*bracket_round is not null[\s\S]*bracket_position is not null[\s\S]*bracket_round > 0[\s\S]*bracket_position > 0/
    );
  });

  it("enforces explicit same-bracket winner and loser feeds", () => {
    assert.match(migration, /create table public\.bracket_match_edges/);
    assert.match(
      migration,
      /primary key \(source_match_id, source_outcome\)/
    );
    assert.match(
      migration,
      /unique \(target_match_id, target_slot\)/
    );
    assert.match(
      migration,
      /check \(source_match_id <> target_match_id\)/
    );
    assert.match(
      migration,
      /foreign key \(source_match_id, bracket_id\)[\s\S]*references public\.matches \(id, bracket_id\)/
    );
    assert.match(
      migration,
      /foreign key \(target_match_id, bracket_id\)[\s\S]*references public\.matches \(id, bracket_id\)/
    );
    assert.match(
      migration,
      /create index bracket_match_edges_source_bracket_idx[\s\S]*\(source_match_id, bracket_id\)/
    );
    assert.match(
      migration,
      /create index bracket_match_edges_target_bracket_idx[\s\S]*\(target_match_id, bracket_id\)/
    );
  });

  it("rejects legacy ambiguity before changing the catalog", () => {
    const preflight = migration.indexOf(
      "cannot add the double-elimination graph while legacy"
    );
    const firstType = migration.indexOf(
      "create type public.bracket_section"
    );

    assert.ok(preflight >= 0);
    assert.ok(firstType > preflight);
    assert.match(
      migration,
      /cannot add the double-elimination graph because existing match data violates its invariants/
    );
    assert.match(migration, /bracket_tournament_mismatch/);
  });

  it("serializes graph writes and prevents cycles with a private trigger", () => {
    assert.match(
      migration,
      /function app_private\.enforce_bracket_match_edge_acyclic\(\)[\s\S]*language plpgsql[\s\S]*set search_path = ''/
    );
    assert.match(
      migration,
      /with recursive reachable\(match_id\)[\s\S]*where reachable\.match_id = new\.source_match_id/
    );
    assert.match(
      migration,
      /create constraint trigger bracket_match_edges_acyclic[\s\S]*deferrable initially deferred/
    );
    assert.match(
      migration,
      /create trigger bracket_match_edges_serialize[\s\S]*before insert or update or delete/
    );
    assert.match(
      migration,
      /where bracket_row\.id in \(old\.bracket_id, new\.bracket_id\)[\s\S]*order by bracket_row\.id[\s\S]*for update/
    );
    assert.match(
      migration,
      /revoke all on function[\s\S]*from public, anon, authenticated/
    );
  });

  it("keeps bracket matches inside their owning tournament", () => {
    assert.match(
      migration,
      /function app_private\.enforce_bracket_tournament_ownership\(\)[\s\S]*set search_path = ''/
    );
    assert.match(
      migration,
      /create trigger matches_enforce_bracket_tournament[\s\S]*before insert or update of bracket_id, tournament_id/
    );
    assert.match(
      migration,
      /create trigger brackets_enforce_match_tournament[\s\S]*before update of division_id/
    );
    assert.match(
      migration,
      /create trigger divisions_enforce_bracket_match_tournament[\s\S]*before update of tournament_id/
    );
    assert.match(
      migration,
      /create constraint trigger matches_validate_bracket_tournament[\s\S]*deferrable initially deferred/
    );
    assert.match(
      migration,
      /create constraint trigger brackets_validate_match_tournament[\s\S]*deferrable initially deferred/
    );
    assert.match(
      migration,
      /create constraint trigger divisions_validate_bracket_match_tournament[\s\S]*deferrable initially deferred/
    );
  });

  it("keeps topology private from browser database roles", () => {
    assert.match(
      migration,
      /alter table public\.bracket_match_edges enable row level security/
    );
    assert.match(
      migration,
      /revoke all privileges on table public\.bracket_match_edges[\s\S]*from anon, authenticated/
    );
    assert.doesNotMatch(migration, /create policy[\s\S]*bracket_match_edges/);
  });

  it("keeps the Drizzle schema aligned with the migration contract", () => {
    for (const exportedName of [
      "bracketSectionEnum",
      "bracketActivationEnum",
      "bracketOutcomeEnum",
      "bracketTargetSlotEnum",
      "bracketFeedConditionEnum",
      "bracketMatchEdges",
    ]) {
      assert.match(schema, new RegExp(`export const ${exportedName}`));
    }
    assert.match(schema, /topologyVersion: integer\("topology_version"\)/);
    assert.match(schema, /onDelete: "cascade"/);
  });
});
