# PoolPlay Backend Foundation Implementation Plan

## Scope

Implement the approved backend-foundation design in independently verifiable
slices. Preserve unrelated homepage and navigation work already present in the
worktree.

## Slice 1: Authorization and Browser Database Protection

### 1. Add failing security regression tests

Files:

- `src/lib/security/authorization-invariants.test.ts`
- `src/lib/security/security-migration.test.ts`

Coverage:

- Child mutations require the authorized parent ID.
- Match mutations reject a tournament mismatch.
- Scheduled courts belong to the match tournament.
- Team-to-school attachment requires authority over both resources.
- The security migration removes browser profile updates.
- Sensitive payment, waiver, and email tables have RLS and no browser writes.

Verification:

```bash
node --import tsx --test src/lib/security/*.test.ts
```

The new tests must fail before the implementation and pass afterward.

### 2. Add a forward-only security migration

File:

- `supabase/migrations/00036_security_hardening.sql`

Changes:

- Drop the unsafe `users_update_own` policy.
- Revoke direct browser updates to `public.users`.
- Enable RLS for waiver, payment, and email-delivery tables.
- Revoke direct browser writes to sensitive operational tables.
- Keep server-side Drizzle actions functional through the trusted database
  connection.

Verification:

- Static migration regression test.
- Read-only privilege and RLS queries against the configured database before
  deployment.
- Local Supabase RLS matrix after database bootstrap is available.

### 3. Scope team and school mutations

Files:

- `src/app/(dashboard)/teams/actions.ts`
- `src/app/(dashboard)/schools/actions.ts`
- shared permission/service files if extraction is needed

Changes:

- Remove or secure the unused jersey-number server action.
- Delete membership only when both membership ID and team ID match.
- Require authority over the target team and destination school before
  attachment.
- Derive the current user inside school-listing actions.

Verification:

- Negative authorization tests.
- Existing team and school flows continue to type-check.

### 4. Scope tournament mutations

Files:

- `src/app/(dashboard)/tournaments/actions.ts`
- `src/app/(dashboard)/tournaments/[slug]/brackets/actions.ts`
- `src/app/(dashboard)/schedule/actions.ts`
- `src/lib/tournaments/match-query.ts`

Changes:

- Delete divisions and courts only with matching tournament IDs.
- Derive a match's tournament before changing its referee or court.
- Validate a scheduled court belongs to the match tournament.
- Require affected-row confirmation before returning success.

Verification:

- Negative cross-tournament tests.
- Focused tournament tests.

### 5. Protect roster email privacy

Files:

- `src/app/(dashboard)/teams/[slug]/page.tsx`
- `src/app/(dashboard)/teams/[slug]/roster-row.tsx`
- `src/app/(dashboard)/schools/[slug]/page.tsx`
- `src/app/(dashboard)/schools/[slug]/school-roster.tsx`

Changes:

- Return and render raw email only for the account owner or an authorized
  manager.
- Keep public roster identity fields unchanged.

Verification:

- Authorization unit tests.
- Render/type checks for manager and non-manager data shapes.

### 6. Review and verify Slice 1

Commands:

```bash
node --import tsx --test src/lib/**/*.test.ts
npx eslint src
npx tsc --noEmit
npm run build
git diff --check
```

Required review:

- Independent code review.
- Independent security review.
- No unresolved high-risk finding in changed paths.

## Slice 2: Reproducible Database

- Freeze the legacy Drizzle migration tree.
- Document `supabase/migrations` as the canonical future stream.
- Add a clean bootstrap that applies the Drizzle baseline and forward Supabase
  migrations.
- Add local Supabase configuration and database security tests.
- Add CI for reset, lint, schema comparison, tests, lint, type-check, and build.
- Reconcile staging history before production history.

## Slice 3: Scoring, Registration, and Payment Reliability

- Create one transactional scoring service.
- Validate match participants and completed-state guards.
- Add revisions and score-event history.
- Add downstream bracket invalidation for corrections.
- Make multi-team registration atomic.
- Fix first-team fee calculation and missing-payment enforcement.
- Add compare-and-set status transitions and concurrency tests.

## Slice 4: Double Elimination and Realtime

- Hide double elimination until its match graph is complete.
- Add explicit winner-feed and loser-feed edges.
- Test seeding, advancement, correction, grand final, and tournament completion.
- Publish scoped score changes and filter subscriptions by tournament.
- Test Realtime reconnect and state recovery.

## Slice 5: Public and Operational Features

- Public tournament schedule, pools, brackets, standings, and live scores.
- Waitlists and registration deadlines.
- Team invitations.
- Tournament staff roles.
- Outbox-driven notifications.
- QR check-in.
- Payments and receipts.
- Historical statistics.

## Completion Audit

The overall goal remains incomplete until every slice above has authoritative
source, test, runtime, and review evidence. Passing one narrow test suite does
not prove completion of another slice.
