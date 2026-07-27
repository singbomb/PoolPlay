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

-- Tournaments are hosted by a school (not an individual team).
ALTER TABLE tournaments
  ADD COLUMN host_school_id uuid REFERENCES schools(id) ON DELETE SET NULL;

UPDATE tournaments t
SET host_school_id = tm.school_id
FROM teams tm
WHERE t.host_team_id = tm.id AND tm.school_id IS NOT NULL;

ALTER TABLE tournaments DROP COLUMN host_team_id;

CREATE INDEX tournaments_host_school_id_idx ON tournaments (host_school_id);
