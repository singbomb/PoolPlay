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

-- Tournament-wide pool standings / seeding tie-break criteria.
-- Stored as an ordered JSON array of keys.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS pool_tiebreak_criteria jsonb
    NOT NULL
    DEFAULT '["match_record","set_record","point_diff","head_to_head"]'::jsonb;
