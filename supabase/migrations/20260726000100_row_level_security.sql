-- PoolPlay - Collegiate club volleyball tournament hub
-- Copyright (C) 2026 Andrew Chang
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU General Public License for more details.
--
-- You should have received a copy of the GNU General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- Row Level Security (RLS)
-- Run in Supabase: SQL Editor → New query → paste → Run
-- Or: supabase db push (if you use Supabase CLI linked to this project)
--
-- Notes for this app:
-- - Next.js server uses Drizzle with DATABASE_URL (postgres role) → bypasses RLS.
--   Authorization for API routes/server actions must stay correct in application code.
-- - Browser Supabase client + Realtime ARE subject to RLS. Without SELECT policies,
--   live score subscriptions will not receive rows.
-- - Tighten policies below as your product rules get stricter (e.g. scope by tournament).

-- ── Enable RLS on all public app tables (default: deny for anon/authenticated) ──
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sets ENABLE ROW LEVEL SECURITY;

-- ── Policies: authenticated users (JWT from Supabase Auth) ────────────────────
-- Own profile row only (auth_id stores Supabase auth user id as text)
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()::text));

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE TO authenticated
  USING (auth_id = (SELECT auth.uid()::text))
  WITH CHECK (auth_id = (SELECT auth.uid()::text));

-- Read-only catalog data for signed-in users (covers Realtime SELECT on matches/sets)
-- TODO: replace with tighter rules (e.g. only tournaments you registered for) if needed
CREATE POLICY "teams_select_authenticated"
  ON public.teams FOR SELECT TO authenticated USING (true);

CREATE POLICY "team_members_select_authenticated"
  ON public.team_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "tournaments_select_authenticated"
  ON public.tournaments FOR SELECT TO authenticated USING (true);

CREATE POLICY "divisions_select_authenticated"
  ON public.divisions FOR SELECT TO authenticated USING (true);

CREATE POLICY "registrations_select_authenticated"
  ON public.registrations FOR SELECT TO authenticated USING (true);

CREATE POLICY "pools_select_authenticated"
  ON public.pools FOR SELECT TO authenticated USING (true);

CREATE POLICY "pool_teams_select_authenticated"
  ON public.pool_teams FOR SELECT TO authenticated USING (true);

CREATE POLICY "brackets_select_authenticated"
  ON public.brackets FOR SELECT TO authenticated USING (true);

CREATE POLICY "courts_select_authenticated"
  ON public.courts FOR SELECT TO authenticated USING (true);

CREATE POLICY "matches_select_authenticated"
  ON public.matches FOR SELECT TO authenticated USING (true);

CREATE POLICY "sets_select_authenticated"
  ON public.sets FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated on these tables:
-- writes go through Drizzle + server actions (postgres connection bypasses RLS).
-- If you later use supabase.from('matches').insert() from the client, add explicit policies.

-- anon: no policies above → cannot read/write app tables (good default)
