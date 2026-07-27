# Database Migration Runbook

## Source of truth

`supabase/migrations` is PoolPlay's only active database deployment stream.
Every active migration uses a 14-digit Supabase version and is immutable after
it reaches a shared environment.

`src/lib/db/schema.ts` remains the application's Drizzle mapping. The SQL
migrations also own database-only behavior that Drizzle does not model,
including RLS policies, grants, storage buckets, event triggers, and Realtime
publication membership.

The SQL under `src/lib/db/migrations` is frozen historical evidence. Its
Drizzle journal contains only the original baseline, so it must not be used to
deploy or rebuild a database. The `db:generate`, `db:migrate`, and `db:push`
scripts intentionally fail closed.

## Historical reconciliation

The versions from `20260726000000` through `20260726003500` are synthetic
history identifiers. They preserve the original SQL order:

1. `20260726000000_initial_schema.sql` is an exact copy of the original
   Drizzle baseline.
2. Versions `20260726000100` through `20260726003500` preserve the former
   numeric Supabase migrations in order.
3. Versions `20260727070145`, `20260727071941`, and `20260727074224` match the
   migration versions already recorded by production.
4. Later migrations are normal forward-only changes.

The security-object capture migration preserves two empty, locked operational
tables and the automatic RLS event trigger that already existed in production
without source history. It does not expose those tables to browser roles.

## Local verification

Start Docker or Colima, then run:

```bash
npm run db:verify
```

The command creates a disposable PostgreSQL 17 container, adds only the
Supabase-owned compatibility objects needed by the migration SQL, replays the
entire migration chain, and verifies:

- every Drizzle table, column, nullability rule, type, and enum;
- defaults, primary/foreign/check constraints, uniqueness, and every
  foreign-key index;
- RLS coverage, policies, browser grants, private helper functions, and the
  automatic RLS event trigger;
- required uniqueness and performance indexes;
- storage buckets and Realtime publication membership;
- organizer, unreleased-viewer, and released-viewer score visibility.
- unrelated, confirmed-participant, organizer, and disabled-user chat
  visibility.

The normalized catalog is compared with
`scripts/database/expected-production-catalog.txt`. That reviewed fingerprint
covers columns, constraints, indexes, enums, policies, grants, default ACLs,
function definitions, event triggers, storage buckets, and publication
membership. Update it only after comparing the same read-only fingerprint
query against the intended shared database.

The container is removed automatically. The command never reads
`DATABASE_URL` and cannot target a remote database.

## Creating a migration

1. Create one timestamped SQL file under `supabase/migrations`.
2. Make the SQL forward-only and safe for existing data.
3. Update `src/lib/db/schema.ts` when the application-facing schema changes.
4. Run `npm run db:verify`, `npm test`, `npx tsc --noEmit`, and the focused
   lint/build checks.
5. Rehearse the migration in a local or development Supabase environment.
6. Review the production dry run before applying the migration.

Never use Drizzle `push` for a shared database. Never run `db reset --linked`
or `db push --include-all` against production.

## Production history reconciliation

The one-time production history repair was completed on July 27, 2026.
Versions `20260726000000` through `20260726003500` were recorded as applied
without executing their SQL. The five existing `20260727...` migration rows
were preserved.

The repair used a locked, insert-only transaction with exact before-and-after
version checks, one stored SQL payload per historical migration, and a content
hash check for every payload. The authoritative migration list contains the
same 41 version/name pairs as this repository, every row has a non-empty
`statements` array, and the production catalog fingerprint was unchanged
before and after the repair.

See `docs/database-reconciliation-2026-07-27.md` for the evidence and
limitations. Do not repeat the repair, rewrite these versions, or use
`--include-all` as a shortcut.
