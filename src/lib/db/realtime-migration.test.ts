import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationDirectory = path.join(
  process.cwd(),
  "supabase",
  "migrations"
);
const migrationFiles = readdirSync(migrationDirectory).filter((fileName) =>
  fileName.endsWith("_enable_matches_realtime.sql")
);

test("Realtime uses matches as the only score invalidation signal", () => {
  assert.deepEqual(migrationFiles, [
    "20260727120220_enable_matches_realtime.sql",
  ]);

  const migration = readFileSync(
    path.join(migrationDirectory, migrationFiles[0]),
    "utf8"
  )
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  assert.match(
    migration,
    /alter publication supabase_realtime add table public\.matches;/
  );
  assert.match(migration, /if not exists/);
  assert.match(migration, /from pg_catalog\.pg_publication_tables/);
  assert.doesNotMatch(migration, /public\.sets/);
  assert.doesNotMatch(migration, /public\.match_score_events/);
});

test("the client refreshes for match updates and rebuilt bracket inserts", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "realtime",
      "match-realtime-refresh.tsx"
    ),
    "utf8"
  );

  assert.match(source, /event:\s*"UPDATE"/);
  assert.match(source, /event:\s*"INSERT"/);
  assert.doesNotMatch(source, /event:\s*"DELETE"/);
  assert.match(source, /filter,/);
  assert.match(source, /setInterval/);
  assert.match(source, /status\s*===\s*"SUBSCRIBED"/);
  assert.match(source, /status\s*===\s*"CHANNEL_ERROR"/);
  assert.match(source, /status\s*===\s*"TIMED_OUT"/);
  assert.match(source, /stopPeriodicRefresh\(\)/);
});

test("division release emits a visible match update after publication", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "lib",
      "tournaments",
      "division-release.ts"
    ),
    "utf8"
  );
  const releaseIndex = source.indexOf(".update(divisions)");
  const matchTouchIndex = source.indexOf(".update(matches)", releaseIndex);

  assert.ok(releaseIndex >= 0, "Expected the division release update.");
  assert.ok(
    matchTouchIndex > releaseIndex,
    "Match rows must be touched after the division becomes visible."
  );
  assert.match(source.slice(matchTouchIndex), /\.set\(\{\s*updatedAt:\s*releasedAt/);
});
