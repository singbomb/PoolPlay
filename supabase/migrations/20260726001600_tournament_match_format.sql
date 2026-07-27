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

-- Tournament-wide match format settings drive scoring defaults and auto-finalization.
-- play_all_3:        play all 3 sets regardless of standing (common 3-team pool format)
-- best_of_2:         play exactly 2 sets, ties allowed (broken by points in standings)
-- two_with_tiebreak: play 2 sets; if 1-1, play a 3rd tiebreak set
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_format') THEN
    CREATE TYPE public.match_format AS ENUM (
      'play_all_3',
      'best_of_2',
      'two_with_tiebreak'
    );
  END IF;
END $$;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS match_format public.match_format
    NOT NULL DEFAULT 'two_with_tiebreak',
  ADD COLUMN IF NOT EXISTS set_starting_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS set_target_score integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS tiebreak_target_score integer NOT NULL DEFAULT 15;
