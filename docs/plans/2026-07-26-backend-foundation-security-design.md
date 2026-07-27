# PoolPlay Backend Foundation and Security Design

## Objective

Strengthen PoolPlay's backend before adding major product features. The work will
close authorization gaps, make the database reproducible, protect concurrent
scoring and registration operations, restore scoped live scoring, and either
complete or temporarily disable unfinished double-elimination behavior.

## Guiding Decisions

- Keep PoolPlay as a modular monolith.
- Preserve existing tournament and account history.
- Disable an account instead of deleting historical records.
- Require every mutation to authorize the exact target resource.
- Use database constraints and policies as a second protection layer.
- Use forward-only migrations; do not rewrite deployed migration history.
- Make `supabase/migrations` the sole future migration stream.
- Complete foundation work before public and commercial feature expansion.

## Architecture

Next.js Server Actions remain thin authenticated adapters. Shared backend
services own authorization, validation, transactions, and domain invariants.
PostgreSQL remains the system of record.

```text
Next.js pages and Server Actions
              |
      authenticated adapters
              |
   authorization and domain services
              |
      transactional repositories
              |
          PostgreSQL
              |
      transactional outbox
              |
 email, notification, and webhook workers
```

Public tournament pages will eventually read a deliberately limited public
projection instead of exposing normalized operational tables.

## Phase 1: Authorization and Database Protection

### Browser database access

- Remove direct authenticated `UPDATE` access to `public.users`.
- Keep profile changes behind server actions using the trusted server
  connection.
- Enable row-level security on all application tables.
- Deny browser access to payment, waiver, and email-delivery records unless a
  future feature introduces an explicit narrow policy.
- Add database assertions covering policies and grants.

### Server mutations

Every child-resource mutation must prove that the child belongs to the
authorized parent:

- A team membership update or deletion must match both `memberId` and `teamId`.
- A division or court mutation must match both its ID and `tournamentId`.
- A match mutation must derive its tournament from the match, not trust a
  caller-supplied tournament ID.
- A scheduled court must belong to the same tournament as the match.
- Connecting a team to a school requires authority over both the team and the
  destination school.

Roster email addresses will be visible only to the account owner and authorized
team, school, or application managers.

### Account lifecycle

The admin action will disable the Supabase Auth identity and preserve the
application row and historical relationships. The UI will describe this as
disabling an account, not deleting history.

## Phase 2: Reproducible Database

- Freeze the legacy Drizzle and Supabase migration trees.
- Designate `supabase/migrations` as the sole future migration directory.
- Add a documented bootstrap that applies the original Drizzle baseline before
  the forward Supabase migration chain.
- Rebuild a throwaway database from zero in CI.
- Compare the migrated database against `src/lib/db/schema.ts`.
- Reconcile staging migration history before touching production history.
- Never run `db:push` against production.

## Phase 3: Reliable Competition Operations

### Scoring

- Route all score writes through one transactional service.
- Reject score changes after completion unless using an explicit correction
  workflow.
- Validate that the winner is one of the match participants.
- Add optimistic revisions to prevent stale overwrites.
- Record actor, timestamp, previous value, new value, and correction reason.
- Reconcile downstream bracket state when an upstream result changes.

### Registration and payments

- Register multiple teams in one transaction.
- Calculate fees before inserting the current registration.
- Treat missing required payment records as blocking.
- Use compare-and-set status transitions.
- Record transition history and idempotency keys.

### Double elimination

Hide or reject double-elimination selection until the schema represents
winner-feed and loser-feed edges explicitly. Completion requires generation,
seeding, advancement, correction, and grand-final tests.

## Phase 4: Scoped Realtime

- Add `matches` and `sets` to the Realtime publication through a migration.
- Subscribe only to the current tournament or public projection.
- Ensure RLS and callback filtering prevent cross-tournament events.
- Test reconnect and stale-state recovery.

## Phase 5: Product Expansion

After the foundation passes its completion audit:

1. Public schedules, pools, brackets, standings, and live scores.
2. Registration capacity, deadlines, and waitlists.
3. Email-based team invitations.
4. Tournament staff roles.
5. Reliable user notifications.
6. QR and offline-friendly check-in.
7. Integrated payments and receipts.
8. Season history and team or player statistics.

## Error Handling

- Unauthorized and cross-parent requests return a generic not-found or
  permission error without revealing the target record.
- Transactions roll back the complete logical operation.
- External side effects use an outbox and idempotency keys.
- Failed account disabling leaves the application account active and reports a
  clear error; it never deletes only half of the identity.

## Testing Strategy

- Unit-test authorization and domain services with explicit dependency fakes.
- Add negative regression tests proving denied writes leave state unchanged.
- Exercise RLS through anonymous and authenticated Supabase clients.
- Rebuild the database from zero in CI.
- Add concurrent scoring, registration, and payment tests.
- Add bracket correction and tournament-completion tests.
- Run lint, the complete Node test suite, TypeScript checking, and the
  production build for each implementation slice.

## Completion Standard

A phase is complete only when its source changes are saved, focused regression
tests pass, relevant full-project checks pass, and an independent code and
security review finds no unresolved high-risk issue in the changed paths.
