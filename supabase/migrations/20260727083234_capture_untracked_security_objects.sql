-- Capture security objects that already exist in production but were not
-- represented by the historical migration stream.

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  key_hash text NOT NULL,
  scope text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  window_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_hash, scope)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx
  ON public.auth_rate_limits (window_expires_at);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_requests
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.auth_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_requests TO service_role;
GRANT ALL ON TABLE public.auth_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
      AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%'
      AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format(
          'alter table if exists %s enable row level security',
          cmd.object_identity
        );
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %',
            cmd.object_identity;
          RAISE;
      END;
    ELSE
      RAISE LOG
        'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity,
        cmd.schema_name;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
