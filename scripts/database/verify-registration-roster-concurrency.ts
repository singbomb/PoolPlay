import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.POOLPLAY_BOOTSTRAP_DATABASE_URL;
if (!databaseUrl?.startsWith("postgresql://postgres@127.0.0.1:")) {
  throw new Error(
    "POOLPLAY_BOOTSTRAP_DATABASE_URL must target the disposable local database"
  );
}
process.env.DATABASE_URL = databaseUrl;

const sql = postgres(databaseUrl, {
  max: 4,
  prepare: false,
  idle_timeout: 1,
});

const actorId = "f0000000-0000-4000-8000-000000000001";
const schoolId = "f0000000-0000-4000-8000-000000000010";
const teamId = "f0000000-0000-4000-8000-000000000020";
const tournamentId = "f0000000-0000-4000-8000-000000000030";
const divisionIds = [
  "f0000000-0000-4000-8000-000000000040",
  "f0000000-0000-4000-8000-000000000041",
];
const originalOperationId = "f0000000-0000-4000-8000-000000000050";
const replacementOperationId = "f0000000-0000-4000-8000-000000000051";

async function cleanup(): Promise<void> {
  await sql`DELETE FROM public.tournaments WHERE id = ${tournamentId}`;
  await sql`DELETE FROM public.teams WHERE id = ${teamId}`;
  await sql`DELETE FROM public.schools WHERE id = ${schoolId}`;
  await sql`DELETE FROM public.users WHERE id = ${actorId}`;
}

async function seed(): Promise<void> {
  await sql`
    INSERT INTO public.users (id, auth_id, email, full_name, role)
    VALUES (
      ${actorId},
      'f0000000-0000-4000-8000-000000000002',
      'roster-concurrency@example.test',
      'Roster Concurrency',
      'captain'
    )
  `;
  await sql`
    INSERT INTO public.schools (
      id,
      name,
      slug,
      university,
      gender,
      region,
      verification_status,
      verified_at
    )
    VALUES (
      ${schoolId},
      'Roster Concurrency School',
      'roster-concurrency-school',
      'Roster University',
      'mens',
      'north',
      'verified',
      now()
    )
  `;
  await sql`
    INSERT INTO public.teams (
      id,
      name,
      slug,
      university,
      school_id,
      gender,
      region,
      verification_status,
      verified_at
    )
    VALUES (
      ${teamId},
      'Roster Concurrency Team',
      'roster-concurrency-team',
      'Roster University',
      ${schoolId},
      'mens',
      'north',
      'verified',
      now()
    )
  `;
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      host_school_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status,
      payment_enabled,
      payment_first_team_fee_cents,
      payment_additional_team_fee_cents
    )
    VALUES (
      ${tournamentId},
      ${actorId},
      ${schoolId},
      'mens',
      'north',
      'Roster Concurrency',
      'roster-concurrency',
      '2027-07-27',
      'Test Gym',
      'registration_open',
      true,
      10000,
      7500
    )
  `;
  await sql`
    INSERT INTO public.divisions (id, tournament_id, name)
    VALUES
      (${divisionIds[0]}, ${tournamentId}, 'Division A'),
      (${divisionIds[1]}, ${tournamentId}, 'Division B')
  `;
}

async function verifyDurableReplayAndPoolCleanup(): Promise<void> {
  const { registerTeamsAtomically } = await import(
    "../../src/lib/tournaments/registrations"
  );
  const {
    assignRegistrationsToDivisionAtomically,
    removeRegistrationsAtomically,
    withdrawRegistrationAtomically,
  } = await import(
    "../../src/lib/tournaments/registration-roster-mutations"
  );
  const { transitionRegistrationPayment } = await import(
    "../../src/lib/tournaments/payment-transitions"
  );
  const { OperationValidationError } = await import(
    "../../src/lib/tournaments/competition-operation-rules"
  );

  await registerTeamsAtomically({
    tournamentId,
    teamIds: [teamId],
    actor: { id: actorId, role: "captain" },
    operationId: originalOperationId,
  });
  const [initialRegistration] = await sql<{ id: string }[]>`
    SELECT id
    FROM public.registrations
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamId}
  `;
  await assignRegistrationsToDivisionAtomically({
    tournamentId,
    registrationIds: [initialRegistration.id],
    divisionId: divisionIds[0],
    actorUserId: actorId,
  });
  await sql`
    UPDATE public.users
    SET disabled_at = now()
    WHERE id = ${actorId}
  `;
  await assert.rejects(
    () =>
      withdrawRegistrationAtomically({
        tournamentId,
        teamId,
        actorUserId: actorId,
      }),
    OperationValidationError,
    "a disabled organizer must not withdraw a registration after waiting for the tournament lock"
  );
  await sql`
    UPDATE public.users
    SET disabled_at = NULL
    WHERE id = ${actorId}
  `;
  await withdrawRegistrationAtomically({
    tournamentId,
    teamId,
    actorUserId: actorId,
  });

  const replay = await registerTeamsAtomically({
    tournamentId,
    teamIds: [teamId],
    actor: { id: actorId, role: "captain" },
    operationId: originalOperationId,
  });
  assert.equal(replay.replayed, true);
  const [afterReplay] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM public.registrations
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamId}
  `;
  assert.equal(
    afterReplay.count,
    0,
    "a delayed retry must not recreate a withdrawn registration"
  );
  const [durableEvent] = await sql<{ registration_id: string | null }[]>`
    SELECT registration_id
    FROM public.registration_status_events
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamId}
      AND operation_id = ${originalOperationId}
  `;
  assert.equal(durableEvent.registration_id, null);

  await registerTeamsAtomically({
    tournamentId,
    teamIds: [teamId],
    actor: { id: actorId, role: "captain" },
    operationId: replacementOperationId,
  });
  const [replacement] = await sql<{ id: string }[]>`
    SELECT id
    FROM public.registrations
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamId}
  `;
  await assignRegistrationsToDivisionAtomically({
    tournamentId,
    registrationIds: [replacement.id],
    divisionId: divisionIds[0],
    actorUserId: actorId,
  });
  await sql`
    UPDATE public.registration_payments
    SET
      status = 'unpaid',
      waived_by_user_id = NULL,
      waived_at = NULL,
      updated_at = now()
    WHERE registration_id = ${replacement.id}
  `;

  const race = await Promise.allSettled([
    assignRegistrationsToDivisionAtomically({
      tournamentId,
      registrationIds: [replacement.id],
      divisionId: divisionIds[1],
      actorUserId: actorId,
    }),
    removeRegistrationsAtomically({
      tournamentId,
      registrationIds: [replacement.id],
      actorUserId: actorId,
    }),
    transitionRegistrationPayment({
      kind: "confirm",
      registrationId: replacement.id,
      actorUserId: actorId,
      operationId: "f0000000-0000-4000-8000-000000000052",
    }),
  ]);
  assert.ok(
    race.some((result) => result.status === "fulfilled"),
    "at least one serialized roster operation must complete"
  );
  const [finalState] = await sql<{
    registration_count: number;
    pool_team_count: number;
  }[]>`
    SELECT
      (
        SELECT count(*)::int
        FROM public.registrations
        WHERE tournament_id = ${tournamentId}
          AND team_id = ${teamId}
      ) AS registration_count,
      (
        SELECT count(*)::int
        FROM public.pool_teams pool_team
        JOIN public.pools pool ON pool.id = pool_team.pool_id
        JOIN public.divisions division ON division.id = pool.division_id
        WHERE division.tournament_id = ${tournamentId}
          AND pool_team.team_id = ${teamId}
      ) AS pool_team_count
  `;
  assert.deepEqual(finalState, {
    registration_count: 0,
    pool_team_count: 0,
  });
}

async function main(): Promise<void> {
  await cleanup();
  try {
    await seed();
    await verifyDurableReplayAndPoolCleanup();
    console.log(
      "Verified durable registration replay and atomic roster/pool cleanup."
    );
  } finally {
    await cleanup();
    const { db } = await import("../../src/lib/db");
    await db.$client.end();
    await sql.end();
  }
}

void main();
