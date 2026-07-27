import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.POOLPLAY_BOOTSTRAP_DATABASE_URL;
if (!databaseUrl?.startsWith("postgresql://postgres@127.0.0.1:")) {
  throw new Error(
    "POOLPLAY_BOOTSTRAP_DATABASE_URL must target the disposable local database"
  );
}

const sql = postgres(databaseUrl, {
  max: 4,
  prepare: false,
  idle_timeout: 1,
});

const organizerId = "11111111-1111-1111-1111-111111111111";
const tournamentIds = [
  "a2000000-0000-4000-8000-000000000010",
  "a2000000-0000-4000-8000-000000000011",
];
const divisionIds = [
  "a2000000-0000-4000-8000-000000000020",
  "a2000000-0000-4000-8000-000000000021",
  "a2000000-0000-4000-8000-000000000022",
];
const bracketIds = [
  "a2000000-0000-4000-8000-000000000030",
  "a2000000-0000-4000-8000-000000000031",
  "a2000000-0000-4000-8000-000000000032",
  "a2000000-0000-4000-8000-000000000033",
];
const matchIds = Array.from(
  { length: 11 },
  (_, index) =>
    `a2000000-0000-4000-8000-${String(201 + index).padStart(12, "0")}`
);

type PostgresError = Error & { code?: string };

async function expectPostgresError(
  action: () => Promise<unknown>,
  expectedCode: string,
  label: string
): Promise<void> {
  await assert.rejects(action, (error: PostgresError) => {
    assert.equal(error.code, expectedCode, label);
    return true;
  });
}

async function cleanup(): Promise<void> {
  await sql`
    DELETE FROM public.tournaments
    WHERE id IN ${sql(tournamentIds)}
  `;
}

async function seed(): Promise<void> {
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
    VALUES
      (
        ${tournamentIds[0]},
        ${organizerId},
        'mens',
        'north',
        'Bracket Graph A',
        'bracket-graph-a',
        '2027-07-27',
        'Test Gym',
        'draft'
      ),
      (
        ${tournamentIds[1]},
        ${organizerId},
        'mens',
        'north',
        'Bracket Graph B',
        'bracket-graph-b',
        '2027-07-28',
        'Test Gym',
        'draft'
      )
  `;
  await sql`
    INSERT INTO public.divisions (id, tournament_id, name)
    VALUES
      (${divisionIds[0]}, ${tournamentIds[0]}, 'Graph A'),
      (${divisionIds[1]}, ${tournamentIds[1]}, 'Graph B'),
      (${divisionIds[2]}, ${tournamentIds[0]}, 'Graph Ownership Race')
  `;
  await sql`
    INSERT INTO public.brackets (id, division_id, seed_count)
    VALUES
      (${bracketIds[0]}, ${divisionIds[0]}, 8),
      (${bracketIds[1]}, ${divisionIds[1]}, 2),
      (${bracketIds[2]}, ${divisionIds[0]}, 2),
      (${bracketIds[3]}, ${divisionIds[2]}, 2)
  `;
}

async function verifyMatchInvariants(): Promise<void> {
  await expectPostgresError(
    () => sql`
      INSERT INTO public.matches (
        id,
        tournament_id,
        bracket_id,
        bracket_section,
        bracket_activation,
        bracket_position,
        slug
      )
      VALUES (
        ${matchIds[0]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'main',
        'required',
        1,
        'missing-round'
      )
    `,
    "23514",
    "Bracket matches must have a round"
  );

  await expectPostgresError(
    () => sql`
      INSERT INTO public.matches (
        id,
        tournament_id,
        bracket_id,
        bracket_section,
        bracket_activation,
        bracket_round,
        bracket_position,
        slug
      )
      VALUES (
        ${matchIds[0]},
        ${tournamentIds[1]},
        ${bracketIds[0]},
        'main',
        'required',
        1,
        1,
        'wrong-tournament'
      )
    `,
    "23503",
    "Bracket matches must use their division tournament"
  );

  await sql`
    INSERT INTO public.matches (
      id,
      tournament_id,
      bracket_id,
      bracket_section,
      bracket_activation,
      bracket_round,
      bracket_position,
      slug
    )
    VALUES
      (
        ${matchIds[0]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        1,
        'graph-a'
      ),
      (
        ${matchIds[1]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        2,
        'graph-b'
      ),
      (
        ${matchIds[2]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        3,
        'graph-c'
      ),
      (
        ${matchIds[3]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        4,
        'graph-d'
      ),
      (
        ${matchIds[4]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        5,
        'graph-e'
      ),
      (
        ${matchIds[5]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'winners',
        'required',
        1,
        6,
        'graph-f'
      ),
      (
        ${matchIds[6]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'losers',
        'conditional',
        1,
        1,
        'section-scoped-coordinate'
      ),
      (
        ${matchIds[7]},
        ${tournamentIds[0]},
        ${bracketIds[0]},
        'grand_final',
        'not_required',
        1,
        1,
        'not-required-final'
      ),
      (
        ${matchIds[8]},
        ${tournamentIds[1]},
        ${bracketIds[1]},
        'main',
        'required',
        1,
        1,
        'other-bracket'
      )
  `;

  await sql`
    UPDATE public.matches
    SET status = 'completed'
    WHERE id = ${matchIds[7]}
  `;
  await expectPostgresError(
    () => sql`
      UPDATE public.matches
      SET status = 'completed'
      WHERE id = ${matchIds[0]}
    `,
    "23514",
    "Required completed bracket matches must have a winner"
  );

  await expectPostgresError(
    () => sql`
      UPDATE public.matches
      SET tournament_id = ${tournamentIds[1]}
      WHERE id = ${matchIds[0]}
    `,
    "23503",
    "A match cannot move outside its bracket tournament"
  );
  await expectPostgresError(
    () => sql`
      UPDATE public.brackets
      SET division_id = ${divisionIds[1]}
      WHERE id = ${bracketIds[0]}
    `,
    "23503",
    "A bracket cannot move outside its matches' tournament"
  );
  await expectPostgresError(
    () => sql`
      UPDATE public.divisions
      SET tournament_id = ${tournamentIds[1]}
      WHERE id = ${divisionIds[0]}
    `,
    "23503",
    "A division cannot move outside its bracket matches' tournament"
  );
}

async function verifyEdgeConstraints(): Promise<void> {
  await sql`
    INSERT INTO public.bracket_match_edges (
      bracket_id,
      source_match_id,
      source_outcome,
      target_match_id,
      target_slot
    )
    VALUES (
      ${bracketIds[0]},
      ${matchIds[0]},
      'winner',
      ${matchIds[1]},
      'team_a'
    )
  `;

  await expectPostgresError(
    () => sql`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[0]},
        'loser',
        ${matchIds[0]},
        'team_b'
      )
    `,
    "23514",
    "Self edges must fail"
  );
  await expectPostgresError(
    () => sql`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[2]},
        'winner',
        ${matchIds[1]},
        'team_a'
      )
    `,
    "23505",
    "A target slot can have only one feed"
  );
  await expectPostgresError(
    () => sql`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[0]},
        'winner',
        ${matchIds[2]},
        'team_b'
      )
    `,
    "23505",
    "A source outcome can feed only one target"
  );
  await expectPostgresError(
    () => sql`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[0]},
        'loser',
        ${matchIds[8]},
        'team_a'
      )
    `,
    "23503",
    "Edges cannot cross brackets"
  );
  await expectPostgresError(
    () => sql`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[1]},
        'winner',
        ${matchIds[0]},
        'team_a'
      )
    `,
    "23514",
    "Sequential cycles must fail"
  );

  await sql`DELETE FROM public.matches WHERE id = ${matchIds[1]}`;
  const [{ edge_count: edgeCount }] = await sql<{ edge_count: number }[]>`
    SELECT count(*)::integer AS edge_count
    FROM public.bracket_match_edges
    WHERE source_match_id = ${matchIds[0]}
  `;
  assert.equal(edgeCount, 0, "Deleting a target match must cascade its edge");
}

async function verifyBrowserDenial(): Promise<void> {
  await sql`
    INSERT INTO public.bracket_match_edges (
      bracket_id,
      source_match_id,
      source_outcome,
      target_match_id,
      target_slot
    )
    VALUES (
      ${bracketIds[0]},
      ${matchIds[4]},
      'winner',
      ${matchIds[5]},
      'team_a'
    )
  `;

  for (const role of ["anon", "authenticated"]) {
    await expectPostgresError(
      () =>
        sql.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL ROLE ${role}`);
          await transaction`
            SELECT 1
            FROM public.bracket_match_edges
            LIMIT 1
          `;
        }),
      "42501",
      `${role} must not read private graph topology`
    );
  }
}

type DatabaseClient = typeof sql;

async function expectSerializedCommitRejection({
  firstAction,
  secondAction,
  expectedCode,
  label,
}: {
  firstAction: (client: DatabaseClient) => Promise<unknown>;
  secondAction: (client: DatabaseClient) => Promise<unknown>;
  expectedCode: string;
  label: string;
}): Promise<void> {
  const first = postgres(databaseUrl!, { max: 1, prepare: false });
  const second = postgres(databaseUrl!, { max: 1, prepare: false });
  let firstTransactionOpen = false;
  let secondTransactionOpen = false;

  try {
    await first`BEGIN`;
    firstTransactionOpen = true;
    await second`BEGIN`;
    secondTransactionOpen = true;
    await firstAction(first);

    const pendingSecondAction = secondAction(second);
    const initialState = await Promise.race([
      pendingSecondAction.then(
        () => "settled",
        () => "settled"
      ),
      new Promise<"waiting">((resolve) => {
        setTimeout(() => resolve("waiting"), 100);
      }),
    ]);
    assert.equal(
      initialState,
      "waiting",
      `${label}: the second write must wait for the first transaction`
    );

    await first`COMMIT`;
    firstTransactionOpen = false;
    try {
      await pendingSecondAction;
    } catch (error) {
      assert.equal((error as PostgresError).code, expectedCode, label);
      await second`ROLLBACK`;
      secondTransactionOpen = false;
      return;
    }
    await expectPostgresError(
      () => second`COMMIT`,
      expectedCode,
      label
    );
    secondTransactionOpen = false;
  } finally {
    if (firstTransactionOpen) {
      await first`ROLLBACK`.catch(() => undefined);
    }
    if (secondTransactionOpen) {
      await second`ROLLBACK`.catch(() => undefined);
    }
    await Promise.all([
      first.end({ timeout: 1 }),
      second.end({ timeout: 1 }),
    ]);
  }
}

async function verifyConcurrentCycleRejection(): Promise<void> {
  await expectSerializedCommitRejection({
    firstAction: (client) => client`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[2]},
        'winner',
        ${matchIds[3]},
        'team_a'
      )
    `,
    secondAction: (client) => client`
      INSERT INTO public.bracket_match_edges (
        bracket_id,
        source_match_id,
        source_outcome,
        target_match_id,
        target_slot
      )
      VALUES (
        ${bracketIds[0]},
        ${matchIds[3]},
        'winner',
        ${matchIds[2]},
        'team_a'
      )
    `,
    expectedCode: "23514",
    label: "Concurrent opposite edges must not commit a cycle",
  });
}

async function verifyConcurrentOwnershipRejection(): Promise<void> {
  await expectSerializedCommitRejection({
    firstAction: (client) => client`
      INSERT INTO public.matches (
        id,
        tournament_id,
        bracket_id,
        bracket_section,
        bracket_activation,
        bracket_round,
        bracket_position,
        slug
      )
      VALUES (
        ${matchIds[9]},
        ${tournamentIds[0]},
        ${bracketIds[2]},
        'main',
        'required',
        1,
        1,
        'concurrent-bracket-owner'
      )
    `,
    secondAction: (client) => client`
      UPDATE public.brackets
      SET division_id = ${divisionIds[1]}
      WHERE id = ${bracketIds[2]}
    `,
    expectedCode: "23503",
    label: "A concurrent bracket move must not orphan a new match",
  });

  await expectSerializedCommitRejection({
    firstAction: (client) => client`
      INSERT INTO public.matches (
        id,
        tournament_id,
        bracket_id,
        bracket_section,
        bracket_activation,
        bracket_round,
        bracket_position,
        slug
      )
      VALUES (
        ${matchIds[10]},
        ${tournamentIds[0]},
        ${bracketIds[3]},
        'main',
        'required',
        1,
        1,
        'concurrent-division-owner'
      )
    `,
    secondAction: (client) => client`
      UPDATE public.divisions
      SET tournament_id = ${tournamentIds[1]}
      WHERE id = ${divisionIds[2]}
    `,
    expectedCode: "23503",
    label: "A concurrent division move must not orphan a new match",
  });
}

async function verifyBracketCascade(): Promise<void> {
  await sql`DELETE FROM public.brackets WHERE id = ${bracketIds[0]}`;
  const [{ match_count: matchCount, edge_count: edgeCount }] = await sql<
    { match_count: number; edge_count: number }[]
  >`
    SELECT
      (
        SELECT count(*)::integer
        FROM public.matches
        WHERE bracket_id = ${bracketIds[0]}
      ) AS match_count,
      (
        SELECT count(*)::integer
        FROM public.bracket_match_edges
        WHERE bracket_id = ${bracketIds[0]}
      ) AS edge_count
  `;
  assert.equal(matchCount, 0, "Deleting a bracket must cascade its matches");
  assert.equal(edgeCount, 0, "Deleting a bracket must cascade its graph edges");
}

async function main(): Promise<void> {
  try {
    await cleanup();
    await seed();
    await verifyMatchInvariants();
    await verifyEdgeConstraints();
    await verifyBrowserDenial();
    await verifyConcurrentCycleRejection();
    await verifyConcurrentOwnershipRejection();
    await verifyBracketCascade();
    console.log("Bracket graph database behavior verified.");
  } finally {
    await cleanup();
    await sql.end({ timeout: 1 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
