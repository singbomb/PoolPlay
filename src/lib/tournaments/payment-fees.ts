/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export const MAX_PAYMENT_FEE_INPUT_LENGTH = 32;
export const MAX_PAYMENT_FEE_CENTS = 10_000_000;

export type TournamentPaymentFeeCents = {
  firstTeamFeeCents: number | null;
  additionalTeamFeeCents: number | null;
};

/** Parse a human-entered dollar amount into bounded integer cents. */
export function parsePaymentFeeCents(value: string): number | null {
  if (value.length > MAX_PAYMENT_FEE_INPUT_LENGTH) return null;

  const cleaned = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;

  const [wholePart, fractionalPart = ""] = cleaned.split(".");
  const wholeDollars = Number(wholePart);
  if (!Number.isSafeInteger(wholeDollars)) return null;

  const fractionalCents = Number(fractionalPart.padEnd(2, "0"));
  const cents = wholeDollars * 100 + fractionalCents;
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    cents > MAX_PAYMENT_FEE_CENTS
  ) {
    return null;
  }
  return cents;
}

export function resolveTournamentPaymentFeeCents(
  enabled: boolean,
  firstTeamFeeDollars: string,
  additionalTeamFeeDollars: string
): TournamentPaymentFeeCents | null {
  if (!enabled) {
    return {
      firstTeamFeeCents: null,
      additionalTeamFeeCents: null,
    };
  }

  const firstTeamFeeCents = parsePaymentFeeCents(firstTeamFeeDollars);
  if (firstTeamFeeCents == null || firstTeamFeeCents <= 0) return null;

  const additionalTeamFeeCents = additionalTeamFeeDollars
    ? parsePaymentFeeCents(additionalTeamFeeDollars)
    : firstTeamFeeCents;
  if (additionalTeamFeeCents == null) return null;

  return { firstTeamFeeCents, additionalTeamFeeCents };
}
