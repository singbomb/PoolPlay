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

-- Adds URL-friendly `slug` columns to tournaments and teams.
-- Existing rows are backfilled by slugifying `name` with numeric suffixes on
-- collision; both columns become NOT NULL with unique indexes so they can
-- safely back the public URLs.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS slug text;

WITH base AS (
  SELECT
    id,
    NULLIF(
      regexp_replace(
        regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'),
        '(^-+)|(-+$)', '', 'g'
      ),
      ''
    ) AS base
  FROM public.tournaments
),
numbered AS (
  SELECT
    id,
    base,
    ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS rn
  FROM base
)
UPDATE public.tournaments t
SET slug = CASE
  WHEN n.base IS NULL THEN 'tournament-' || n.rn
  WHEN n.rn = 1 THEN n.base
  ELSE n.base || '-' || n.rn
END
FROM numbered n
WHERE t.id = n.id
  AND t.slug IS NULL;

WITH base AS (
  SELECT
    id,
    NULLIF(
      regexp_replace(
        regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'),
        '(^-+)|(-+$)', '', 'g'
      ),
      ''
    ) AS base
  FROM public.teams
),
numbered AS (
  SELECT
    id,
    base,
    ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS rn
  FROM base
)
UPDATE public.teams t
SET slug = CASE
  WHEN n.base IS NULL THEN 'team-' || n.rn
  WHEN n.rn = 1 THEN n.base
  ELSE n.base || '-' || n.rn
END
FROM numbered n
WHERE t.id = n.id
  AND t.slug IS NULL;

ALTER TABLE public.tournaments ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.teams ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_slug_unique ON public.tournaments (slug);
CREATE UNIQUE INDEX IF NOT EXISTS teams_slug_unique ON public.teams (slug);
