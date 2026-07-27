import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const migrationDirectory = path.join(
  repositoryRoot,
  "supabase",
  "migrations"
);
const migrationFiles = readdirSync(migrationDirectory)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

test("Supabase is the only active migration stream", () => {
  assert.ok(migrationFiles.length >= 40);

  for (const fileName of migrationFiles) {
    assert.match(fileName, /^\d{14}_[a-z0-9_]+\.sql$/);
  }

  assert.equal(
    migrationFiles[0],
    "20260726000000_initial_schema.sql"
  );
  assert.ok(
    migrationFiles.includes("20260727070145_security_hardening.sql")
  );
  assert.ok(
    migrationFiles.includes("20260727071941_rls_helper_hardening.sql")
  );
  assert.ok(
    migrationFiles.includes("20260727074224_browser_rls_lockdown.sql")
  );
  assert.ok(
    migrationFiles.includes(
      "20260727083234_capture_untracked_security_objects.sql"
    )
  );
  assert.ok(
    migrationFiles.includes(
      "20260727083240_add_missing_foreign_key_indexes.sql"
    )
  );
});

test("the canonical initial schema matches the frozen Drizzle baseline", () => {
  const canonical = readFileSync(
    path.join(migrationDirectory, "20260726000000_initial_schema.sql"),
    "utf8"
  ).trimEnd();
  const legacy = readFileSync(
    path.join(
      repositoryRoot,
      "src",
      "lib",
      "db",
      "migrations",
      "0000_closed_fat_cobra.sql"
    ),
    "utf8"
  ).trimEnd();

  assert.equal(canonical, legacy);
});

test("unsafe Drizzle deployment commands fail closed", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  ) as {
    scripts: Record<string, string>;
  };
  const disabledScript =
    "node scripts/database/drizzle-migrations-disabled.mjs";

  assert.equal(packageJson.scripts["db:generate"], disabledScript);
  assert.equal(packageJson.scripts["db:migrate"], disabledScript);
  assert.equal(packageJson.scripts["db:push"], disabledScript);
  assert.equal(
    packageJson.scripts["db:verify"],
    "bash scripts/database/verify-clean-bootstrap.sh"
  );
});
