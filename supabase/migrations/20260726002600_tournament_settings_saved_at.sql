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

-- Track when organizers explicitly save pool / bracket settings panels.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS pool_settings_saved_at timestamptz;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS bracket_settings_saved_at timestamptz;

-- Tournaments that already generated pool matches have confirmed pool settings.
UPDATE public.tournaments t
SET pool_settings_saved_at = t.updated_at
WHERE t.pool_settings_saved_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.divisions d
    INNER JOIN public.pools p ON p.division_id = d.id
    INNER JOIN public.matches m ON m.pool_id = p.id
    WHERE d.tournament_id = t.id
  );

-- Single-bracket defaults or tier counts already configured.
UPDATE public.tournaments t
SET bracket_settings_saved_at = t.updated_at
WHERE t.bracket_settings_saved_at IS NULL
  AND (
    t.bracket_count <= 1
    OR (t.bracket_count >= 2 AND t.gold_team_count IS NOT NULL)
  );
