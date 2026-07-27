-- Add the persisted graph primitives needed for reliable double-elimination
-- advancement. The feature remains disabled until the application writes and
-- consumes sections, activation states, and feed edges atomically.
-- Production ledger version: 20260727120309.

DO $$
DECLARE
  legacy_details text;
BEGIN
  SELECT string_agg(
    format(
      '%s=%s format=%s',
      legacy.object_kind,
      legacy.object_id,
      legacy.format
    ),
    '; '
  )
  INTO legacy_details
  FROM (
    SELECT *
    FROM (
      SELECT
        'tournament'::text AS object_kind,
        tournament.id AS object_id,
        tournament.play_format::text AS format
      FROM public.tournaments tournament
      WHERE tournament.play_format = 'double_elimination'

      UNION ALL

      SELECT
        'division'::text,
        division.id,
        division.format::text
      FROM public.divisions division
      WHERE division.format = 'double_elimination'

      UNION ALL

      SELECT
        'bracket'::text,
        bracket.id,
        bracket.bracket_type::text
      FROM public.brackets bracket
      WHERE bracket.bracket_type = 'double_elimination'
    ) legacy_row
    ORDER BY legacy_row.object_kind, legacy_row.object_id
    LIMIT 20
  ) legacy;

  IF legacy_details IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add the double-elimination graph while legacy double-elimination rows exist: %',
      legacy_details
      USING HINT =
        'Remove or explicitly migrate the listed draft structures before retrying this migration.';
  END IF;
END
$$;

DO $$
DECLARE
  invalid_details text;
BEGIN
  SELECT string_agg(
    format(
      'match=%s reason=%s',
      invalid.match_id,
      invalid.reason
    ),
    '; '
  )
  INTO invalid_details
  FROM (
    SELECT *
    FROM (
      SELECT match_row.id AS match_id, 'pool_and_bracket'::text AS reason
      FROM public.matches match_row
      WHERE match_row.pool_id IS NOT NULL
        AND match_row.bracket_id IS NOT NULL

      UNION ALL

      SELECT match_row.id, 'incomplete_or_nonpositive_bracket_coordinate'
      FROM public.matches match_row
      WHERE match_row.bracket_id IS NOT NULL
        AND (
          match_row.bracket_round IS NULL
          OR match_row.bracket_position IS NULL
          OR match_row.bracket_round <= 0
          OR match_row.bracket_position <= 0
        )

      UNION ALL

      SELECT match_row.id, 'bracket_coordinate_without_bracket'
      FROM public.matches match_row
      WHERE match_row.bracket_id IS NULL
        AND (
          match_row.bracket_round IS NOT NULL
          OR match_row.bracket_position IS NOT NULL
        )

      UNION ALL

      SELECT match_row.id, 'duplicate_participant'
      FROM public.matches match_row
      WHERE match_row.team_a_id IS NOT NULL
        AND match_row.team_a_id = match_row.team_b_id

      UNION ALL

      SELECT match_row.id, 'winner_is_not_a_participant'
      FROM public.matches match_row
      WHERE match_row.winner_id IS NOT NULL
        AND match_row.winner_id IS DISTINCT FROM match_row.team_a_id
        AND match_row.winner_id IS DISTINCT FROM match_row.team_b_id

      UNION ALL

      SELECT match_row.id, 'completed_bracket_without_winner'
      FROM public.matches match_row
      WHERE match_row.bracket_id IS NOT NULL
        AND match_row.status = 'completed'
        AND match_row.winner_id IS NULL

      UNION ALL

      SELECT match_row.id, 'bracket_tournament_mismatch'
      FROM public.matches match_row
      JOIN public.brackets bracket_row
        ON bracket_row.id = match_row.bracket_id
      JOIN public.divisions division_row
        ON division_row.id = bracket_row.division_id
      WHERE match_row.tournament_id <> division_row.tournament_id
    ) invalid_row
    ORDER BY invalid_row.match_id, invalid_row.reason
    LIMIT 20
  ) invalid;

  IF invalid_details IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add the double-elimination graph because existing match data violates its invariants: %',
      invalid_details
      USING HINT =
        'Correct the listed match rows before retrying this migration.';
  END IF;
END
$$;

CREATE TYPE public.bracket_section AS ENUM (
  'main',
  'winners',
  'losers',
  'grand_final'
);

CREATE TYPE public.bracket_activation AS ENUM (
  'required',
  'conditional',
  'not_required'
);

CREATE TYPE public.bracket_outcome AS ENUM (
  'winner',
  'loser'
);

CREATE TYPE public.bracket_target_slot AS ENUM (
  'team_a',
  'team_b'
);

CREATE TYPE public.bracket_feed_condition AS ENUM (
  'always',
  'source_team_b_wins'
);

ALTER TABLE public.brackets
  ADD COLUMN topology_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.brackets
  ADD CONSTRAINT brackets_topology_version_positive
  CHECK (topology_version > 0);

ALTER TABLE public.matches
  ADD COLUMN bracket_section public.bracket_section,
  ADD COLUMN bracket_activation public.bracket_activation;

UPDATE public.matches
SET
  bracket_section = 'main',
  bracket_activation = 'required'
WHERE bracket_id IS NOT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT matches_bracket_id_brackets_id_fk;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_bracket_id_brackets_id_fk
  FOREIGN KEY (bracket_id)
  REFERENCES public.brackets (id)
  ON DELETE CASCADE;

DROP INDEX public.matches_bracket_coordinate_unique;

CREATE UNIQUE INDEX matches_id_bracket_unique
  ON public.matches (id, bracket_id);

CREATE UNIQUE INDEX matches_bracket_coordinate_unique
  ON public.matches (
    bracket_id,
    bracket_section,
    bracket_round,
    bracket_position
  )
  WHERE bracket_id IS NOT NULL
    AND bracket_section IS NOT NULL
    AND bracket_round IS NOT NULL
    AND bracket_position IS NOT NULL;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_bracket_metadata_check
  CHECK (
    (
      bracket_id IS NULL
      AND bracket_section IS NULL
      AND bracket_activation IS NULL
      AND bracket_round IS NULL
      AND bracket_position IS NULL
    )
    OR
    (
      bracket_id IS NOT NULL
      AND pool_id IS NULL
      AND bracket_section IS NOT NULL
      AND bracket_activation IS NOT NULL
      AND bracket_round IS NOT NULL
      AND bracket_position IS NOT NULL
      AND bracket_round > 0
      AND bracket_position > 0
    )
  );

ALTER TABLE public.matches
  ADD CONSTRAINT matches_distinct_participants_check
  CHECK (
    team_a_id IS NULL
    OR team_b_id IS NULL
    OR team_a_id <> team_b_id
  );

ALTER TABLE public.matches
  ADD CONSTRAINT matches_winner_is_participant_check
  CHECK (
    winner_id IS NULL
    OR coalesce(winner_id = team_a_id, false)
    OR coalesce(winner_id = team_b_id, false)
  );

ALTER TABLE public.matches
  ADD CONSTRAINT matches_completed_bracket_winner_check
  CHECK (
    bracket_id IS NULL
    OR status <> 'completed'
    OR bracket_activation = 'not_required'
    OR winner_id IS NOT NULL
  );

CREATE TABLE public.bracket_match_edges (
  bracket_id uuid NOT NULL
    REFERENCES public.brackets (id) ON DELETE CASCADE,
  source_match_id uuid NOT NULL,
  source_outcome public.bracket_outcome NOT NULL,
  target_match_id uuid NOT NULL,
  target_slot public.bracket_target_slot NOT NULL,
  condition public.bracket_feed_condition NOT NULL DEFAULT 'always',
  CONSTRAINT bracket_match_edges_pkey
    PRIMARY KEY (source_match_id, source_outcome),
  CONSTRAINT bracket_match_edges_target_slot_unique
    UNIQUE (target_match_id, target_slot),
  CONSTRAINT bracket_match_edges_no_self_edge_check
    CHECK (source_match_id <> target_match_id),
  CONSTRAINT bracket_match_edges_source_same_bracket_fk
    FOREIGN KEY (source_match_id, bracket_id)
    REFERENCES public.matches (id, bracket_id)
    ON DELETE CASCADE,
  CONSTRAINT bracket_match_edges_target_same_bracket_fk
    FOREIGN KEY (target_match_id, bracket_id)
    REFERENCES public.matches (id, bracket_id)
    ON DELETE CASCADE
);

CREATE INDEX bracket_match_edges_bracket_id_idx
  ON public.bracket_match_edges (bracket_id);

CREATE INDEX bracket_match_edges_source_bracket_idx
  ON public.bracket_match_edges (source_match_id, bracket_id);

CREATE INDEX bracket_match_edges_target_bracket_idx
  ON public.bracket_match_edges (target_match_id, bracket_id);

CREATE OR REPLACE FUNCTION app_private.enforce_bracket_tournament_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  owning_division_id uuid;
  owning_tournament_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'matches' THEN
    IF NEW.bracket_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF TG_WHEN = 'BEFORE' THEN
      SELECT bracket_row.division_id
      INTO owning_division_id
      FROM public.brackets bracket_row
      WHERE bracket_row.id = NEW.bracket_id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Match tournament must match its bracket division tournament'
          USING ERRCODE = '23503';
      END IF;

      SELECT division_row.tournament_id
      INTO owning_tournament_id
      FROM public.divisions division_row
      WHERE division_row.id = owning_division_id
      FOR SHARE;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.matches match_row
        WHERE match_row.id = NEW.id
          AND match_row.bracket_id IS NOT DISTINCT FROM NEW.bracket_id
          AND match_row.tournament_id = NEW.tournament_id
      ) THEN
        RETURN NEW;
      END IF;

      SELECT division_row.tournament_id
      INTO owning_tournament_id
      FROM public.brackets bracket_row
      JOIN public.divisions division_row
        ON division_row.id = bracket_row.division_id
      WHERE bracket_row.id = NEW.bracket_id;
    END IF;

    IF NOT FOUND OR NEW.tournament_id <> owning_tournament_id THEN
      RAISE EXCEPTION
        'Match tournament must match its bracket division tournament'
        USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'brackets' THEN
    IF NEW.division_id IS NOT DISTINCT FROM OLD.division_id THEN
      RETURN NEW;
    END IF;

    IF TG_WHEN = 'AFTER'
      AND NOT EXISTS (
        SELECT 1
        FROM public.brackets bracket_row
        WHERE bracket_row.id = NEW.id
          AND bracket_row.division_id = NEW.division_id
      )
    THEN
      RETURN NEW;
    END IF;

    SELECT division_row.tournament_id
    INTO owning_tournament_id
    FROM public.divisions division_row
    WHERE division_row.id = NEW.division_id
    FOR SHARE;

    IF FOUND AND EXISTS (
      SELECT 1
      FROM public.matches match_row
      WHERE match_row.bracket_id = NEW.id
        AND match_row.tournament_id <> owning_tournament_id
    ) THEN
      RAISE EXCEPTION
        'Bracket division tournament must match every bracket match tournament'
        USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_WHEN = 'AFTER'
    AND NOT EXISTS (
      SELECT 1
      FROM public.divisions division_row
      WHERE division_row.id = NEW.id
        AND division_row.tournament_id = NEW.tournament_id
    )
  THEN
    RETURN NEW;
  END IF;

  IF NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
    AND EXISTS (
      SELECT 1
      FROM public.brackets bracket_row
      JOIN public.matches match_row
        ON match_row.bracket_id = bracket_row.id
      WHERE bracket_row.division_id = NEW.id
        AND match_row.tournament_id <> NEW.tournament_id
    )
  THEN
    RAISE EXCEPTION
      'Division tournament must match every bracket match tournament'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  app_private.enforce_bracket_tournament_ownership()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER matches_enforce_bracket_tournament
BEFORE INSERT OR UPDATE OF bracket_id, tournament_id
ON public.matches
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE TRIGGER brackets_enforce_match_tournament
BEFORE UPDATE OF division_id
ON public.brackets
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE TRIGGER divisions_enforce_bracket_match_tournament
BEFORE UPDATE OF tournament_id
ON public.divisions
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE CONSTRAINT TRIGGER matches_validate_bracket_tournament
AFTER INSERT OR UPDATE OF bracket_id, tournament_id
ON public.matches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE CONSTRAINT TRIGGER brackets_validate_match_tournament
AFTER UPDATE OF division_id
ON public.brackets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE CONSTRAINT TRIGGER divisions_validate_bracket_match_tournament
AFTER UPDATE OF tournament_id
ON public.divisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_tournament_ownership();

CREATE OR REPLACE FUNCTION app_private.enforce_bracket_match_edge_acyclic()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM bracket_row.id
      FROM public.brackets bracket_row
      WHERE bracket_row.id = NEW.bracket_id
      FOR UPDATE;
    ELSIF TG_OP = 'UPDATE' THEN
      PERFORM bracket_row.id
      FROM public.brackets bracket_row
      WHERE bracket_row.id IN (OLD.bracket_id, NEW.bracket_id)
      ORDER BY bracket_row.id
      FOR UPDATE;
    ELSE
      PERFORM bracket_row.id
      FROM public.brackets bracket_row
      WHERE bracket_row.id = OLD.bracket_id
      FOR UPDATE;

      RETURN OLD;
    END IF;

    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bracket_match_edges edge
    WHERE edge.source_match_id = NEW.source_match_id
      AND edge.source_outcome = NEW.source_outcome
      AND edge.bracket_id = NEW.bracket_id
      AND edge.target_match_id = NEW.target_match_id
      AND edge.target_slot = NEW.target_slot
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH RECURSIVE reachable(match_id) AS (
      SELECT NEW.target_match_id

      UNION

      SELECT edge.target_match_id
      FROM public.bracket_match_edges edge
      JOIN reachable
        ON reachable.match_id = edge.source_match_id
      WHERE edge.bracket_id = NEW.bracket_id
    )
    SELECT 1
    FROM reachable
    WHERE reachable.match_id = NEW.source_match_id
  ) THEN
    RAISE EXCEPTION
      'Bracket match edges must not contain a cycle'
      USING ERRCODE = '23514',
        HINT = 'Remove the edge that routes a match back to one of its ancestors.';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  app_private.enforce_bracket_match_edge_acyclic()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bracket_match_edges_serialize
BEFORE INSERT OR UPDATE OR DELETE ON public.bracket_match_edges
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_match_edge_acyclic();

CREATE CONSTRAINT TRIGGER bracket_match_edges_acyclic
AFTER INSERT OR UPDATE ON public.bracket_match_edges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_bracket_match_edge_acyclic();

ALTER TABLE public.bracket_match_edges ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.bracket_match_edges
  FROM anon, authenticated;

COMMENT ON COLUMN public.brackets.topology_version IS
  'Version of the persisted bracket match-and-edge graph.';

COMMENT ON COLUMN public.matches.bracket_section IS
  'Coordinate namespace within a logical elimination bracket.';

COMMENT ON COLUMN public.matches.bracket_activation IS
  'Whether a generated bracket node is required, conditional, or auto-void.';

COMMENT ON TABLE public.bracket_match_edges IS
  'Explicit winner and loser feeds between matches in the same bracket.';
