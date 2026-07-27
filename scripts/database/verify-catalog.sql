\set ON_ERROR_STOP on

DO $verification$
DECLARE
  missing_tables text[];
  tables_without_rls text[];
  unexpected_policy_count integer;
  unexpected_grant_count integer;
  effective_grant_count integer;
  missing_index_count integer;
  missing_check_count integer;
  unindexed_foreign_key_count integer;
BEGIN
  SELECT array_agg(expected.name ORDER BY expected.name)
  INTO missing_tables
  FROM (
    VALUES
      ('account_deletion_requests'),
      ('auth_rate_limits'),
      ('bracket_match_edges'),
      ('brackets'),
      ('content_flags'),
      ('court_divisions'),
      ('courts'),
      ('divisions'),
      ('match_score_events'),
      ('matches'),
      ('pool_teams'),
      ('pools'),
      ('registration_payments'),
      ('registration_payment_events'),
      ('registration_status_events'),
      ('registrations'),
      ('school_members'),
      ('schools'),
      ('sets'),
      ('team_members'),
      ('teams'),
      ('tournament_chat_channels'),
      ('tournament_chat_messages'),
      ('tournament_chat_read_cursors'),
      ('tournament_email_sends'),
      ('tournament_waivers'),
      ('tournaments'),
      ('users'),
      ('waiver_completions')
  ) AS expected(name)
  WHERE to_regclass(format('public.%I', expected.name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Missing public tables: %', missing_tables;
  END IF;

  SELECT array_agg(tablename ORDER BY tablename)
  INTO tables_without_rls
  FROM pg_tables
  WHERE schemaname = 'public'
    AND NOT rowsecurity;

  IF tables_without_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Public tables without RLS: %', tables_without_rls;
  END IF;

  SELECT count(*)
  INTO unexpected_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      policyname NOT IN (
        'matches_select_released_or_managed',
        'sets_select_released_or_managed',
        'tournament_chat_messages_select'
      )
      OR coalesce(qual, '') = 'true'
    );

  IF unexpected_policy_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected or globally permissive public policies: %',
      unexpected_policy_count;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
  ) <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three public RLS policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'matches',
          'matches_select_released_or_managed'
        ),
        (
          'sets',
          'sets_select_released_or_managed'
        ),
        (
          'tournament_chat_messages',
          'tournament_chat_messages_select'
        )
    ) AS expected(table_name, policy_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.table_name
        AND policy.policyname = expected.policy_name
        AND policy.cmd = 'SELECT'
        AND policy.roles = ARRAY['authenticated']::name[]
    )
  ) THEN
    RAISE EXCEPTION 'A required RLS policy has the wrong table, role, or command';
  END IF;

  SELECT count(*)
  INTO unexpected_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated')
    AND NOT (
      grantee = 'authenticated'
      AND privilege_type = 'SELECT'
      AND table_name IN ('matches', 'sets', 'tournament_chat_messages')
    );

  IF unexpected_grant_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected browser table grants: %',
      unexpected_grant_count;
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'authenticated'
      AND privilege_type = 'SELECT'
      AND table_name IN ('matches', 'sets', 'tournament_chat_messages')
  ) <> 3 THEN
    RAISE EXCEPTION 'Expected the three Realtime SELECT grants';
  END IF;

  SELECT count(*)
  INTO effective_grant_count
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS browser_role(name)
  CROSS JOIN (
    VALUES
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) AS privilege(name)
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND has_table_privilege(
      browser_role.name,
      relation.oid,
      privilege.name
    )
    AND NOT (
      browser_role.name = 'authenticated'
      AND privilege.name = 'SELECT'
      AND relation.relname IN (
        'matches',
        'sets',
        'tournament_chat_messages'
      )
    );

  IF effective_grant_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected effective browser privileges: %',
      effective_grant_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl defaults
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privileges
    LEFT JOIN pg_roles grantee ON grantee.oid = privileges.grantee
    LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
    WHERE pg_get_userbyid(defaults.defaclrole) = 'postgres'
      AND namespace.nspname IN ('public', 'app_private')
      AND (
        privileges.grantee = 0
        OR grantee.rolname IN ('anon', 'authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'Unsafe browser or PUBLIC default privileges remain';
  END IF;

  SELECT count(*)
  INTO missing_index_count
  FROM (
    VALUES
      ('auth_rate_limits_expiry_idx'),
      ('bracket_match_edges_target_slot_unique'),
      ('matches_id_bracket_unique'),
      ('matches_tournament_slug_unique'),
      ('matches_bracket_coordinate_unique'),
      ('match_score_events_match_revision_unique'),
      ('pool_teams_pool_team_unique'),
      ('registration_payment_events_operation_unique'),
      ('registration_status_events_team_operation_unique'),
      ('registrations_team_tournament_unique'),
      ('school_members_one_president_per_school'),
      ('school_members_school_user_unique'),
      ('sets_match_set_number_unique'),
      ('teams_name_university_gender_unique'),
      ('teams_slug_unique'),
      ('tournaments_slug_unique')
  ) AS expected(name)
  WHERE to_regclass(format('public.%I', expected.name)) IS NULL;

  IF missing_index_count <> 0 THEN
    RAISE EXCEPTION 'Missing required unique or performance indexes: %',
      missing_index_count;
  END IF;

  SELECT count(*)
  INTO missing_check_count
  FROM (
    VALUES
      ('bracket_match_edges', 'bracket_match_edges_no_self_edge_check'),
      ('brackets', 'brackets_topology_version_positive'),
      ('divisions', 'divisions_bracket_count_check'),
      ('match_score_events', 'match_score_events_event_type_check'),
      ('match_score_events', 'match_score_events_revision_positive'),
      ('matches', 'matches_bracket_metadata_check'),
      ('matches', 'matches_completed_bracket_winner_check'),
      ('matches', 'matches_distinct_participants_check'),
      ('matches', 'matches_score_revision_nonnegative'),
      ('matches', 'matches_winner_is_participant_check'),
      (
        'registration_payments',
        'registration_payments_amount_nonnegative'
      ),
      (
        'registration_payments',
        'registration_payments_terminal_metadata_consistent'
      ),
      ('registrations', 'registrations_revision_nonnegative'),
      ('tournaments', 'tournaments_bracket_count_check')
  ) AS expected(table_name, constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = format(
      'public.%I',
      expected.table_name
    )::regclass
      AND constraint_row.conname = expected.constraint_name
      AND constraint_row.contype = 'c'
  );

  IF missing_check_count <> 0 THEN
    RAISE EXCEPTION 'Missing bracket-count check constraints: %',
      missing_check_count;
  END IF;

  WITH foreign_keys AS (
    SELECT
      constraint_row.conrelid,
      constraint_row.conname,
      array_agg(
        attribute.attname
        ORDER BY key_position.ordinality
      ) AS columns
    FROM pg_constraint constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS key_position(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = key_position.attnum
    WHERE constraint_row.contype = 'f'
      AND constraint_row.connamespace = 'public'::regnamespace
    GROUP BY constraint_row.conrelid, constraint_row.conname
  )
  SELECT count(*)
  INTO unindexed_foreign_key_count
  FROM foreign_keys
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    WHERE index_row.indrelid = foreign_keys.conrelid
      AND index_row.indisvalid
      AND index_row.indisready
      AND (
        SELECT array_agg(
          attribute.attname
          ORDER BY key_position.ordinality
        )
        FROM unnest(index_row.indkey)
          WITH ORDINALITY AS key_position(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = index_row.indrelid
          AND attribute.attnum = key_position.attnum
        WHERE key_position.ordinality <= cardinality(foreign_keys.columns)
      ) = foreign_keys.columns
  );

  IF unindexed_foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'Unindexed public foreign keys: %',
      unindexed_foreign_key_count;
  END IF;
END;
$verification$;

DO $verification$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'app_private'
      AND procedure.proname IN (
        'current_user_can_access_tournament_chat',
        'current_user_can_view_match'
      )
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
      AND has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) <> 2 THEN
    RAISE EXCEPTION 'Expected two private RLS helper functions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'current_user_can_access_tournament_chat',
        'current_user_can_view_match',
        'current_user_can_view_tournament'
      )
  ) THEN
    RAISE EXCEPTION 'Public RLS helper functions must not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'app_private'
      AND procedure.proname = 'enforce_bracket_match_edge_acyclic'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND NOT procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'The bracket cycle guard is missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'app_private'
      AND procedure.proname = 'enforce_bracket_tournament_ownership'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND NOT procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'The bracket tournament ownership guard is missing or unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('matches', 'matches_enforce_bracket_tournament'),
        ('brackets', 'brackets_enforce_match_tournament'),
        ('divisions', 'divisions_enforce_bracket_match_tournament')
    ) AS expected(table_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE trigger_row.tgrelid = format(
        'public.%I',
        expected.table_name
      )::regclass
        AND trigger_row.tgname = expected.trigger_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled = 'O'
        AND namespace.nspname = 'app_private'
        AND procedure.proname = 'enforce_bracket_tournament_ownership'
    )
  ) THEN
    RAISE EXCEPTION 'A bracket tournament ownership trigger is missing or disabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('matches', 'matches_validate_bracket_tournament'),
        ('brackets', 'brackets_validate_match_tournament'),
        ('divisions', 'divisions_validate_bracket_match_tournament')
    ) AS expected(table_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE trigger_row.tgrelid = format(
        'public.%I',
        expected.table_name
      )::regclass
        AND trigger_row.tgname = expected.trigger_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled = 'O'
        AND trigger_row.tgconstraint <> 0
        AND trigger_row.tgdeferrable
        AND trigger_row.tginitdeferred
        AND namespace.nspname = 'app_private'
        AND procedure.proname = 'enforce_bracket_tournament_ownership'
    )
  ) THEN
    RAISE EXCEPTION 'A deferred bracket ownership validation trigger is missing or changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE trigger_row.tgrelid =
      'public.bracket_match_edges'::regclass
      AND trigger_row.tgname = 'bracket_match_edges_serialize'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgconstraint = 0
      AND trigger_row.tgtype = 31
      AND namespace.nspname = 'app_private'
      AND procedure.proname = 'enforce_bracket_match_edge_acyclic'
  ) THEN
    RAISE EXCEPTION 'The bracket edge serialization trigger is missing or changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.bracket_match_edges'::regclass
      AND trigger_row.tgname = 'bracket_match_edges_acyclic'
      AND trigger_row.tgconstraint <> 0
      AND trigger_row.tgdeferrable
      AND trigger_row.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'The deferred bracket cycle trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_event_trigger
    WHERE evtname = 'ensure_rls'
      AND evtevent = 'ddl_command_end'
      AND evttags = ARRAY[
        'CREATE TABLE',
        'CREATE TABLE AS',
        'SELECT INTO'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'The ensure_rls event trigger is missing or changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'rls_auto_enable'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog']::text[]
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'The automatic RLS helper is not locked down';
  END IF;

  IF (
    SELECT count(*)
    FROM storage.buckets
    WHERE id IN ('profile-avatars', 'tournament-waivers')
  ) <> 2 THEN
    RAISE EXCEPTION 'Expected both PoolPlay storage buckets';
  END IF;

  IF (
    SELECT array_agg(tablename ORDER BY tablename)
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
  ) IS DISTINCT FROM ARRAY[
    'matches',
    'tournament_chat_messages'
  ]::name[] THEN
    RAISE EXCEPTION 'Unexpected Supabase Realtime publication membership';
  END IF;
END;
$verification$;

CREATE TABLE public.rls_event_trigger_probe (id integer PRIMARY KEY);

DO $verification$
BEGIN
  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.rls_event_trigger_probe'::regclass
  ) THEN
    RAISE EXCEPTION 'The ensure_rls event trigger did not enable RLS';
  END IF;
END;
$verification$;

DROP TABLE public.rls_event_trigger_probe;
