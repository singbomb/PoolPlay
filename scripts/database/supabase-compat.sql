\set ON_ERROR_STOP on

-- Minimal Supabase-owned objects needed to replay PoolPlay migrations in a
-- disposable stock PostgreSQL container.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth AUTHORIZATION postgres;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

CREATE SCHEMA storage AUTHORIZATION postgres;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE PUBLICATION supabase_realtime;
