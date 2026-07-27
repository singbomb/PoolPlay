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
  max: 2,
  prepare: false,
  idle_timeout: 1,
});

const organizerId = "b2000000-0000-4000-8000-000000000001";
const viewerId = "b2000000-0000-4000-8000-000000000002";
const viewerAuthId = "b2000000-0000-4000-8000-000000000099";
const tournamentId = "b2000000-0000-4000-8000-000000000010";
const divisionId = "b2000000-0000-4000-8000-000000000020";
const bracketId = "b2000000-0000-4000-8000-000000000030";
const legacyPoolId = "b2000000-0000-4000-8000-000000000040";
const teamIds = Array.from(
  { length: 5 },
  (_, index) => `b2000000-0000-4000-8000-00000000010${index + 1}`
);

async function cleanup(): Promise<void> {
  await sql`DELETE FROM public.tournaments WHERE id = ${tournamentId}`;
  await sql`DELETE FROM public.teams WHERE id IN ${sql(teamIds)}`;
  await sql`DELETE FROM public.users WHERE id IN ${sql([organizerId, viewerId])}`;
}

async function seedScenario(): Promise<void> {
  await sql`
    INSERT INTO public.users (id, auth_id, email, full_name, role)
    VALUES
      (
        ${organizerId},
        'auth-double-elimination',
        'double-elimination@example.test',
        'Double Elimination Organizer',
        'organizer'
      ),
      (
        ${viewerId},
        ${viewerAuthId},
        'double-elimination-viewer@example.test',
        'Double Elimination Viewer',
        'player'
      )
  `;
  for (let index = 0; index < teamIds.length; index++) {
    await sql`
      INSERT INTO public.teams (
        id,
        name,
        slug,
        university,
        gender,
        region
      )
      VALUES (
        ${teamIds[index]},
        ${`Graph Team ${index + 1}`},
        ${`graph-team-${index + 1}`},
        'Graph University',
        'mens',
        'north'
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
      play_format,
      match_format
    )
    VALUES (
      ${tournamentId},
      ${organizerId},
      'mens',
      'north',
      'Graph Verification',
      'graph-verification',
      '2027-07-27',
      'Graph Gym',
      'registration_closed',
      'double_elimination',
      'best_of_2'
    )
  `;
  await sql`
    INSERT INTO public.divisions (id, tournament_id, name, format)
    VALUES (
      ${divisionId},
      ${tournamentId},
      'Open',
      'double_elimination'
    )
  `;
  await sql`
    INSERT INTO public.brackets (
      id,
      division_id,
      bracket_type,
      seed_count
    )
    VALUES (
      ${bracketId},
      ${divisionId},
      'double_elimination',
      0
    )
  `;
  for (const teamId of teamIds) {
    await sql`
      INSERT INTO public.registrations (
        team_id,
        tournament_id,
        division_id,
        status
      )
      VALUES (
        ${teamId},
        ${tournamentId},
        ${divisionId},
        'confirmed'
      )
    `;
  }
}

async function playableOpeningMatchId(): Promise<string> {
  const [opening] = await sql<{ id: string }[]>`
    SELECT id
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND bracket_section = 'winners'
      AND bracket_round = 1
      AND team_a_id IS NOT NULL
      AND team_b_id IS NOT NULL
    ORDER BY bracket_position
    LIMIT 1
  `;
  assert.ok(opening, "Expected a playable winners-bracket opening match.");
  return opening.id;
}

async function verifyGeneratedGraph(): Promise<void> {
  const { syncDivisionAutoPoolMembers } = await import(
    "../../src/lib/tournaments/division-pools"
  );
  const { seedStraightEliminationDivision } = await import(
    "../../src/lib/tournaments/straight-elimination-seeding"
  );
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  const generated = await seedStraightEliminationDivision({
    tournamentId,
    divisionId,
    orderedTeamIds: teamIds,
  });
  assert.equal(generated.matchCount, 15);

  const [counts] = await sql<{
    match_count: number;
    edge_count: number;
    topology_version: number;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM public.matches WHERE bracket_id = ${bracketId})
        AS match_count,
      (
        SELECT count(*)::int
        FROM public.bracket_match_edges
        WHERE bracket_id = ${bracketId}
      ) AS edge_count,
      topology_version
    FROM public.brackets
    WHERE id = ${bracketId}
  `;
  assert.deepEqual(counts, {
    match_count: 15,
    edge_count: 22,
    topology_version: 2,
  });

  await playableOpeningMatchId();
}

async function verifyStaleRosterRequiresReseeding(): Promise<void> {
  const { syncDivisionAutoPoolMembers } = await import(
    "../../src/lib/tournaments/division-pools"
  );
  const { releaseDivisionPlay } = await import(
    "../../src/lib/tournaments/division-release"
  );
  const {
    straightEliminationDivisionsMissingSeeds,
  } = await import(
    "../../src/lib/tournaments/tournament-completion"
  );
  const { seedStraightEliminationDivision } = await import(
    "../../src/lib/tournaments/straight-elimination-seeding"
  );

  await sql`
    UPDATE public.registrations
    SET status = 'pending'
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamIds[4]}
  `;
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  const [reset] = await sql<{
    match_count: number;
    seed_count: number;
    released_at: Date | null;
  }[]>`
    SELECT
      (
        SELECT count(*)::int
        FROM public.matches
        WHERE bracket_id = ${bracketId}
      ) AS match_count,
      bracket.seed_count,
      division.pools_released_at AS released_at
    FROM public.brackets bracket
    JOIN public.divisions division ON division.id = bracket.division_id
    WHERE bracket.id = ${bracketId}
  `;
  assert.deepEqual(reset, {
    match_count: 0,
    seed_count: 0,
    released_at: null,
  });
  await assert.rejects(
    releaseDivisionPlay({ tournamentId, divisionId }),
    /exactly matches the current roster/
  );
  assert.deepEqual(
    await straightEliminationDivisionsMissingSeeds(tournamentId),
    ["Open"]
  );

  await sql`
    UPDATE public.registrations
    SET status = 'confirmed'
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamIds[4]}
  `;
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  await seedStraightEliminationDivision({
    tournamentId,
    divisionId,
    orderedTeamIds: teamIds,
  });
  await playableOpeningMatchId();

  await sql`
    INSERT INTO public.pools (id, division_id, name)
    VALUES (${legacyPoolId}, ${divisionId}, 'Legacy Pool')
  `;
  await sql`
    INSERT INTO public.pool_teams (pool_id, team_id, seed)
    VALUES (${legacyPoolId}, ${teamIds[4]}, 1)
  `;
  await sql`
    UPDATE public.registrations
    SET status = 'pending'
    WHERE tournament_id = ${tournamentId}
      AND team_id = ${teamIds[4]}
  `;
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  assert.deepEqual(
    await straightEliminationDivisionsMissingSeeds(tournamentId),
    ["Open"],
    "Active registrations, not stale legacy pool rows, define the current roster."
  );
  await assert.rejects(
    releaseDivisionPlay({ tournamentId, divisionId }),
    /exactly matches the current roster/
  );
  await sql`
    UPDATE public.registrations
    SET status = 'pending'
    WHERE tournament_id = ${tournamentId}
      AND team_id <> ${teamIds[0]}
  `;
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  assert.deepEqual(
    await straightEliminationDivisionsMissingSeeds(tournamentId),
    ["Open"],
    "A stale active bracket remains invalid when fewer than two registrations are active."
  );
  await sql`
    UPDATE public.registrations
    SET status = 'confirmed'
    WHERE tournament_id = ${tournamentId}
  `;
  await sql`DELETE FROM public.pools WHERE id = ${legacyPoolId}`;
  await syncDivisionAutoPoolMembers(tournamentId, divisionId);
  assert.deepEqual(
    await straightEliminationDivisionsMissingSeeds(tournamentId),
    []
  );
}

async function visibleMatchCountAsViewer(): Promise<number> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE authenticated");
    await transaction`
      SELECT set_config(
        'request.jwt.claim.sub',
        ${viewerAuthId},
        true
      )
    `;
    const [row] = await transaction<{ value: number }[]>`
      SELECT count(*)::int AS value
      FROM public.matches
      WHERE bracket_id = ${bracketId}
    `;
    return row.value;
  });
}

async function verifyReleaseVisibility(): Promise<void> {
  await sql`
    UPDATE public.matches
    SET updated_at = '2000-01-01T00:00:00Z'
    WHERE bracket_id = ${bracketId}
  `;
  assert.equal(await visibleMatchCountAsViewer(), 0);
  const { releaseDivisionPlay } = await import(
    "../../src/lib/tournaments/division-release"
  );
  const released = await releaseDivisionPlay({ tournamentId, divisionId });
  assert.deepEqual(released, {
    alreadyReleased: false,
    matchCount: 15,
  });
  assert.equal(await visibleMatchCountAsViewer(), 15);
  const [touched] = await sql<{ value: number }[]>`
    SELECT count(*)::int AS value
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND updated_at > '2000-01-01T00:00:00Z'
  `;
  assert.equal(
    touched.value,
    15,
    "Release must touch match rows so subscribed participants refresh."
  );
}

async function verifyBracketTypeRepair(): Promise<void> {
  const { seedStraightEliminationDivision } = await import(
    "../../src/lib/tournaments/straight-elimination-seeding"
  );
  const reseed = () =>
    seedStraightEliminationDivision({
      tournamentId,
      divisionId,
      orderedTeamIds: teamIds,
    });
  const metadata = async () => {
    const [row] = await sql<{
      bracket_type: string;
      edge_count: number;
    }[]>`
      SELECT
        bracket_type::text,
        (
          SELECT count(*)::int
          FROM public.bracket_match_edges
          WHERE bracket_id = ${bracketId}
        ) AS edge_count
      FROM public.brackets
      WHERE id = ${bracketId}
    `;
    return row;
  };

  await sql`
    UPDATE public.brackets
    SET bracket_type = 'single_elimination'
    WHERE id = ${bracketId}
  `;
  await reseed();
  assert.deepEqual(await metadata(), {
    bracket_type: "double_elimination",
    edge_count: 22,
  });

  await sql`
    UPDATE public.divisions
    SET format = 'single_elimination'
    WHERE id = ${divisionId}
  `;
  await sql`
    UPDATE public.brackets
    SET bracket_type = 'double_elimination'
    WHERE id = ${bracketId}
  `;
  await reseed();
  assert.deepEqual(await metadata(), {
    bracket_type: "single_elimination",
    edge_count: 0,
  });

  await sql`
    UPDATE public.divisions
    SET format = 'double_elimination'
    WHERE id = ${divisionId}
  `;
  await sql`
    UPDATE public.brackets
    SET bracket_type = 'single_elimination'
    WHERE id = ${bracketId}
  `;
  await reseed();
  assert.deepEqual(await metadata(), {
    bracket_type: "double_elimination",
    edge_count: 22,
  });
}

async function verifySameCountReseeding(): Promise<void> {
  const openingRows = () => sql<
    { team_a_id: string | null; team_b_id: string | null }[]
  >`
    SELECT team_a_id, team_b_id
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND bracket_section = 'winners'
      AND bracket_round = 1
    ORDER BY bracket_position
  `;
  const original = Array.from(await openingRows());
  const { seedStraightEliminationDivision } = await import(
    "../../src/lib/tournaments/straight-elimination-seeding"
  );
  const swapped = [teamIds[1], teamIds[0], ...teamIds.slice(2)];
  await seedStraightEliminationDivision({
    tournamentId,
    divisionId,
    orderedTeamIds: swapped,
  });
  assert.notDeepEqual(Array.from(await openingRows()), original);
  await seedStraightEliminationDivision({
    tournamentId,
    divisionId,
    orderedTeamIds: teamIds,
  });
  assert.deepEqual(Array.from(await openingRows()), original);
}

async function verifyAutomaticWalkoverCannotReopen(): Promise<void> {
  const [walkover] = await sql<{
    id: string;
    score_revision: number;
  }[]>`
    SELECT id, score_revision
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND bracket_activation = 'required'
      AND status = 'completed'
      AND ((team_a_id IS NULL)::int + (team_b_id IS NULL)::int) = 1
    LIMIT 1
  `;
  assert.ok(walkover, "Expected the five-team bracket to contain a walkover.");

  const { reopenMatchForCorrection } = await import(
    "../../src/lib/tournaments/match-finalize"
  );
  await assert.rejects(
    reopenMatchForCorrection({
      matchId: walkover.id,
      expectedRevision: walkover.score_revision,
      actorUserId: organizerId,
      reason: "A walkover must remain automatic",
    }),
    /Both teams must be assigned/
  );

  const [unchanged] = await sql<{
    status: string;
    score_revision: number;
  }[]>`
    SELECT status::text, score_revision
    FROM public.matches
    WHERE id = ${walkover.id}
  `;
  assert.deepEqual(unchanged, {
    status: "completed",
    score_revision: walkover.score_revision,
  });
}

async function verifyBracketTiebreak(matchId: string): Promise<void> {
  const { saveSetScoreTransactional } = await import(
    "../../src/lib/tournaments/match-finalize"
  );
  const [opening] = await sql<{
    team_a_id: string;
    team_b_id: string;
    score_revision: number;
  }[]>`
    SELECT team_a_id, team_b_id, score_revision
    FROM public.matches
    WHERE id = ${matchId}
  `;
  const first = await saveSetScoreTransactional({
    matchId,
    setNumber: 1,
    teamAScore: 25,
    teamBScore: 20,
    expectedRevision: opening.score_revision,
    actorUserId: organizerId,
  });
  const split = await saveSetScoreTransactional({
    matchId,
    setNumber: 2,
    teamAScore: 20,
    teamBScore: 25,
    expectedRevision: first.nextRevision,
    actorUserId: organizerId,
  });
  assert.equal(split.newlyCompleted, false);
  const decided = await saveSetScoreTransactional({
    matchId,
    setNumber: 3,
    teamAScore: 15,
    teamBScore: 10,
    expectedRevision: split.nextRevision,
    actorUserId: organizerId,
  });
  assert.equal(decided.newlyCompleted, true);

  const [stored] = await sql<{
    status: string;
    winner_id: string;
    set_count: number;
  }[]>`
    SELECT
      status::text,
      winner_id,
      (SELECT count(*)::int FROM public.sets WHERE match_id = ${matchId})
        AS set_count
    FROM public.matches
    WHERE id = ${matchId}
  `;
  assert.deepEqual(stored, {
    status: "completed",
    winner_id: opening.team_a_id,
    set_count: 3,
  });
}

async function verifyPlayedBracketRosterChangeRejected(
  matchId: string
): Promise<void> {
  const { db } = await import("../../src/lib/db");
  const { registrations } = await import("../../src/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { syncDivisionAutoPoolMembers } = await import(
    "../../src/lib/tournaments/division-pools"
  );

  await assert.rejects(
    db.transaction(async (tx) => {
      const executor = tx as unknown as typeof db;
      await executor
        .update(registrations)
        .set({ status: "pending" })
        .where(
          and(
            eq(registrations.tournamentId, tournamentId),
            eq(registrations.teamId, teamIds[4])
          )
        );
      await syncDivisionAutoPoolMembers(
        tournamentId,
        divisionId,
        executor
      );
    }),
    /cannot change after bracket play starts/
  );

  const [preserved] = await sql<{
    registration_status: string;
    match_status: string;
    set_count: number;
  }[]>`
    SELECT
      registration.status::text AS registration_status,
      match.status::text AS match_status,
      (
        SELECT count(*)::int
        FROM public.sets
        WHERE match_id = ${matchId}
      ) AS set_count
    FROM public.registrations registration
    JOIN public.matches match ON match.id = ${matchId}
    WHERE registration.tournament_id = ${tournamentId}
      AND registration.team_id = ${teamIds[4]}
  `;
  assert.deepEqual(preserved, {
    registration_status: "confirmed",
    match_status: "completed",
    set_count: 3,
  });
}

async function finishAvailableMatches(): Promise<void> {
  const { finalizeMatchTransactional } = await import(
    "../../src/lib/tournaments/match-finalize"
  );

  for (let attempt = 0; attempt < 30; attempt++) {
    const [candidate] = await sql<{
      id: string;
      team_a_id: string;
      score_revision: number;
    }[]>`
      SELECT id, team_a_id, score_revision
      FROM public.matches
      WHERE bracket_id = ${bracketId}
        AND bracket_activation = 'required'
        AND status = 'upcoming'
        AND team_a_id IS NOT NULL
        AND team_b_id IS NOT NULL
      ORDER BY
        CASE bracket_section
          WHEN 'winners' THEN 1
          WHEN 'losers' THEN 2
          ELSE 3
        END,
        bracket_round,
        bracket_position
      LIMIT 1
    `;
    if (!candidate) return;
    await finalizeMatchTransactional({
      matchId: candidate.id,
      winnerId: candidate.team_a_id,
      expectedRevision: candidate.score_revision,
      actorUserId: organizerId,
    });
  }
  throw new Error("Double-elimination verification exceeded its match limit.");
}

async function verifyResetAndCorrection(openingMatchId: string): Promise<void> {
  const {
    finalizeMatchTransactional,
    reopenMatchForCorrection,
  } = await import("../../src/lib/tournaments/match-finalize");

  await finishAvailableMatches();
  const [firstFinish] = await sql<{
    tournament_status: string;
    reset_activation: string;
  }[]>`
    SELECT
      tournament.status::text AS tournament_status,
      reset_match.bracket_activation::text AS reset_activation
    FROM public.tournaments tournament
    JOIN public.matches reset_match
      ON reset_match.bracket_id = ${bracketId}
      AND reset_match.bracket_section = 'grand_final'
      AND reset_match.bracket_round = 2
    WHERE tournament.id = ${tournamentId}
  `;
  assert.deepEqual(firstFinish, {
    tournament_status: "completed",
    reset_activation: "not_required",
  });

  const [grandFinal] = await sql<{
    id: string;
    team_b_id: string;
    score_revision: number;
  }[]>`
    SELECT id, team_b_id, score_revision
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND bracket_section = 'grand_final'
      AND bracket_round = 1
  `;
  const reopenedFinal = await reopenMatchForCorrection({
    matchId: grandFinal.id,
    expectedRevision: grandFinal.score_revision,
    actorUserId: organizerId,
    reason: "Verify the conditional reset path",
  });
  const [conditionalReset] = await sql<{
    activation: string;
    tournament_status: string;
  }[]>`
    SELECT
      reset_match.bracket_activation::text AS activation,
      tournament.status::text AS tournament_status
    FROM public.matches reset_match
    JOIN public.tournaments tournament
      ON tournament.id = reset_match.tournament_id
    WHERE reset_match.bracket_id = ${bracketId}
      AND reset_match.bracket_section = 'grand_final'
      AND reset_match.bracket_round = 2
  `;
  assert.deepEqual(conditionalReset, {
    activation: "conditional",
    tournament_status: "in_progress",
  });

  await finalizeMatchTransactional({
    matchId: grandFinal.id,
    winnerId: grandFinal.team_b_id,
    expectedRevision: reopenedFinal.nextRevision,
    actorUserId: organizerId,
  });
  const [resetFinal] = await sql<{
    id: string;
    team_a_id: string;
    score_revision: number;
    activation: string;
  }[]>`
    SELECT
      id,
      team_a_id,
      score_revision,
      bracket_activation::text AS activation
    FROM public.matches
    WHERE bracket_id = ${bracketId}
      AND bracket_section = 'grand_final'
      AND bracket_round = 2
  `;
  assert.equal(resetFinal.activation, "required");
  await finalizeMatchTransactional({
    matchId: resetFinal.id,
    winnerId: resetFinal.team_a_id,
    expectedRevision: resetFinal.score_revision,
    actorUserId: organizerId,
  });

  const [staleRefTarget] = await sql<{
    id: string;
    stale_ref_team_id: string;
  }[]>`
    SELECT target.id, target.team_a_id AS stale_ref_team_id
    FROM public.bracket_match_edges edge
    JOIN public.matches target
      ON target.id = edge.target_match_id
    WHERE edge.source_match_id = ${openingMatchId}
      AND target.team_a_id IS NOT NULL
    ORDER BY target.id
    LIMIT 1
  `;
  assert.ok(staleRefTarget);
  await sql`
    UPDATE public.matches
    SET ref_team_id = ${staleRefTarget.stale_ref_team_id}
    WHERE id = ${staleRefTarget.id}
  `;

  const [opening] = await sql<{ score_revision: number }[]>`
    SELECT score_revision
    FROM public.matches
    WHERE id = ${openingMatchId}
  `;
  const correction = await reopenMatchForCorrection({
    matchId: openingMatchId,
    expectedRevision: opening.score_revision,
    actorUserId: organizerId,
    reason: "Verify both downstream graph branches",
  });
  assert.ok(correction.invalidatedMatchCount > 1);
  const [refAfterCorrection] = await sql<{
    ref_team_id: string | null;
  }[]>`
    SELECT ref_team_id
    FROM public.matches
    WHERE id = ${staleRefTarget.id}
  `;
  assert.notEqual(
    refAfterCorrection.ref_team_id,
    staleRefTarget.stale_ref_team_id,
    "Correction must clear or replace a now-ineligible working team."
  );

  const [branches] = await sql<{
    winner_targets: number;
    loser_targets: number;
    tournament_status: string;
  }[]>`
    SELECT
      count(*) FILTER (WHERE source_outcome = 'winner')::int
        AS winner_targets,
      count(*) FILTER (WHERE source_outcome = 'loser')::int
        AS loser_targets,
      (
        SELECT status::text
        FROM public.tournaments
        WHERE id = ${tournamentId}
      ) AS tournament_status
    FROM public.bracket_match_edges
    WHERE bracket_id = ${bracketId}
      AND source_match_id = ${openingMatchId}
  `;
  assert.deepEqual(branches, {
    winner_targets: 1,
    loser_targets: 1,
    tournament_status: "in_progress",
  });
}

async function main(): Promise<void> {
  try {
    await cleanup();
    await seedScenario();
    await verifyGeneratedGraph();
    await verifyStaleRosterRequiresReseeding();
    await verifyReleaseVisibility();
    await verifyBracketTypeRepair();
    await verifyAutomaticWalkoverCannotReopen();
    await verifySameCountReseeding();
    const openingMatchId = await playableOpeningMatchId();
    await sql`
      UPDATE public.tournaments
      SET status = 'in_progress'
      WHERE id = ${tournamentId}
    `;
    await verifyBracketTiebreak(openingMatchId);
    await verifyPlayedBracketRosterChangeRejected(openingMatchId);
    await verifyResetAndCorrection(openingMatchId);
    console.log("Double-elimination graph verification passed.");
  } finally {
    await cleanup();
    const { db } = await import("../../src/lib/db");
    await db.$client.end();
    await sql.end();
  }
}

void main();
