-- PoolPlay - Collegiate club volleyball tournament hub
-- Copyright (C) 2026 Andrew Chang
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.

CREATE TYPE public.user_player_gender AS ENUM ('male', 'female');

CREATE TYPE public.volleyball_position AS ENUM (
  'outside_hitter',
  'middle_blocker',
  'opposite_hitter',
  'setter',
  'libero_ds'
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_storage_path text,
  ADD COLUMN IF NOT EXISTS player_gender public.user_player_gender,
  ADD COLUMN IF NOT EXISTS volleyball_position public.volleyball_position,
  ADD COLUMN IF NOT EXISTS display_email text,
  ADD COLUMN IF NOT EXISTS display_school text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;
