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

CREATE TYPE public.team_verification_status AS ENUM ('pending', 'verified', 'rejected');

ALTER TABLE public.teams
  ADD COLUMN verification_status public.team_verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

UPDATE public.teams
SET verification_status = 'verified'
WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teams_verification_status_idx
  ON public.teams (verification_status);

CREATE INDEX IF NOT EXISTS teams_standalone_pending_idx
  ON public.teams (verification_status)
  WHERE school_id IS NULL;
