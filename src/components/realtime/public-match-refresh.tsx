"use client";

/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import {
  publicRefreshDelay,
  type PublicTournamentRefreshPolicy,
} from "@/lib/tournaments/public-refresh-policy";

/**
 * Anonymous visitors poll the server projection instead of subscribing to
 * operational Supabase tables. This preserves the public read boundary.
 */
export function PublicMatchRefresh({
  policy,
}: {
  policy: PublicTournamentRefreshPolicy;
}) {
  const router = useRouter();
  const live = policy.intervalMs === 15_000;

  useEffect(() => {
    if (policy.intervalMs == null) return;
    const intervalMs = policy.intervalMs;
    let timer: number | undefined;

    const scheduleRefresh = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        scheduleRefresh();
      }, publicRefreshDelay(intervalMs));
    };
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (timer != null) window.clearTimeout(timer);
      router.refresh();
      scheduleRefresh();
    };

    scheduleRefresh();
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [policy.intervalMs, router]);

  return (
    <span
      role="status"
      className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span className="relative flex size-2">
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-70 motion-reduce:animate-none" />
        ) : null}
        <span
          className={
            live
              ? "relative inline-flex size-2 rounded-full bg-live"
              : "relative inline-flex size-2 rounded-full bg-muted-foreground/45"
          }
        />
      </span>
      <Radio className="size-3.5" aria-hidden />
      <span>{policy.label}</span>
    </span>
  );
}
