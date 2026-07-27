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

CREATE TYPE tournament_chat_channel_kind AS ENUM (
  'announcements',
  'questions',
  'general'
);

CREATE TABLE IF NOT EXISTS tournament_chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  kind tournament_chat_channel_kind NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, kind)
);

CREATE TABLE IF NOT EXISTS tournament_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES tournament_chat_channels(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournament_chat_messages_channel_id_created_at_idx
  ON tournament_chat_messages (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tournament_chat_messages_tournament_id_idx
  ON tournament_chat_messages (tournament_id);

CREATE INDEX IF NOT EXISTS tournament_chat_messages_author_created_at_idx
  ON tournament_chat_messages (author_user_id, channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_chat_read_cursors (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES tournament_chat_channels(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

ALTER TABLE public.tournament_chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_chat_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_chat_channels_select"
  ON public.tournament_chat_channels FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.tournaments t ON t.id = tournament_chat_channels.tournament_id
      WHERE u.auth_id = (SELECT auth.uid()::text)
        AND (
          t.organizer_id = u.id
          OR EXISTS (
            SELECT 1
            FROM public.registrations r
            JOIN public.team_members tm ON tm.team_id = r.team_id
            WHERE r.tournament_id = t.id
              AND tm.user_id = u.id
              AND r.status IN ('confirmed', 'checked_in')
          )
        )
    )
  );

CREATE POLICY "tournament_chat_messages_select"
  ON public.tournament_chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.tournaments t ON t.id = tournament_chat_messages.tournament_id
      WHERE u.auth_id = (SELECT auth.uid()::text)
        AND (
          t.organizer_id = u.id
          OR EXISTS (
            SELECT 1
            FROM public.registrations r
            JOIN public.team_members tm ON tm.team_id = r.team_id
            WHERE r.tournament_id = t.id
              AND tm.user_id = u.id
              AND r.status IN ('confirmed', 'checked_in')
          )
        )
    )
  );

CREATE POLICY "tournament_chat_read_cursors_select_own"
  ON public.tournament_chat_read_cursors FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid()::text)
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE tournament_chat_messages;
