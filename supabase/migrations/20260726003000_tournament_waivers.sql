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

CREATE TYPE waiver_completion_method AS ENUM (
  'digital',
  'captain_attested',
  'host_override'
);

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS waiver_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_allow_download_print boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS waiver_allow_third_party boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_allow_digital_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_third_party_url text,
  ADD COLUMN IF NOT EXISTS waiver_required_before_check_in boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS tournament_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  version integer NOT NULL,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, version)
);

CREATE INDEX IF NOT EXISTS tournament_waivers_tournament_id_idx
  ON tournament_waivers (tournament_id);

CREATE TABLE IF NOT EXISTS waiver_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiver_id uuid NOT NULL REFERENCES tournament_waivers(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method waiver_completion_method NOT NULL,
  signed_name text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  attested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  waived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (waiver_id, user_id)
);

CREATE INDEX IF NOT EXISTS waiver_completions_team_waiver_idx
  ON waiver_completions (waiver_id, team_id);

CREATE INDEX IF NOT EXISTS waiver_completions_tournament_team_idx
  ON waiver_completions (tournament_id, team_id);
