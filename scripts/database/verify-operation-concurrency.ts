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
  max: 6,
  prepare: false,
  idle_timeout: 1,
});

const organizerId = "11111111-1111-1111-1111-111111111111";
const captainId = "c0000000-0000-4000-8000-000000000001";
const registrationTournamentId = "c0000000-0000-4000-8000-000000000010";
const schoolId = "c0000000-0000-4000-8000-000000000020";
const registrationTeamIds = [
  "c0000000-0000-4000-8000-000000000101",
  "c0000000-0000-4000-8000-000000000102",
  "c0000000-0000-4000-8000-000000000103",
];
const scoreTournamentId = "d0000000-0000-4000-8000-000000000010";
const scoreTeamIds = [
  "d0000000-0000-4000-8000-000000000101",
  "d0000000-0000-4000-8000-000000000102",
  "d0000000-0000-4000-8000-000000000103",
];
const scoreMatchIds = [
  "d0000000-0000-4000-8000-000000000201",
  "d0000000-0000-4000-8000-000000000202",
  "d0000000-0000-4000-8000-000000000203",
  "d0000000-0000-4000-8000-000000000204",
  "d0000000-0000-4000-8000-000000000205",
];
const bracketTournamentId = "e0000000-0000-4000-8000-000000000010";
const bracketDivisionId = "e0000000-0000-4000-8000-000000000020";
const bracketId = "e0000000-0000-4000-8000-000000000030";
const bracketTeamIds = [
  "e0000000-0000-4000-8000-000000000101",
  "e0000000-0000-4000-8000-000000000102",
  "e0000000-0000-4000-8000-000000000103",
  "e0000000-0000-4000-8000-000000000104",
];
const bracketMatchIds = [
  "e0000000-0000-4000-8000-000000000201",
  "e0000000-0000-4000-8000-000000000202",
  "e0000000-0000-4000-8000-000000000203",
];
const poolCorrectionTournamentId = "f0000000-0000-4000-8000-000000000010";
const poolCorrectionDivisionIds = [
  "f0000000-0000-4000-8000-000000000020",
  "f0000000-0000-4000-8000-000000000021",
  "f0000000-0000-4000-8000-000000000022",
];
const poolCorrectionPoolId = "f0000000-0000-4000-8000-000000000030";
const poolCorrectionBracketIds = [
  "f0000000-0000-4000-8000-000000000040",
  "f0000000-0000-4000-8000-000000000041",
];
const poolCorrectionMatchIds = [
  "f0000000-0000-4000-8000-000000000201",
  "f0000000-0000-4000-8000-000000000202",
  "f0000000-0000-4000-8000-000000000203",
];
const regenerationTournamentId = "a1000000-0000-4000-8000-000000000010";
const regenerationDivisionId = "a1000000-0000-4000-8000-000000000020";
const regenerationPoolId = "a1000000-0000-4000-8000-000000000030";
const regenerationBracketId = "a1000000-0000-4000-8000-000000000040";
const regenerationPoolMatchId = "a1000000-0000-4000-8000-000000000201";
const regenerationBracketMatchId = "a1000000-0000-4000-8000-000000000202";

async function cleanup(): Promise<void> {
  await sql`
    DELETE FROM public.tournaments
    WHERE id IN (
      ${registrationTournamentId},
      ${scoreTournamentId},
      ${bracketTournamentId},
      ${poolCorrectionTournamentId},
      ${regenerationTournamentId}
    )
  `;
  await sql`
    DELETE FROM public.teams
    WHERE id IN ${sql([
      ...registrationTeamIds,
      ...scoreTeamIds,
      ...bracketTeamIds,
    ])}
  `;
  await sql`DELETE FROM public.schools WHERE id = ${schoolId}`;
  await sql`DELETE FROM public.users WHERE id = ${captainId}`;
}

async function seedRegistrationScenario(): Promise<void> {
  await sql`
    INSERT INTO public.users (id, auth_id, email, full_name, role)
    VALUES (
      ${captainId},
      'c0000000-0000-4000-8000-000000000002',
      'concurrency-captain@example.test',
      'Concurrency Captain',
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
      'Concurrency School',
      'concurrency-school',
      'Concurrency University',
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
    VALUES
      (
        ${registrationTeamIds[0]},
        'Concurrency Team A',
        'concurrency-team-a',
        'Concurrency University',
        ${schoolId},
        'mens',
        'north',
        'verified',
        now()
      ),
      (
        ${registrationTeamIds[1]},
        'Concurrency Team B',
        'concurrency-team-b',
        'Concurrency University',
        ${schoolId},
        'mens',
        'north',
        'verified',
        now()
      ),
      (
        ${registrationTeamIds[2]},
        'Concurrency Team C',
        'concurrency-team-c',
        'Concurrency University',
        ${schoolId},
        'mens',
        'north',
        'verified',
        now()
      )
  `;
  await sql`
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES
      (${registrationTeamIds[0]}, ${captainId}, 'captain'),
      (${registrationTeamIds[1]}, ${captainId}, 'captain'),
      (${registrationTeamIds[2]}, ${captainId}, 'captain')
  `;
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status,
      payment_enabled,
      payment_required_before_confirm,
      payment_first_team_fee_cents,
      payment_additional_team_fee_cents
    )
    VALUES (
      ${registrationTournamentId},
      ${organizerId},
      'mens',
      'north',
      'Registration Concurrency',
      'registration-concurrency',
      '2027-07-27',
      'Test Gym',
      'registration_open',
      true,
      true,
      10000,
      7500
    )
  `;
}

async function verifyRegistrationAndPaymentRaces(): Promise<void> {
  const [{ registerTeamsAtomically }, { transitionRegistrationPayment }] =
    await Promise.all([
      import("../../src/lib/tournaments/registrations"),
      import("../../src/lib/tournaments/payment-transitions"),
    ]);
  const { transitionRegistrationStatuses } = await import(
    "../../src/lib/tournaments/registration-transitions"
  );

  const operationIds = [
    "c1000000-0000-4000-8000-000000000001",
    "c1000000-0000-4000-8000-000000000002",
  ];
  const registrations = await Promise.all(
    registrationTeamIds.slice(0, 2).map((teamId, index) =>
      registerTeamsAtomically({
        tournamentId: registrationTournamentId,
        teamIds: [teamId],
        actor: { id: captainId, role: "captain" },
        operationId: operationIds[index],
      })
    )
  );
  assert.deepEqual(
    registrations.map((result) => result.count),
    [1, 1]
  );

  const fees = await sql<{ amount_cents: number }[]>`
    SELECT payment.amount_cents
    FROM public.registration_payments payment
    WHERE payment.tournament_id = ${registrationTournamentId}
    ORDER BY payment.amount_cents
  `;
  assert.deepEqual(
    fees.map((row) => row.amount_cents),
    [7500, 10000],
    "concurrent same-school registrations must assign one first-team fee"
  );

  const replay = await registerTeamsAtomically({
    tournamentId: registrationTournamentId,
    teamIds: [registrationTeamIds[0]],
    actor: { id: captainId, role: "captain" },
    operationId: operationIds[0],
  });
  assert.equal(replay.replayed, true);

  await assert.rejects(() =>
    registerTeamsAtomically({
      tournamentId: registrationTournamentId,
      teamIds: [registrationTeamIds[2], registrationTeamIds[0]],
      actor: { id: captainId, role: "captain" },
      operationId: "c1000000-0000-4000-8000-000000000003",
    })
  );
  const rolledBack = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM public.registrations
    WHERE tournament_id = ${registrationTournamentId}
      AND team_id = ${registrationTeamIds[2]}
  `;
  assert.equal(rolledBack[0].count, 0, "a rejected batch must write nothing");

  const [payment] = await sql<{
    registration_id: string;
  }[]>`
    SELECT registration_id
    FROM public.registration_payments
    WHERE team_id = ${registrationTeamIds[0]}
  `;
  const paymentRace = await Promise.all([
    transitionRegistrationPayment({
      kind: "confirm",
      registrationId: payment.registration_id,
      actorUserId: organizerId,
      operationId: "c2000000-0000-4000-8000-000000000001",
    }),
    transitionRegistrationPayment({
      kind: "waive",
      registrationId: payment.registration_id,
      actorUserId: organizerId,
      operationId: "c2000000-0000-4000-8000-000000000002",
    }),
  ]);
  assert.equal(
    paymentRace.filter((result) => result.outcome === "applied").length,
    1,
    "exactly one terminal payment transition must win"
  );

  const [settled] = await sql<{
    status: string;
    confirmed_at: Date | null;
    waived_at: Date | null;
  }[]>`
    SELECT status, confirmed_at, waived_at
    FROM public.registration_payments
    WHERE registration_id = ${payment.registration_id}
  `;
  assert.ok(settled.status === "confirmed" || settled.status === "waived");
  assert.notEqual(
    settled.confirmed_at !== null,
    settled.waived_at !== null,
    "terminal payment metadata must identify only the winning transition"
  );

  const [unpaidRegistration] = await sql<{ id: string }[]>`
    SELECT registration.id
    FROM public.registrations registration
    JOIN public.registration_payments payment
      ON payment.registration_id = registration.id
    WHERE registration.team_id = ${registrationTeamIds[1]}
      AND payment.status = 'unpaid'
  `;
  await assert.rejects(() =>
    transitionRegistrationStatuses({
      tournamentId: registrationTournamentId,
      registrationIds: [unpaidRegistration.id],
      toStatus: "confirmed",
      actorUserId: organizerId,
      operationId: "c3000000-0000-4000-8000-000000000001",
    })
  );

  await transitionRegistrationStatuses({
    tournamentId: registrationTournamentId,
    registrationIds: [payment.registration_id],
    toStatus: "confirmed",
    actorUserId: organizerId,
    operationId: "c3000000-0000-4000-8000-000000000002",
  });
  const { OperationConflictError } = await import(
    "../../src/lib/tournaments/competition-operation-rules"
  );
  await assert.rejects(
    () =>
      transitionRegistrationStatuses({
        tournamentId: registrationTournamentId,
        registrationIds: [unpaidRegistration.id],
        toStatus: "confirmed",
        actorUserId: organizerId,
        operationId: "c3000000-0000-4000-8000-000000000002",
      }),
    (error) =>
      error instanceof OperationConflictError &&
      error.message.includes("different registration change"),
    "a status operation ID must not be reusable for a disjoint registration set"
  );
}

async function seedScoreScenario(): Promise<void> {
  await sql`
    INSERT INTO public.teams (
      id,
      name,
      slug,
      university,
      gender,
      region,
      verification_status
    )
    VALUES
      (
        ${scoreTeamIds[0]},
        'Score Team A',
        'score-team-a',
        'Score University',
        'mens',
        'north',
        'verified'
      ),
      (
        ${scoreTeamIds[1]},
        'Score Team B',
        'score-team-b',
        'Score University',
        'mens',
        'north',
        'verified'
      ),
      (
        ${scoreTeamIds[2]},
        'Score Team C',
        'score-team-c',
        'Score University',
        'mens',
        'north',
        'verified'
      )
  `;
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status
    )
    VALUES (
      ${scoreTournamentId},
      ${organizerId},
      'mens',
      'north',
      'Score Concurrency',
      'score-concurrency',
      '2027-07-27',
      'Test Gym',
      'in_progress'
    )
  `;
  await sql`
    INSERT INTO public.matches (
      id,
      tournament_id,
      slug,
      team_a_id,
      team_b_id,
      ref_team_id,
      status,
      winner_id
    )
    VALUES
      (
        ${scoreMatchIds[0]},
        ${scoreTournamentId},
        'score-race',
        ${scoreTeamIds[0]},
        ${scoreTeamIds[1]},
        ${registrationTeamIds[0]},
        'in_progress',
        NULL
      ),
      (
        ${scoreMatchIds[1]},
        ${scoreTournamentId},
        'invalid-winner',
        ${scoreTeamIds[0]},
        ${scoreTeamIds[1]},
        NULL,
        'in_progress',
        NULL
      ),
      (
        ${scoreMatchIds[2]},
        ${scoreTournamentId},
        'start-correction-race',
        ${scoreTeamIds[0]},
        ${scoreTeamIds[1]},
        ${registrationTeamIds[0]},
        'completed',
        ${scoreTeamIds[0]}
      ),
      (
        ${scoreMatchIds[3]},
        ${scoreTournamentId},
        'warmup-correction-race',
        ${scoreTeamIds[0]},
        ${scoreTeamIds[1]},
        ${registrationTeamIds[0]},
        'completed',
        ${scoreTeamIds[0]}
      ),
      (
        ${scoreMatchIds[4]},
        ${scoreTournamentId},
        'lifecycle-audit',
        ${scoreTeamIds[0]},
        ${scoreTeamIds[1]},
        ${registrationTeamIds[0]},
        'upcoming',
        NULL
      )
  `;
}

async function verifyScoreRaces(): Promise<void> {
  const {
    finalizeMatchTransactional,
    reopenMatchForCorrection,
    saveSetScoreTransactional,
  } = await import("../../src/lib/tournaments/match-finalize");
  const { transitionMatchLifecycleTransactional } = await import(
    "../../src/lib/tournaments/score-operation-support"
  );

  const writes = await Promise.allSettled([
    saveSetScoreTransactional({
      matchId: scoreMatchIds[0],
      setNumber: 1,
      teamAScore: 10,
      teamBScore: 5,
      expectedRevision: 0,
      actorUserId: captainId,
    }),
    saveSetScoreTransactional({
      matchId: scoreMatchIds[0],
      setNumber: 1,
      teamAScore: 11,
      teamBScore: 5,
      expectedRevision: 0,
      actorUserId: captainId,
    }),
  ]);
  assert.equal(
    writes.filter((result) => result.status === "fulfilled").length,
    1,
    "one stale absolute-score writer must be rejected"
  );

  const [scoreState] = await sql<{
    score_revision: number;
    event_count: number;
    set_count: number;
  }[]>`
    SELECT
      match.score_revision,
      (
        SELECT count(*)::int
        FROM public.match_score_events event
        WHERE event.match_id = match.id
      ) AS event_count,
      (
        SELECT count(*)::int
        FROM public.sets set_row
        WHERE set_row.match_id = match.id
      ) AS set_count
    FROM public.matches match
    WHERE match.id = ${scoreMatchIds[0]}
  `;
  assert.deepEqual(scoreState, {
    score_revision: 1,
    event_count: 1,
    set_count: 1,
  });

  await assert.rejects(() =>
    finalizeMatchTransactional({
      matchId: scoreMatchIds[1],
      winnerId: scoreTeamIds[2],
      expectedRevision: 0,
      actorUserId: organizerId,
    })
  );
  const [invalidWinnerState] = await sql<{
    status: string;
    score_revision: number;
  }[]>`
    SELECT status, score_revision
    FROM public.matches
    WHERE id = ${scoreMatchIds[1]}
  `;
  assert.deepEqual(invalidWinnerState, {
    status: "in_progress",
    score_revision: 0,
  });

  const warmup = await transitionMatchLifecycleTransactional({
    matchId: scoreMatchIds[4],
    action: "warmup",
    expectedRevision: 0,
    actorUserId: captainId,
  });
  const started = await transitionMatchLifecycleTransactional({
    matchId: scoreMatchIds[4],
    action: "start",
    expectedRevision: warmup.nextRevision,
    actorUserId: captainId,
  });
  const paused = await transitionMatchLifecycleTransactional({
    matchId: scoreMatchIds[4],
    action: "pause",
    expectedRevision: started.nextRevision,
    actorUserId: captainId,
  });
  assert.equal(paused.nextRevision, 3);

  const lifecycleEvents = await sql<{ event_type: string; revision: number }[]>`
    SELECT event_type, revision
    FROM public.match_score_events
    WHERE match_id = ${scoreMatchIds[4]}
    ORDER BY revision
  `;
  assert.deepEqual(Array.from(lifecycleEvents), [
    { event_type: "warmup_started", revision: 1 },
    { event_type: "match_started", revision: 2 },
    { event_type: "match_paused", revision: 3 },
  ]);

  await assert.rejects(() =>
    reopenMatchForCorrection({
      matchId: scoreMatchIds[2],
      expectedRevision: 0,
      actorUserId: organizerId,
      reason: "   ",
    })
  );
  await assert.rejects(() =>
    reopenMatchForCorrection({
      matchId: scoreMatchIds[2],
      expectedRevision: 0,
      actorUserId: organizerId,
      reason: "x".repeat(501),
    })
  );
  await assert.rejects(() =>
    reopenMatchForCorrection({
      matchId: scoreMatchIds[2],
      expectedRevision: 0,
      actorUserId: captainId,
      reason: "A ref cannot reopen completed history",
    })
  );

  for (const [action, matchId] of [
    ["start", scoreMatchIds[2]],
    ["warmup", scoreMatchIds[3]],
  ] as const) {
    const [lifecycleResult, correctionResult] = await Promise.allSettled([
      transitionMatchLifecycleTransactional({
        matchId,
        action,
        expectedRevision: 0,
        actorUserId: captainId,
      }),
      reopenMatchForCorrection({
        matchId,
        expectedRevision: 0,
        actorUserId: organizerId,
        reason: `${action} lifecycle race regression`,
      }),
    ]);
    assert.equal(
      lifecycleResult.status,
      "rejected",
      `${action} must not overwrite a completed match while correction reopens it`
    );
    assert.equal(correctionResult.status, "fulfilled");

    const [raceState] = await sql<{
      status: string;
      winner_id: string | null;
      score_revision: number;
      event_type: string;
    }[]>`
      SELECT
        match.status,
        match.winner_id,
        match.score_revision,
        event.event_type
      FROM public.matches match
      JOIN public.match_score_events event
        ON event.match_id = match.id
       AND event.revision = match.score_revision
      WHERE match.id = ${matchId}
    `;
    assert.deepEqual(raceState, {
      status: "in_progress",
      winner_id: null,
      score_revision: 1,
      event_type: "match_reopened",
    });
  }
}

async function seedBracketScenario(): Promise<void> {
  for (let index = 0; index < bracketTeamIds.length; index += 1) {
    await sql`
      INSERT INTO public.teams (
        id,
        name,
        slug,
        university,
        gender,
        region,
        verification_status
      )
      VALUES (
        ${bracketTeamIds[index]},
        ${`Bracket Team ${index + 1}`},
        ${`bracket-team-${index + 1}`},
        'Bracket University',
        'mens',
        'north',
        'verified'
      )
    `;
  }
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status,
      play_format
    )
    VALUES (
      ${bracketTournamentId},
      ${organizerId},
      'mens',
      'north',
      'Bracket Concurrency',
      'bracket-concurrency',
      '2027-07-27',
      'Test Gym',
      'in_progress',
      'single_elimination'
    )
  `;
  await sql`
    INSERT INTO public.divisions (
      id,
      tournament_id,
      name,
      format
    )
    VALUES (
      ${bracketDivisionId},
      ${bracketTournamentId},
      'Open',
      'single_elimination'
    )
  `;
  await sql`
    INSERT INTO public.brackets (id, division_id, seed_count)
    VALUES (${bracketId}, ${bracketDivisionId}, 4)
  `;
  await sql`
    INSERT INTO public.matches (
      id,
      tournament_id,
      slug,
      bracket_id,
      bracket_round,
      bracket_position,
      team_a_id,
      team_b_id,
      status
    )
    VALUES
      (
        ${bracketMatchIds[0]},
        ${bracketTournamentId},
        'semifinal-one',
        ${bracketId},
        1,
        1,
        ${bracketTeamIds[0]},
        ${bracketTeamIds[1]},
        'in_progress'
      ),
      (
        ${bracketMatchIds[1]},
        ${bracketTournamentId},
        'semifinal-two',
        ${bracketId},
        1,
        2,
        ${bracketTeamIds[2]},
        ${bracketTeamIds[3]},
        'in_progress'
      ),
      (
        ${bracketMatchIds[2]},
        ${bracketTournamentId},
        'final',
        ${bracketId},
        2,
        1,
        NULL,
        NULL,
        'upcoming'
      )
  `;
}

async function verifyBracketRaceAndCorrection(): Promise<void> {
  const {
    finalizeMatchTransactional,
    reopenMatchForCorrection,
  } = await import("../../src/lib/tournaments/match-finalize");

  await Promise.all([
    finalizeMatchTransactional({
      matchId: bracketMatchIds[0],
      winnerId: bracketTeamIds[0],
      expectedRevision: 0,
      actorUserId: organizerId,
    }),
    finalizeMatchTransactional({
      matchId: bracketMatchIds[1],
      winnerId: bracketTeamIds[2],
      expectedRevision: 0,
      actorUserId: organizerId,
    }),
  ]);

  const [finalBefore] = await sql<{
    team_a_id: string | null;
    team_b_id: string | null;
    score_revision: number;
  }[]>`
    SELECT team_a_id, team_b_id, score_revision
    FROM public.matches
    WHERE id = ${bracketMatchIds[2]}
  `;
  assert.deepEqual(
    [finalBefore.team_a_id, finalBefore.team_b_id],
    [bracketTeamIds[0], bracketTeamIds[2]],
    "concurrent sibling winners must occupy different final slots"
  );

  await finalizeMatchTransactional({
    matchId: bracketMatchIds[2],
    winnerId: bracketTeamIds[0],
    expectedRevision: finalBefore.score_revision,
    actorUserId: organizerId,
  });
  const correction = await reopenMatchForCorrection({
    matchId: bracketMatchIds[0],
    expectedRevision: 1,
    actorUserId: organizerId,
    reason: "Integration test correction",
  });
  assert.equal(correction.invalidatedMatchCount, 1);

  const [correctedFinal] = await sql<{
    team_a_id: string | null;
    team_b_id: string | null;
    winner_id: string | null;
    status: string;
    score_revision: number;
  }[]>`
    SELECT team_a_id, team_b_id, winner_id, status, score_revision
    FROM public.matches
    WHERE id = ${bracketMatchIds[2]}
  `;
  assert.deepEqual(correctedFinal, {
    team_a_id: null,
    team_b_id: bracketTeamIds[2],
    winner_id: null,
    status: "upcoming",
    score_revision: 2,
  });
  const [tournament] = await sql<{ status: string }[]>`
    SELECT status
    FROM public.tournaments
    WHERE id = ${bracketTournamentId}
  `;
  assert.equal(tournament.status, "in_progress");
}

async function seedDivisionScopedPoolCorrectionScenario(): Promise<void> {
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status,
      play_format
    )
    VALUES (
      ${poolCorrectionTournamentId},
      ${organizerId},
      'mens',
      'north',
      'Division Correction Isolation',
      'division-correction-isolation',
      '2027-07-27',
      'Test Gym',
      'in_progress',
      'pool_to_bracket'
    )
  `;
  await sql`
    INSERT INTO public.divisions (id, tournament_id, name, format)
    VALUES
      (
        ${poolCorrectionDivisionIds[0]},
        ${poolCorrectionTournamentId},
        'Division A',
        'pool_to_bracket'
      ),
      (
        ${poolCorrectionDivisionIds[1]},
        ${poolCorrectionTournamentId},
        'Division B',
        'pool_to_bracket'
      ),
      (
        ${poolCorrectionDivisionIds[2]},
        ${poolCorrectionTournamentId},
        'Division C',
        'single_elimination'
      )
  `;
  await sql`
    INSERT INTO public.pools (id, division_id, name)
    VALUES (
      ${poolCorrectionPoolId},
      ${poolCorrectionDivisionIds[1]},
      'Pool B'
    )
  `;
  await sql`
    INSERT INTO public.brackets (id, division_id, seed_count)
    VALUES
      (
        ${poolCorrectionBracketIds[0]},
        ${poolCorrectionDivisionIds[0]},
        2
      ),
      (
        ${poolCorrectionBracketIds[1]},
        ${poolCorrectionDivisionIds[2]},
        2
      )
  `;
  await sql`
    INSERT INTO public.matches (
      id,
      tournament_id,
      slug,
      pool_id,
      bracket_id,
      bracket_round,
      bracket_position,
      team_a_id,
      team_b_id,
      status,
      winner_id
    )
    VALUES
      (
        ${poolCorrectionMatchIds[0]},
        ${poolCorrectionTournamentId},
        'division-b-pool-match',
        ${poolCorrectionPoolId},
        NULL,
        NULL,
        NULL,
        ${bracketTeamIds[0]},
        ${bracketTeamIds[1]},
        'completed',
        ${bracketTeamIds[0]}
      ),
      (
        ${poolCorrectionMatchIds[1]},
        ${poolCorrectionTournamentId},
        'division-a-final',
        NULL,
        ${poolCorrectionBracketIds[0]},
        1,
        1,
        ${bracketTeamIds[0]},
        ${bracketTeamIds[1]},
        'completed',
        ${bracketTeamIds[0]}
      ),
      (
        ${poolCorrectionMatchIds[2]},
        ${poolCorrectionTournamentId},
        'division-b-final',
        NULL,
        ${poolCorrectionBracketIds[1]},
        1,
        1,
        ${bracketTeamIds[2]},
        ${bracketTeamIds[3]},
        'completed',
        ${bracketTeamIds[2]}
      )
  `;
}

async function verifyDivisionScopedPoolCorrection(): Promise<void> {
  const { reopenMatchForCorrection } = await import(
    "../../src/lib/tournaments/match-finalize"
  );
  const correction = await reopenMatchForCorrection({
    matchId: poolCorrectionMatchIds[0],
    expectedRevision: 0,
    actorUserId: organizerId,
    reason: "Division-scoped pool correction regression",
  });
  assert.equal(
    correction.invalidatedMatchCount,
    1,
    "a non-owner pool correction must invalidate only the shared owner bracket"
  );

  const [ownerDivisionBracket] = await sql<{
    team_a_id: string | null;
    team_b_id: string | null;
    winner_id: string | null;
    status: string;
    score_revision: number;
  }[]>`
    SELECT team_a_id, team_b_id, winner_id, status, score_revision
    FROM public.matches
    WHERE id = ${poolCorrectionMatchIds[1]}
  `;
  assert.deepEqual(ownerDivisionBracket, {
    team_a_id: null,
    team_b_id: null,
    winner_id: null,
    status: "upcoming",
    score_revision: 1,
  });

  const [otherDivisionBracket] = await sql<{
    team_a_id: string | null;
    team_b_id: string | null;
    winner_id: string | null;
    status: string;
    score_revision: number;
    event_count: number;
  }[]>`
    SELECT
      match.team_a_id,
      match.team_b_id,
      match.winner_id,
      match.status,
      match.score_revision,
      (
        SELECT count(*)::int
        FROM public.match_score_events event
        WHERE event.match_id = match.id
      ) AS event_count
    FROM public.matches match
    WHERE match.id = ${poolCorrectionMatchIds[2]}
  `;
  assert.deepEqual(otherDivisionBracket, {
    team_a_id: bracketTeamIds[2],
    team_b_id: bracketTeamIds[3],
    winner_id: bracketTeamIds[2],
    status: "completed",
    score_revision: 0,
    event_count: 0,
  });
}

async function seedRegenerationRaceScenario(): Promise<void> {
  await sql`
    INSERT INTO public.tournaments (
      id,
      organizer_id,
      gender,
      region,
      name,
      slug,
      date,
      location,
      status,
      play_format
    )
    VALUES (
      ${regenerationTournamentId},
      ${organizerId},
      'mens',
      'north',
      'Regeneration Race',
      'regeneration-race',
      '2027-07-27',
      'Test Gym',
      'in_progress',
      'pool_to_bracket'
    )
  `;
  await sql`
    INSERT INTO public.divisions (id, tournament_id, name, format)
    VALUES (
      ${regenerationDivisionId},
      ${regenerationTournamentId},
      'Combined',
      'pool_to_bracket'
    )
  `;
  await sql`
    INSERT INTO public.pools (id, division_id, name)
    VALUES (
      ${regenerationPoolId},
      ${regenerationDivisionId},
      'Combined Pool'
    )
  `;
  await sql`
    INSERT INTO public.pool_teams (pool_id, team_id, seed)
    VALUES
      (${regenerationPoolId}, ${bracketTeamIds[0]}, 1),
      (${regenerationPoolId}, ${bracketTeamIds[1]}, 2)
  `;
  await sql`
    INSERT INTO public.brackets (id, division_id, seed_count)
    VALUES (
      ${regenerationBracketId},
      ${regenerationDivisionId},
      2
    )
  `;
  await sql`
    INSERT INTO public.matches (
      id,
      tournament_id,
      slug,
      pool_id,
      bracket_id,
      bracket_round,
      bracket_position,
      team_a_id,
      team_b_id,
      status,
      winner_id
    )
    VALUES
      (
        ${regenerationPoolMatchId},
        ${regenerationTournamentId},
        'completed-pool-match',
        ${regenerationPoolId},
        NULL,
        NULL,
        NULL,
        ${bracketTeamIds[0]},
        ${bracketTeamIds[1]},
        'completed',
        ${bracketTeamIds[0]}
      ),
      (
        ${regenerationBracketMatchId},
        ${regenerationTournamentId},
        'live-bracket-match',
        NULL,
        ${regenerationBracketId},
        1,
        1,
        ${bracketTeamIds[0]},
        ${bracketTeamIds[1]},
        'in_progress',
        NULL
      )
  `;
}

async function verifyRegenerationVsFinalizationRace(): Promise<void> {
  const { finalizeMatchTransactional } = await import(
    "../../src/lib/tournaments/match-finalize"
  );
  const { regenerateTournamentCombinedBrackets } = await import(
    "../../src/lib/tournaments/bracket-structure"
  );
  const [finalization, regeneration] = await Promise.allSettled([
    finalizeMatchTransactional({
      matchId: regenerationBracketMatchId,
      winnerId: bracketTeamIds[0],
      expectedRevision: 0,
      actorUserId: organizerId,
    }),
    regenerateTournamentCombinedBrackets(regenerationTournamentId),
  ]);
  const finalizationWon = finalization.status === "fulfilled";
  const regenerationWon =
    regeneration.status === "fulfilled" && regeneration.value.error == null;
  assert.equal(
    Number(finalizationWon) + Number(regenerationWon),
    1,
    "finalization and destructive regeneration must have exactly one winner"
  );

  const [oldMatchState] = await sql<{
    status: string | null;
    event_count: number;
  }[]>`
    SELECT
      (
        SELECT status::text
        FROM public.matches
        WHERE id = ${regenerationBracketMatchId}
      ) AS status,
      (
        SELECT count(*)::int
        FROM public.match_score_events
        WHERE match_id = ${regenerationBracketMatchId}
      ) AS event_count
  `;
  if (finalizationWon) {
    assert.deepEqual(oldMatchState, {
      status: "completed",
      event_count: 1,
    });
    assert.equal(regeneration.status, "fulfilled");
    assert.ok(regeneration.value.error);
  } else {
    assert.deepEqual(oldMatchState, {
      status: null,
      event_count: 0,
    });
  }
}

async function verifyPoolRegenerationRaceAndRollback(): Promise<void> {
  const { transitionMatchLifecycleTransactional } = await import(
    "../../src/lib/tournaments/score-operation-support"
  );
  const {
    regeneratePoolMatchesFromSeeds,
    regeneratePoolMatchesFromSeedsInTransaction,
  } = await import("../../src/lib/tournaments/pool-matches");

  await sql`
    UPDATE public.tournaments
    SET status = 'in_progress'
    WHERE id = ${regenerationTournamentId}
  `;
  await sql`
    UPDATE public.matches
    SET status = 'upcoming', winner_id = NULL
    WHERE pool_id = ${regenerationPoolId}
  `;
  const [poolMatch] = await sql<{ id: string; score_revision: number }[]>`
    SELECT id, score_revision
    FROM public.matches
    WHERE pool_id = ${regenerationPoolId}
    LIMIT 1
  `;
  const [lifecycle, regeneration] = await Promise.allSettled([
    transitionMatchLifecycleTransactional({
      matchId: poolMatch.id,
      action: "start",
      expectedRevision: poolMatch.score_revision,
      actorUserId: organizerId,
    }),
    regeneratePoolMatchesFromSeeds(regenerationPoolId),
  ]);
  const lifecycleWon = lifecycle.status === "fulfilled";
  const regenerationWon =
    regeneration.status === "fulfilled" && regeneration.value.error == null;
  assert.equal(
    Number(lifecycleWon) + Number(regenerationWon),
    1,
    "pool-match start and destructive seed regeneration must have one winner"
  );

  await sql`
    UPDATE public.matches
    SET status = 'in_progress'
    WHERE pool_id = ${regenerationPoolId}
  `;
  const { db } = await import("../../src/lib/db");
  const { poolTeams } = await import("../../src/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  await assert.rejects(() =>
    db.transaction(async (tx) => {
      const executor = tx as unknown as typeof db;
      await executor
        .update(poolTeams)
        .set({ seed: 2 })
        .where(
          and(
            eq(poolTeams.poolId, regenerationPoolId),
            eq(poolTeams.teamId, bracketTeamIds[0])
          )
        );
      await executor
        .update(poolTeams)
        .set({ seed: 1 })
        .where(
          and(
            eq(poolTeams.poolId, regenerationPoolId),
            eq(poolTeams.teamId, bracketTeamIds[1])
          )
        );
      const result = await regeneratePoolMatchesFromSeedsInTransaction(
        regenerationPoolId,
        executor
      );
      if (result.error) throw new Error(result.error);
    })
  );

  const seeds = await sql<{ team_id: string; seed: number }[]>`
    SELECT team_id, seed
    FROM public.pool_teams
    WHERE pool_id = ${regenerationPoolId}
    ORDER BY team_id
  `;
  assert.deepEqual(Array.from(seeds), [
    { team_id: bracketTeamIds[0], seed: 1 },
    { team_id: bracketTeamIds[1], seed: 2 },
  ]);
}

async function main(): Promise<void> {
  await cleanup();
  try {
    await seedRegistrationScenario();
    await verifyRegistrationAndPaymentRaces();
    await seedScoreScenario();
    await verifyScoreRaces();
    await seedBracketScenario();
    await verifyBracketRaceAndCorrection();
    await seedDivisionScopedPoolCorrectionScenario();
    await verifyDivisionScopedPoolCorrection();
    await seedRegenerationRaceScenario();
    await verifyRegenerationVsFinalizationRace();
    await verifyPoolRegenerationRaceAndRollback();
    console.log(
      "Verified concurrent registration, payment, scoring, lifecycle, bracket correction, and safe regeneration operations."
    );
  } finally {
    await cleanup();
    const { db } = await import("../../src/lib/db");
    await db.$client.end();
    await sql.end();
  }
}

void main();
