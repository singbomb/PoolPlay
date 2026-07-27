-- Restrict browser database access to the tables used by Realtime.
-- Keep elevated RLS helpers outside the exposed public API schema.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.current_user_can_access_tournament_chat(
  target_tournament_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.tournaments t ON t.id = target_tournament_id
    WHERE u.auth_id = (SELECT auth.uid()::text)
      AND u.disabled_at IS NULL
      AND (
        t.organizer_id = u.id
        OR u.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.school_members sm
          WHERE sm.school_id = t.host_school_id
            AND sm.user_id = u.id
            AND sm.role IN ('president', 'officer')
        )
        OR EXISTS (
          SELECT 1
          FROM public.registrations r
          JOIN public.team_members tm ON tm.team_id = r.team_id
          WHERE r.tournament_id = t.id
            AND tm.user_id = u.id
            AND r.status IN ('confirmed', 'checked_in')
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.current_user_can_view_match(
  target_match_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.matches m ON m.id = target_match_id
    JOIN public.tournaments t ON t.id = m.tournament_id
    LEFT JOIN public.pools p ON p.id = m.pool_id
    LEFT JOIN public.divisions pool_div
      ON pool_div.id = p.division_id
      AND pool_div.tournament_id = t.id
    LEFT JOIN public.brackets b ON b.id = m.bracket_id
    LEFT JOIN public.divisions bracket_div
      ON bracket_div.id = b.division_id
      AND bracket_div.tournament_id = t.id
    WHERE u.auth_id = (SELECT auth.uid()::text)
      AND u.disabled_at IS NULL
      AND (
        t.organizer_id = u.id
        OR u.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.school_members sm
          WHERE sm.school_id = t.host_school_id
            AND sm.user_id = u.id
            AND sm.role IN ('president', 'officer')
        )
        OR (
          (
            pool_div.pools_released_at IS NOT NULL
            OR bracket_div.pools_released_at IS NOT NULL
          )
          AND (
            t.status <> 'draft'
            OR EXISTS (
              SELECT 1
              FROM public.school_members sm
              WHERE sm.school_id = t.host_school_id
                AND sm.user_id = u.id
            )
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION
  app_private.current_user_can_access_tournament_chat(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.current_user_can_view_match(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_private.current_user_can_access_tournament_chat(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.current_user_can_view_match(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "matches_select_visible_tournament" ON public.matches;
DROP POLICY IF EXISTS "matches_select_released_or_managed" ON public.matches;
CREATE POLICY "matches_select_released_or_managed"
  ON public.matches FOR SELECT TO authenticated
  USING (app_private.current_user_can_view_match(id));

DROP POLICY IF EXISTS "sets_select_visible_tournament" ON public.sets;
DROP POLICY IF EXISTS "sets_select_released_or_managed" ON public.sets;
CREATE POLICY "sets_select_released_or_managed"
  ON public.sets FOR SELECT TO authenticated
  USING (app_private.current_user_can_view_match(match_id));

DROP POLICY IF EXISTS "tournament_chat_channels_select"
  ON public.tournament_chat_channels;

DROP POLICY IF EXISTS "tournament_chat_messages_select"
  ON public.tournament_chat_messages;
CREATE POLICY "tournament_chat_messages_select"
  ON public.tournament_chat_messages FOR SELECT TO authenticated
  USING (
    app_private.current_user_can_access_tournament_chat(tournament_id)
  );

DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "teams_select_authenticated" ON public.teams;
DROP POLICY IF EXISTS "team_members_select_authenticated"
  ON public.team_members;
DROP POLICY IF EXISTS "tournaments_select_authenticated"
  ON public.tournaments;
DROP POLICY IF EXISTS "divisions_select_authenticated" ON public.divisions;
DROP POLICY IF EXISTS "registrations_select_authenticated"
  ON public.registrations;
DROP POLICY IF EXISTS "pools_select_authenticated" ON public.pools;
DROP POLICY IF EXISTS "pool_teams_select_authenticated" ON public.pool_teams;
DROP POLICY IF EXISTS "brackets_select_authenticated" ON public.brackets;
DROP POLICY IF EXISTS "courts_select_authenticated" ON public.courts;
DROP POLICY IF EXISTS "court_divisions_select_authenticated"
  ON public.court_divisions;
DROP POLICY IF EXISTS "schools_select_authenticated" ON public.schools;
DROP POLICY IF EXISTS "school_members_select_authenticated"
  ON public.school_members;
DROP POLICY IF EXISTS "tournament_chat_read_cursors_select_own"
  ON public.tournament_chat_read_cursors;

REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.teams FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.team_members FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tournaments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.divisions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.registrations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.pools FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.pool_teams FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.brackets FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.courts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.court_divisions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.schools FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.school_members FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tournament_chat_read_cursors
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.content_flags FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.matches FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.sets FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tournament_chat_channels
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tournament_chat_messages
  FROM anon, authenticated;

GRANT SELECT ON TABLE public.matches TO authenticated;
GRANT SELECT ON TABLE public.sets TO authenticated;
GRANT SELECT ON TABLE public.tournament_chat_messages TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS
  public.current_user_can_access_tournament_chat(uuid);
DROP FUNCTION IF EXISTS public.current_user_can_view_tournament(uuid);
