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

-- Human-readable match slugs scoped per tournament (e.g. stanford-vs-ucla).
-- Adds denormalized tournament_id for uniqueness and backfills existing rows.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS slug text;

UPDATE public.matches m
SET tournament_id = d.tournament_id
FROM public.pools p
JOIN public.divisions d ON d.id = p.division_id
WHERE m.pool_id = p.id
  AND m.tournament_id IS NULL;

UPDATE public.matches m
SET tournament_id = d.tournament_id
FROM public.brackets b
JOIN public.divisions d ON d.id = b.division_id
WHERE m.bracket_id = b.id
  AND m.tournament_id IS NULL;

UPDATE public.matches m
SET slug = ta.slug || '-vs-' || tb.slug
FROM public.teams ta,
     public.teams tb
WHERE m.team_a_id = ta.id
  AND m.team_b_id = tb.id
  AND m.slug IS NULL;

UPDATE public.matches m
SET slug = 'round-' || m.bracket_round || '-match-' || m.bracket_position
WHERE m.slug IS NULL
  AND m.bracket_round IS NOT NULL
  AND m.bracket_position IS NOT NULL;

UPDATE public.matches
SET slug = 'match-' || substring(id::text, 1, 8)
WHERE slug IS NULL;

WITH numbered AS (
  SELECT
    id,
    slug AS base,
    tournament_id,
    ROW_NUMBER() OVER (
      PARTITION BY tournament_id, slug
      ORDER BY id
    ) AS rn
  FROM public.matches
)
UPDATE public.matches m
SET slug = CASE
  WHEN n.rn = 1 THEN n.base
  ELSE n.base || '-' || n.rn
END
FROM numbered n
WHERE m.id = n.id
  AND n.rn > 1;

ALTER TABLE public.matches
  ALTER COLUMN tournament_id SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS matches_tournament_slug_unique
  ON public.matches (tournament_id, slug);
