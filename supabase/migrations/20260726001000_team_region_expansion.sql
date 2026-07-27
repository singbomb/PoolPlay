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

-- Additional team/tournament regions (enum values are append-only in Postgres).

ALTER TYPE team_region ADD VALUE IF NOT EXISTS 'northeast';
ALTER TYPE team_region ADD VALUE IF NOT EXISTS 'northwest';
ALTER TYPE team_region ADD VALUE IF NOT EXISTS 'east_central';

-- East and West regions.

ALTER TYPE team_region ADD VALUE IF NOT EXISTS 'east';
ALTER TYPE team_region ADD VALUE IF NOT EXISTS 'west';
