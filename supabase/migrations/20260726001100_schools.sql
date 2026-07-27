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

-- Schools as a first-class entity that owns multiple teams.
--
-- A school has one president plus officers, plus a master roster
-- (school_members). When a team is linked to a school, its team_members
-- must come from the school's master roster.
--
-- Verification is hybrid: presidents submit for review, the server flags
-- whether any officer's email matched the school's expected institutional
-- domain (domain_hint), and an admin makes the final approve/reject call.

CREATE TYPE public.school_member_role AS ENUM ('president', 'officer', 'member');
CREATE TYPE public.school_verification_status AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  university text NOT NULL,
  region public.team_region NOT NULL,
  description text,
  website_url text,
  domain_hint text,
  verification_status public.school_verification_status NOT NULL DEFAULT 'pending',
  domain_matched boolean NOT NULL DEFAULT false,
  verified_at timestamp,
  verified_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schools_verification_status_idx
  ON public.schools (verification_status);
CREATE INDEX IF NOT EXISTS schools_university_idx
  ON public.schools (university);

CREATE TABLE IF NOT EXISTS public.school_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.school_member_role NOT NULL DEFAULT 'member',
  title text,
  joined_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_members_school_user_unique
  ON public.school_members (school_id, user_id);

-- One president per school.
CREATE UNIQUE INDEX IF NOT EXISTS school_members_one_president_per_school
  ON public.school_members (school_id)
  WHERE role = 'president';

CREATE INDEX IF NOT EXISTS school_members_user_id_idx
  ON public.school_members (user_id);

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teams_school_id_idx ON public.teams (school_id);

-- RLS: writes go through Drizzle (postgres role) which bypasses RLS.
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schools_select_authenticated"
  ON public.schools FOR SELECT TO authenticated USING (true);

CREATE POLICY "school_members_select_authenticated"
  ON public.school_members FOR SELECT TO authenticated USING (true);
