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

-- One row per set per match; one registration per team per tournament.
-- Remove duplicates first so the unique indexes can be applied safely.

DELETE FROM sets a
USING sets b
WHERE a.match_id = b.match_id
  AND a.set_number = b.set_number
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS sets_match_set_number_unique
  ON sets (match_id, set_number);

DELETE FROM registrations a
USING registrations b
WHERE a.team_id = b.team_id
  AND a.tournament_id = b.tournament_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_team_tournament_unique
  ON registrations (team_id, tournament_id);
