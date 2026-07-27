\set ON_ERROR_STOP on

WITH app_tables(table_name) AS (
  VALUES
    ('account_deletion_requests'),
    ('auth_rate_limits'),
    ('brackets'),
    ('content_flags'),
    ('court_divisions'),
    ('courts'),
    ('divisions'),
    ('matches'),
    ('pool_teams'),
    ('pools'),
    ('registration_payments'),
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
),
columns_manifest AS (
  SELECT concat_ws(
    '|',
    column_row.table_name,
    column_row.ordinal_position,
    column_row.column_name,
    column_row.data_type,
    column_row.udt_name,
    column_row.is_nullable,
    column_row.column_default
  ) AS value
  FROM information_schema.columns column_row
  JOIN app_tables ON app_tables.table_name = column_row.table_name
  WHERE column_row.table_schema = 'public'
  ORDER BY column_row.table_name, column_row.ordinal_position
),
constraints_manifest AS (
  SELECT concat_ws(
    '|',
    relation.relname,
    constraint_row.conname,
    constraint_row.contype,
    pg_get_constraintdef(constraint_row.oid, true)
  ) AS value
  FROM pg_constraint constraint_row
  JOIN pg_class relation ON relation.oid = constraint_row.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN app_tables ON app_tables.table_name = relation.relname
  WHERE namespace.nspname = 'public'
  ORDER BY relation.relname, constraint_row.conname
),
indexes_manifest AS (
  SELECT concat_ws(
    '|',
    index_row.tablename,
    index_row.indexname,
    index_row.indexdef
  ) AS value
  FROM pg_indexes index_row
  JOIN app_tables ON app_tables.table_name = index_row.tablename
  WHERE index_row.schemaname = 'public'
  ORDER BY index_row.tablename, index_row.indexname
),
enums_manifest AS (
  SELECT concat_ws(
    '|',
    type_row.typname,
    enum_row.enumsortorder,
    enum_row.enumlabel
  ) AS value
  FROM pg_type type_row
  JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
  JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
  WHERE namespace.nspname = 'public'
  ORDER BY type_row.typname, enum_row.enumsortorder
),
rls_manifest AS (
  SELECT concat_ws(
    '|',
    relation.relname,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  ) AS value
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN app_tables ON app_tables.table_name = relation.relname
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
  ORDER BY relation.relname
),
policies_manifest AS (
  SELECT concat_ws(
    '|',
    policy.tablename,
    policy.policyname,
    policy.permissive,
    policy.roles::text,
    policy.cmd,
    policy.qual,
    policy.with_check
  ) AS value
  FROM pg_policies policy
  JOIN app_tables ON app_tables.table_name = policy.tablename
  WHERE policy.schemaname = 'public'
  ORDER BY policy.tablename, policy.policyname
),
grants_manifest AS (
  SELECT concat_ws(
    '|',
    grant_row.table_name,
    grant_row.grantee,
    grant_row.privilege_type,
    grant_row.is_grantable
  ) AS value
  FROM information_schema.role_table_grants grant_row
  JOIN app_tables ON app_tables.table_name = grant_row.table_name
  WHERE grant_row.table_schema = 'public'
    AND grant_row.grantee IN ('anon', 'authenticated')
  ORDER BY
    grant_row.table_name,
    grant_row.grantee,
    grant_row.privilege_type
),
default_acl_manifest AS (
  SELECT concat_ws(
    '|',
    namespace.nspname,
    defaults.defaclobjtype,
    CASE
      WHEN privilege.grantee = 0 THEN 'PUBLIC'
      ELSE grantee.rolname
    END,
    privilege.privilege_type,
    privilege.is_grantable
  ) AS value
  FROM pg_default_acl defaults
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
  LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
  LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
  WHERE pg_get_userbyid(defaults.defaclrole) = 'postgres'
    AND namespace.nspname IN ('public', 'app_private')
    AND (
      privilege.grantee = 0
      OR grantee.rolname IN ('anon', 'authenticated')
    )
  ORDER BY
    namespace.nspname,
    defaults.defaclobjtype,
    privilege.grantee,
    privilege.privilege_type
),
functions_manifest AS (
  SELECT concat_ws(
    '|',
    namespace.nspname,
    procedure.proname,
    pg_get_userbyid(procedure.proowner),
    procedure.prosecdef,
    procedure.proconfig::text,
    procedure.proacl::text,
    pg_get_functiondef(procedure.oid)
  ) AS value
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE (
    namespace.nspname = 'app_private'
    AND procedure.proname IN (
      'current_user_can_access_tournament_chat',
      'current_user_can_view_match'
    )
  )
  OR (
    namespace.nspname = 'public'
    AND procedure.proname = 'rls_auto_enable'
  )
  ORDER BY namespace.nspname, procedure.proname
),
event_triggers_manifest AS (
  SELECT concat_ws(
    '|',
    trigger_row.evtname,
    trigger_row.evtevent,
    trigger_row.evtenabled,
    trigger_row.evttags::text,
    procedure.proname
  ) AS value
  FROM pg_event_trigger trigger_row
  JOIN pg_proc procedure ON procedure.oid = trigger_row.evtfoid
  WHERE trigger_row.evtname = 'ensure_rls'
  ORDER BY trigger_row.evtname
),
storage_manifest AS (
  SELECT concat_ws(
    '|',
    bucket.id,
    bucket.name,
    bucket.public,
    bucket.file_size_limit,
    bucket.allowed_mime_types::text
  ) AS value
  FROM storage.buckets bucket
  WHERE bucket.id IN ('profile-avatars', 'tournament-waivers')
  ORDER BY bucket.id
),
publication_manifest AS (
  SELECT concat_ws(
    '|',
    publication.pubname,
    publication.schemaname,
    publication.tablename
  ) AS value
  FROM pg_publication_tables publication
  WHERE publication.pubname = 'supabase_realtime'
    AND publication.schemaname = 'public'
  ORDER BY publication.tablename
),
fingerprints AS (
  SELECT
    'columns' AS section,
    count(*) AS row_count,
    md5(coalesce(string_agg(value, E'\n'), '')) AS fingerprint
  FROM columns_manifest
  UNION ALL
  SELECT
    'constraints',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM constraints_manifest
  UNION ALL
  SELECT
    'default_acl',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM default_acl_manifest
  UNION ALL
  SELECT
    'enums',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM enums_manifest
  UNION ALL
  SELECT
    'event_triggers',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM event_triggers_manifest
  UNION ALL
  SELECT
    'functions',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM functions_manifest
  UNION ALL
  SELECT
    'grants',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM grants_manifest
  UNION ALL
  SELECT
    'indexes',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM indexes_manifest
  UNION ALL
  SELECT
    'policies',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM policies_manifest
  UNION ALL
  SELECT
    'publication',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM publication_manifest
  UNION ALL
  SELECT
    'rls',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM rls_manifest
  UNION ALL
  SELECT
    'storage',
    count(*),
    md5(coalesce(string_agg(value, E'\n'), ''))
  FROM storage_manifest
)
SELECT section, row_count, fingerprint
FROM fingerprints
ORDER BY section;
