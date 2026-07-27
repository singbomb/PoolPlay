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

-- Multi-tier brackets (gold / silver / bronze) per division.
-- Host sets how many brackets and how many teams advance to gold (and silver).

ALTER TABLE public.divisions
  ADD COLUMN IF NOT EXISTS bracket_count integer NOT NULL DEFAULT 1;

ALTER TABLE public.divisions
  ADD COLUMN IF NOT EXISTS gold_team_count integer;

ALTER TABLE public.divisions
  ADD COLUMN IF NOT EXISTS silver_team_count integer;

ALTER TABLE public.divisions
  DROP CONSTRAINT IF EXISTS divisions_bracket_count_check;

ALTER TABLE public.divisions
  ADD CONSTRAINT divisions_bracket_count_check
  CHECK (bracket_count >= 1 AND bracket_count <= 3);

ALTER TABLE public.brackets
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.brackets
  ADD COLUMN IF NOT EXISTS tier integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.divisions.bracket_count IS
  'Number of elimination brackets (1=gold only, 2=gold+silver, 3=gold+silver+bronze).';

COMMENT ON COLUMN public.divisions.gold_team_count IS
  'Teams that advance to the gold bracket from pool play.';

COMMENT ON COLUMN public.divisions.silver_team_count IS
  'Teams that advance to the silver bracket when bracket_count is 3; remainder go to bronze.';

COMMENT ON COLUMN public.brackets.tier IS
  '0=Gold, 1=Silver, 2=Bronze.';
