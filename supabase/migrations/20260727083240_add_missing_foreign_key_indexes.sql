-- Index every foreign key that was still missing a leading-column index.
-- These indexes protect parent deletes and common relationship joins.

CREATE INDEX IF NOT EXISTS matches_team_a_id_idx
  ON public.matches (team_a_id);
CREATE INDEX IF NOT EXISTS matches_team_b_id_idx
  ON public.matches (team_b_id);
CREATE INDEX IF NOT EXISTS matches_winner_id_idx
  ON public.matches (winner_id);

CREATE INDEX IF NOT EXISTS registration_payments_confirmed_by_user_id_idx
  ON public.registration_payments (confirmed_by_user_id);
CREATE INDEX IF NOT EXISTS registration_payments_submitted_by_user_id_idx
  ON public.registration_payments (submitted_by_user_id);
CREATE INDEX IF NOT EXISTS registration_payments_waived_by_user_id_idx
  ON public.registration_payments (waived_by_user_id);

CREATE INDEX IF NOT EXISTS schools_verified_by_user_id_idx
  ON public.schools (verified_by_user_id);
CREATE INDEX IF NOT EXISTS teams_verified_by_user_id_idx
  ON public.teams (verified_by_user_id);
CREATE INDEX IF NOT EXISTS tournaments_organizer_id_idx
  ON public.tournaments (organizer_id);

CREATE INDEX IF NOT EXISTS tournament_chat_messages_team_id_idx
  ON public.tournament_chat_messages (team_id);
CREATE INDEX IF NOT EXISTS tournament_chat_read_cursors_channel_id_idx
  ON public.tournament_chat_read_cursors (channel_id);
CREATE INDEX IF NOT EXISTS tournament_email_sends_sent_by_user_id_idx
  ON public.tournament_email_sends (sent_by_user_id);
CREATE INDEX IF NOT EXISTS tournament_waivers_uploaded_by_user_id_idx
  ON public.tournament_waivers (uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS waiver_completions_attested_by_user_id_idx
  ON public.waiver_completions (attested_by_user_id);
CREATE INDEX IF NOT EXISTS waiver_completions_team_id_idx
  ON public.waiver_completions (team_id);
CREATE INDEX IF NOT EXISTS waiver_completions_user_id_idx
  ON public.waiver_completions (user_id);
CREATE INDEX IF NOT EXISTS waiver_completions_waived_by_user_id_idx
  ON public.waiver_completions (waived_by_user_id);
