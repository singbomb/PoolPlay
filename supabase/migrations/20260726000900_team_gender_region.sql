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

-- Team gender & region; tournaments inherit from hosting team.

CREATE TYPE team_gender AS ENUM ('mens', 'womens');
CREATE TYPE team_region AS ENUM ('north', 'central', 'south', 'southeast');

ALTER TABLE teams
  ADD COLUMN gender team_gender NOT NULL DEFAULT 'mens',
  ADD COLUMN region team_region NOT NULL DEFAULT 'south';

ALTER TABLE teams ALTER COLUMN gender DROP DEFAULT;
ALTER TABLE teams ALTER COLUMN region DROP DEFAULT;

ALTER TABLE tournaments
  ADD COLUMN host_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN gender team_gender NOT NULL DEFAULT 'mens',
  ADD COLUMN region team_region NOT NULL DEFAULT 'south';

ALTER TABLE tournaments ALTER COLUMN gender DROP DEFAULT;
ALTER TABLE tournaments ALTER COLUMN region DROP DEFAULT;

-- Same school may field separate men's and women's teams.
CREATE UNIQUE INDEX teams_name_university_gender_unique
  ON teams (name, university, gender);

CREATE INDEX tournaments_gender_region_idx ON tournaments (gender, region);
CREATE INDEX tournaments_host_team_id_idx ON tournaments (host_team_id);
