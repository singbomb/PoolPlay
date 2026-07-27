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

-- Foreign-key indexes for frequently-filtered columns.
-- PostgreSQL does not create indexes for FKs automatically; these were
-- missing and caused sequential scans on the tournament detail page, the
-- registration flow, and auto-scheduling queries as data grew.

-- Tournament-scoped lookups (divisions/courts/registrations by tournament)
CREATE INDEX IF NOT EXISTS divisions_tournament_id_idx
  ON divisions (tournament_id);

CREATE INDEX IF NOT EXISTS courts_tournament_id_idx
  ON courts (tournament_id);

CREATE INDEX IF NOT EXISTS registrations_tournament_id_idx
  ON registrations (tournament_id);

CREATE INDEX IF NOT EXISTS registrations_team_id_idx
  ON registrations (team_id);

CREATE INDEX IF NOT EXISTS registrations_division_id_idx
  ON registrations (division_id);

-- Court ↔ division junction (filtered by either side)
CREATE INDEX IF NOT EXISTS court_divisions_court_id_idx
  ON court_divisions (court_id);

CREATE INDEX IF NOT EXISTS court_divisions_division_id_idx
  ON court_divisions (division_id);

-- "My teams" + captain-team queries on the register page
CREATE INDEX IF NOT EXISTS team_members_user_id_idx
  ON team_members (user_id);

CREATE INDEX IF NOT EXISTS team_members_team_id_idx
  ON team_members (team_id);

-- Pools/brackets/matches (scheduling + scoring pages)
CREATE INDEX IF NOT EXISTS pools_division_id_idx
  ON pools (division_id);

CREATE INDEX IF NOT EXISTS brackets_division_id_idx
  ON brackets (division_id);

CREATE INDEX IF NOT EXISTS pool_teams_pool_id_idx
  ON pool_teams (pool_id);

CREATE INDEX IF NOT EXISTS pool_teams_team_id_idx
  ON pool_teams (team_id);

CREATE INDEX IF NOT EXISTS matches_pool_id_idx
  ON matches (pool_id);

CREATE INDEX IF NOT EXISTS matches_bracket_id_idx
  ON matches (bracket_id);

CREATE INDEX IF NOT EXISTS matches_court_id_idx
  ON matches (court_id);

CREATE INDEX IF NOT EXISTS sets_match_id_idx
  ON sets (match_id);
