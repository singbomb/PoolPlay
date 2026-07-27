-- PoolPlay security hardening.
-- Application writes use the trusted server-side Postgres connection.
-- Browser roles must not mutate identities or sensitive operational records.

DROP POLICY IF EXISTS "users_update_own" ON public.users;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.users FROM anon, authenticated;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

ALTER TABLE public.tournament_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_email_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.tournament_waivers
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.waiver_completions
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.registration_payments
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tournament_email_sends
  FROM anon, authenticated;
