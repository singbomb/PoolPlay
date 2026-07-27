# Production Database Reconciliation — July 27, 2026

## Outcome

PoolPlay's production migration ledger and the canonical files in
`supabase/migrations` now contain the same 41 version/name pairs.

The repair changed migration metadata only. It did not replay historical SQL
or change application tables, functions, policies, grants, storage buckets,
or Realtime publication membership.

## Evidence before the repair

- Production contained exactly five migration rows:
  `20260727070145`, `20260727071941`, `20260727074224`,
  `20260727083234`, and `20260727083240`.
- A disposable PostgreSQL 17 database replayed all 41 canonical migrations
  successfully.
- The clean replay passed catalog, RLS behavior, and Drizzle mapping checks.
- Production and the clean replay produced the same reviewed 12-section
  catalog fingerprint in
  `scripts/database/expected-production-catalog.txt`.

## Repair controls

The repair ran as raw SQL rather than as a new migration, so it could not add
a repair migration to the ledger. One transaction:

1. set short lock and statement timeouts;
2. locked `supabase_migrations.schema_migrations`;
3. required the exact five reviewed version/name pairs;
4. inserted exactly the 36 synthetic historical rows without conflict
   handling;
5. required the exact final 41 version/name pairs;
6. required one non-empty SQL payload on every inserted row;
7. compared every stored payload with its local migration content hash; and
8. committed only after all checks passed.

The inserted rows use `codex_history_repair` in `created_by` to make their
origin auditable. Each `statements` array contains one complete migration
file, matching the storage shape produced by the Supabase MCP migration
writer already used by this project.

## Evidence after the repair

- The authoritative Supabase migration list returned all 41 canonical
  versions in order.
- The ledger contained 41 rows, including 36 repaired rows.
- No ledger row had a null or empty `statements` array.
- The five pre-existing rows retained their original names, statement counts,
  and creators.
- The production catalog fingerprint was identical to the pre-repair and
  clean-rebuild fingerprint.
- Supabase security and performance advisors were rerun.

## Limitations and follow-up

A linked Supabase CLI dry run was not performed because the CLI was not
installed or authenticated in this workspace, and credentials were not moved
onto a command line. The authoritative MCP migration list and direct ledger
query provide the remote history verification instead.

The security advisor reports that leaked-password protection is disabled.
That Auth setting is separate from migration history and should be addressed
in the authentication-settings follow-up. Its RLS-without-policy notices are
expected for tables whose browser grants are intentionally revoked.

Performance advisor notices about unused indexes are informational. The new
foreign-key indexes should remain until production traffic provides enough
usage data for a meaningful review.
