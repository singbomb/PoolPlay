-- Reproduce the RLS helper functions currently used by production policies.
-- Keep their elevated reads narrowly callable and deny disabled accounts.

CREATE OR REPLACE FUNCTION public.current_user_can_access_tournament_chat(
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

CREATE OR REPLACE FUNCTION public.current_user_can_view_tournament(
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
        t.status <> 'draft'
        OR t.organizer_id = u.id
        OR u.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.school_members sm
          WHERE sm.school_id = t.host_school_id
            AND sm.user_id = u.id
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_access_tournament_chat(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_view_tournament(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_can_access_tournament_chat(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_view_tournament(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "matches_select_authenticated" ON public.matches;
DROP POLICY IF EXISTS "matches_select_visible_tournament" ON public.matches;
CREATE POLICY "matches_select_visible_tournament"
  ON public.matches FOR SELECT TO authenticated
  USING (public.current_user_can_view_tournament(tournament_id));

DROP POLICY IF EXISTS "sets_select_authenticated" ON public.sets;
DROP POLICY IF EXISTS "sets_select_visible_tournament" ON public.sets;
CREATE POLICY "sets_select_visible_tournament"
  ON public.sets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.id = sets.match_id
        AND public.current_user_can_view_tournament(m.tournament_id)
    )
  );

DROP POLICY IF EXISTS "tournament_chat_channels_select"
  ON public.tournament_chat_channels;
CREATE POLICY "tournament_chat_channels_select"
  ON public.tournament_chat_channels FOR SELECT TO authenticated
  USING (public.current_user_can_access_tournament_chat(tournament_id));

DROP POLICY IF EXISTS "tournament_chat_messages_select"
  ON public.tournament_chat_messages;
CREATE POLICY "tournament_chat_messages_select"
  ON public.tournament_chat_messages FOR SELECT TO authenticated
  USING (public.current_user_can_access_tournament_chat(tournament_id));
