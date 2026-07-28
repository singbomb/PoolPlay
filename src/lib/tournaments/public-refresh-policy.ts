/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { isTournamentArchived } from "@/lib/tournament-status";

export interface PublicTournamentRefreshPolicy {
  intervalMs: number | null;
  label: string;
}

export interface PublicTournamentLifecycle {
  resolved: boolean;
  archived: boolean;
  canRegister: boolean;
  refreshPolicy: PublicTournamentRefreshPolicy;
}

/** Spreads refreshes across a ±10% window to avoid synchronized request bursts. */
export function publicRefreshDelay(
  intervalMs: number,
  randomUnit: number = Math.random()
): number {
  const boundedRandom = Math.min(1, Math.max(0, randomUnit));
  return Math.round(intervalMs * (0.9 + boundedRandom * 0.2));
}

export function publicTournamentRefreshPolicy({
  hasLiveMatch,
  status,
  archived,
}: {
  hasLiveMatch: boolean;
  status: string;
  archived: boolean;
}): PublicTournamentRefreshPolicy {
  if (hasLiveMatch) {
    return {
      intervalMs: 15_000,
      label: "Live updates every 15 seconds",
    };
  }
  if (archived || status === "completed") {
    return {
      intervalMs: 300_000,
      label: "Final results · checks for corrections every 5 minutes",
    };
  }
  return {
    intervalMs: 60_000,
    label: "Checks for updates every minute",
  };
}

export function publicTournamentLifecycle({
  date,
  status,
  hasLiveMatch,
  today,
}: {
  date: string;
  status: string;
  hasLiveMatch: boolean;
  today: string;
}): PublicTournamentLifecycle {
  if (today.length === 0) {
    return {
      resolved: false,
      archived: false,
      canRegister: false,
      refreshPolicy: { intervalMs: null, label: "" },
    };
  }
  const archived =
    !hasLiveMatch && isTournamentArchived(date, today);
  return {
    resolved: true,
    archived,
    canRegister: !archived && status === "registration_open",
    refreshPolicy: publicTournamentRefreshPolicy({
      hasLiveMatch,
      status,
      archived,
    }),
  };
}
