\set ON_ERROR_STOP on

INSERT INTO public.users (
  id,
  auth_id,
  email,
  full_name,
  role
)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'organizer@example.test',
    'Bootstrap Organizer',
    'organizer'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'viewer@example.test',
    'Bootstrap Viewer',
    'player'
  );

INSERT INTO public.tournaments (
  id,
  organizer_id,
  gender,
  region,
  name,
  slug,
  date,
  location,
  status
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'mens',
  'north',
  'Bootstrap Tournament',
  'bootstrap-tournament',
  '2026-01-01',
  'Bootstrap Gym',
  'draft'
);

INSERT INTO public.divisions (
  id,
  tournament_id,
  name,
  pools_released_at
)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'Open',
  NULL
);

INSERT INTO public.brackets (
  id,
  division_id,
  seed_count
)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '44444444-4444-4444-4444-444444444444',
  2
);

INSERT INTO public.matches (
  id,
  tournament_id,
  bracket_id,
  bracket_section,
  bracket_activation,
  bracket_round,
  bracket_position,
  slug
)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '33333333-3333-3333-3333-333333333333',
  '55555555-5555-5555-5555-555555555555',
  'main',
  'required',
  1,
  1,
  'bootstrap-match'
);

INSERT INTO public.sets (
  id,
  match_id,
  set_number
)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  '66666666-6666-6666-6666-666666666666',
  1
);

INSERT INTO public.tournament_chat_channels (
  id,
  tournament_id,
  kind
)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  '33333333-3333-3333-3333-333333333333',
  'general'
);

INSERT INTO public.tournament_chat_messages (
  id,
  channel_id,
  tournament_id,
  author_user_id,
  body
)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '88888888-8888-8888-8888-888888888888',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'Bootstrap chat message'
);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.matches
    WHERE id = '66666666-6666-6666-6666-666666666666'
  ) <> 0 THEN
    RAISE EXCEPTION 'Unrelated user saw an unreleased match';
  END IF;

  IF (
    SELECT count(*)
    FROM public.tournament_chat_messages
    WHERE id = '99999999-9999-9999-9999-999999999999'
  ) <> 0 THEN
    RAISE EXCEPTION 'Unrelated user saw a protected chat message';
  END IF;
END;
$rls$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.matches
    WHERE id = '66666666-6666-6666-6666-666666666666'
  ) <> 1 THEN
    RAISE EXCEPTION 'Organizer could not see an unreleased match';
  END IF;

  IF (
    SELECT count(*)
    FROM public.tournament_chat_messages
    WHERE id = '99999999-9999-9999-9999-999999999999'
  ) <> 1 THEN
    RAISE EXCEPTION 'Organizer could not see a protected chat message';
  END IF;
END;
$rls$;
ROLLBACK;

INSERT INTO public.teams (
  id,
  name,
  slug,
  university,
  gender,
  region
)
VALUES (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'Bootstrap Team',
  'bootstrap-team',
  'Bootstrap University',
  'mens',
  'north'
);

INSERT INTO public.team_members (
  id,
  team_id,
  user_id,
  role
)
VALUES (
  'aaaaaaaa-2222-2222-2222-222222222222',
  'aaaaaaaa-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'player'
);

INSERT INTO public.registrations (
  id,
  team_id,
  tournament_id,
  division_id,
  status
)
VALUES (
  'aaaaaaaa-3333-3333-3333-333333333333',
  'aaaaaaaa-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  'confirmed'
);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.tournament_chat_messages
    WHERE id = '99999999-9999-9999-9999-999999999999'
  ) <> 1 THEN
    RAISE EXCEPTION 'Confirmed participant could not see tournament chat';
  END IF;
END;
$rls$;
ROLLBACK;

UPDATE public.users
SET disabled_at = now()
WHERE id = '22222222-2222-2222-2222-222222222222';

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.tournament_chat_messages
    WHERE id = '99999999-9999-9999-9999-999999999999'
  ) <> 0 THEN
    RAISE EXCEPTION 'Disabled participant saw tournament chat';
  END IF;
END;
$rls$;
ROLLBACK;

UPDATE public.users
SET disabled_at = NULL
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE public.divisions
SET pools_released_at = now()
WHERE id = '44444444-4444-4444-4444-444444444444';

UPDATE public.tournaments
SET status = 'registration_open'
WHERE id = '33333333-3333-3333-3333-333333333333';

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.matches
    WHERE id = '66666666-6666-6666-6666-666666666666'
  ) <> 1 THEN
    RAISE EXCEPTION 'Authenticated user could not see a released match';
  END IF;

  IF (
    SELECT count(*)
    FROM public.sets
    WHERE id = '77777777-7777-7777-7777-777777777777'
  ) <> 1 THEN
    RAISE EXCEPTION 'Authenticated user could not see a released set';
  END IF;
END;
$rls$;
ROLLBACK;

UPDATE public.users
SET disabled_at = now()
WHERE id = '22222222-2222-2222-2222-222222222222';

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  true
);
DO $rls$
BEGIN
  IF (
    SELECT count(*)
    FROM public.matches
    WHERE id = '66666666-6666-6666-6666-666666666666'
  ) <> 0 THEN
    RAISE EXCEPTION 'Disabled user saw a released match';
  END IF;

  IF (
    SELECT count(*)
    FROM public.sets
    WHERE id = '77777777-7777-7777-7777-777777777777'
  ) <> 0 THEN
    RAISE EXCEPTION 'Disabled user saw a released set';
  END IF;
END;
$rls$;
ROLLBACK;
