-- Make registration, payment, and scoring operations auditable and safe under
-- concurrent server requests. Browser clients remain read-only; all mutations
-- continue to use the trusted server-side Postgres connection.

ALTER TABLE public.registrations
  ADD COLUMN revision integer NOT NULL DEFAULT 0;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_revision_nonnegative
  CHECK (revision >= 0);

ALTER TABLE public.divisions
  ADD CONSTRAINT divisions_id_tournament_unique
  UNIQUE (id, tournament_id);

DO $$
DECLARE
  mismatch_details text;
BEGIN
  SELECT string_agg(
    format(
      'registration=%s division=%s registration_tournament=%s division_tournament=%s',
      mismatch.id,
      mismatch.division_id,
      mismatch.registration_tournament_id,
      mismatch.division_tournament_id
    ),
    '; '
  )
  INTO mismatch_details
  FROM (
    SELECT
      registration.id,
      registration.division_id,
      registration.tournament_id AS registration_tournament_id,
      division.tournament_id AS division_tournament_id
    FROM public.registrations registration
    JOIN public.divisions division
      ON division.id = registration.division_id
    WHERE registration.tournament_id <> division.tournament_id
    ORDER BY registration.id
    LIMIT 20
  ) mismatch;

  IF mismatch_details IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce registration division ownership: %',
      mismatch_details
      USING HINT =
        'Unassign or correct the listed registrations before retrying this migration.';
  END IF;
END
$$;

ALTER TABLE public.registrations
  DROP CONSTRAINT registrations_division_id_divisions_id_fk;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_division_tournament_fk
  FOREIGN KEY (division_id, tournament_id)
  REFERENCES public.divisions (id, tournament_id)
  ON DELETE RESTRICT;

CREATE INDEX registrations_division_tournament_idx
  ON public.registrations (division_id, tournament_id);

WITH ranked_pool_teams AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pool_id, team_id
      ORDER BY seed ASC NULLS LAST, id
    ) AS duplicate_rank
  FROM public.pool_teams
)
DELETE FROM public.pool_teams pool_team
USING ranked_pool_teams ranked
WHERE pool_team.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX pool_teams_pool_team_unique
  ON public.pool_teams (pool_id, team_id);

DO $$
DECLARE
  double_elimination_match_count bigint;
  double_elimination_match_details text;
BEGIN
  SELECT count(*)
  INTO double_elimination_match_count
  FROM public.matches match_row
  JOIN public.brackets bracket_row
    ON bracket_row.id = match_row.bracket_id
  JOIN public.divisions division_row
    ON division_row.id = bracket_row.division_id
  JOIN public.tournaments tournament_row
    ON tournament_row.id = match_row.tournament_id
  WHERE bracket_row.bracket_type = 'double_elimination'
    OR division_row.format = 'double_elimination'
    OR tournament_row.play_format = 'double_elimination';

  IF double_elimination_match_count > 0 THEN
    SELECT string_agg(
      format(
        'match=%s bracket=%s division=%s round=%s position=%s',
        unsupported.match_id,
        unsupported.bracket_id,
        unsupported.division_id,
        unsupported.bracket_round,
        unsupported.bracket_position
      ),
      '; '
    )
    INTO double_elimination_match_details
    FROM (
      SELECT
        match_row.id AS match_id,
        match_row.bracket_id,
        bracket_row.division_id,
        match_row.bracket_round,
        match_row.bracket_position
      FROM public.matches match_row
      JOIN public.brackets bracket_row
        ON bracket_row.id = match_row.bracket_id
      JOIN public.divisions division_row
        ON division_row.id = bracket_row.division_id
      JOIN public.tournaments tournament_row
        ON tournament_row.id = match_row.tournament_id
      WHERE bracket_row.bracket_type = 'double_elimination'
        OR division_row.format = 'double_elimination'
        OR tournament_row.play_format = 'double_elimination'
      ORDER BY match_row.id
      LIMIT 20
    ) unsupported;

    RAISE EXCEPTION
      'Cannot enforce unique bracket coordinates: found % double-elimination bracket match rows: %',
      double_elimination_match_count,
      double_elimination_match_details
      USING HINT =
        'Remove or migrate the listed double-elimination matches before retrying this migration.';
  END IF;
END
$$;

DO $$
DECLARE
  duplicate_details text;
BEGIN
  SELECT string_agg(
    format(
      'bracket=%s round=%s position=%s rows=%s',
      duplicate.bracket_id,
      duplicate.bracket_round,
      duplicate.bracket_position,
      duplicate.row_count
    ),
    '; '
  )
  INTO duplicate_details
  FROM (
    SELECT
      bracket_id,
      bracket_round,
      bracket_position,
      count(*) AS row_count
    FROM public.matches
    WHERE bracket_id IS NOT NULL
      AND bracket_round IS NOT NULL
      AND bracket_position IS NOT NULL
    GROUP BY bracket_id, bracket_round, bracket_position
    HAVING count(*) > 1
    ORDER BY bracket_id, bracket_round, bracket_position
    LIMIT 20
  ) duplicate;

  IF duplicate_details IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce unique bracket coordinates: %',
      duplicate_details
      USING HINT =
        'Resolve the listed duplicate matches before retrying this migration.';
  END IF;
END
$$;

CREATE UNIQUE INDEX matches_bracket_coordinate_unique
  ON public.matches (bracket_id, bracket_round, bracket_position)
  WHERE bracket_id IS NOT NULL
    AND bracket_round IS NOT NULL
    AND bracket_position IS NOT NULL;

CREATE TABLE public.registration_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid
    REFERENCES public.registrations (id) ON DELETE SET NULL,
  tournament_id uuid NOT NULL
    REFERENCES public.tournaments (id) ON DELETE CASCADE,
  team_id uuid NOT NULL
    REFERENCES public.teams (id) ON DELETE CASCADE,
  from_status registration_status,
  to_status registration_status NOT NULL,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  operation_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_status_events_team_operation_unique
    UNIQUE (tournament_id, team_id, operation_id)
);

CREATE INDEX registration_status_events_tournament_id_idx
  ON public.registration_status_events (tournament_id);
CREATE INDEX registration_status_events_registration_id_idx
  ON public.registration_status_events (registration_id);
CREATE INDEX registration_status_events_team_id_idx
  ON public.registration_status_events (team_id);
CREATE INDEX registration_status_events_actor_user_id_idx
  ON public.registration_status_events (actor_user_id);
CREATE INDEX registration_status_events_operation_id_idx
  ON public.registration_status_events (operation_id);

CREATE TABLE public.registration_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid
    REFERENCES public.registration_payments (id) ON DELETE SET NULL,
  registration_id uuid
    REFERENCES public.registrations (id) ON DELETE SET NULL,
  tournament_id uuid NOT NULL
    REFERENCES public.tournaments (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  from_status registration_payment_status NOT NULL,
  to_status registration_payment_status NOT NULL,
  operation_id uuid NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_payment_events_operation_unique
    UNIQUE (operation_id)
);

CREATE INDEX registration_payment_events_payment_id_idx
  ON public.registration_payment_events (payment_id);
CREATE INDEX registration_payment_events_registration_id_idx
  ON public.registration_payment_events (registration_id);
CREATE INDEX registration_payment_events_tournament_id_idx
  ON public.registration_payment_events (tournament_id);
CREATE INDEX registration_payment_events_actor_user_id_idx
  ON public.registration_payment_events (actor_user_id);

ALTER TABLE public.registration_payments
  ADD CONSTRAINT registration_payments_amount_nonnegative
  CHECK (amount_cents >= 0);

ALTER TABLE public.registration_payments
  ADD CONSTRAINT registration_payments_terminal_metadata_consistent
  CHECK (
    NOT (confirmed_at IS NOT NULL AND waived_at IS NOT NULL)
    AND (
      status <> 'confirmed'
      OR confirmed_at IS NOT NULL
    )
    AND (
      status <> 'waived'
      OR waived_at IS NOT NULL
    )
    AND (
      status <> 'submitted'
      OR (
        submitted_method IS NOT NULL
        AND submitted_at IS NOT NULL
      )
    )
  );

ALTER TABLE public.matches
  ADD COLUMN score_revision integer NOT NULL DEFAULT 0;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_score_revision_nonnegative
  CHECK (score_revision >= 0);

CREATE TABLE public.match_score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL
    REFERENCES public.matches (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  set_number integer,
  previous_value jsonb,
  new_value jsonb,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_score_events_match_revision_unique
    UNIQUE (match_id, revision),
  CONSTRAINT match_score_events_revision_positive
    CHECK (revision > 0),
  CONSTRAINT match_score_events_correction_reason_length
    CHECK (
      correction_reason IS NULL
      OR char_length(correction_reason) <= 500
    ),
  CONSTRAINT match_score_events_event_type_check
    CHECK (
      event_type IN (
        'set_score_saved',
        'match_finalized',
        'match_reopened',
        'downstream_invalidated',
        'warmup_started',
        'match_started',
        'match_paused'
      )
    )
);

CREATE INDEX match_score_events_actor_user_id_idx
  ON public.match_score_events (actor_user_id);

ALTER TABLE public.registration_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_score_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.registration_status_events
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.registration_payment_events
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.match_score_events
  FROM anon, authenticated;
