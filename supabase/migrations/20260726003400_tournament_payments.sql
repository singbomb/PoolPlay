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

CREATE TYPE registration_payment_status AS ENUM (
  'unpaid',
  'submitted',
  'confirmed',
  'waived'
);

CREATE TYPE registration_payment_method AS ENUM (
  'venmo',
  'zelle',
  'cashapp',
  'check',
  'cash',
  'other'
);

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_required_before_confirm boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_first_team_fee_cents integer,
  ADD COLUMN IF NOT EXISTS payment_additional_team_fee_cents integer,
  ADD COLUMN IF NOT EXISTS payment_venmo_handle text,
  ADD COLUMN IF NOT EXISTS payment_zelle_handle text,
  ADD COLUMN IF NOT EXISTS payment_cashapp_handle text,
  ADD COLUMN IF NOT EXISTS payment_other_instructions text;

CREATE TABLE IF NOT EXISTS registration_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  status registration_payment_status NOT NULL DEFAULT 'unpaid',
  submitted_method registration_payment_method,
  submitted_note text,
  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  confirmed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  waived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  waived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_payments_tournament_id_idx
  ON registration_payments (tournament_id);

CREATE INDEX IF NOT EXISTS registration_payments_team_id_idx
  ON registration_payments (team_id);
