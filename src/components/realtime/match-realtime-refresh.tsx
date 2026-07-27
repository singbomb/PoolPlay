"use client";

/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 300;
const PERIODIC_REFRESH_MS = 15_000;

type MatchRealtimeRefreshProps =
  | { matchId: string; tournamentId?: never }
  | { matchId?: never; tournamentId: string };

export function MatchRealtimeRefresh(props: MatchRealtimeRefreshProps) {
  const router = useRouter();
  const scope = props.matchId ? "match" : "tournament";
  const scopeId = props.matchId ?? props.tournamentId;
  const filter =
    scope === "match"
      ? `id=eq.${scopeId}`
      : `tournament_id=eq.${scopeId}`;

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let periodicTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };
    const startPeriodicRefresh = () => {
      if (periodicTimer) return;
      periodicTimer = setInterval(() => {
        if (document.visibilityState === "visible") scheduleRefresh();
      }, PERIODIC_REFRESH_MS);
    };
    const stopPeriodicRefresh = () => {
      if (!periodicTimer) return;
      clearInterval(periodicTimer);
      periodicTimer = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    const channel = supabase
      .channel(`match-refresh-${scope}-${scopeId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter,
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter,
        },
        scheduleRefresh
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          stopPeriodicRefresh();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT"
        ) {
          startPeriodicRefresh();
        }
      });

    // Protect the page while the channel connects, then stop once healthy.
    startPeriodicRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      stopPeriodicRefresh();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [filter, router, scope, scopeId]);

  return null;
}
