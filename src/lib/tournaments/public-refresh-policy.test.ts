/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publicRefreshDelay,
  publicTournamentLifecycle,
  publicTournamentRefreshPolicy,
} from "./public-refresh-policy";

describe("publicTournamentRefreshPolicy", () => {
  it("refreshes every 15 seconds while a match is live", () => {
    assert.deepEqual(
      publicTournamentRefreshPolicy({
        hasLiveMatch: true,
        status: "in_progress",
        archived: false,
      }),
      { intervalMs: 15_000, label: "Live updates every 15 seconds" }
    );
  });

  it("uses explicit live state without a server-calendar dependency", () => {
    assert.deepEqual(
      publicTournamentRefreshPolicy({
        hasLiveMatch: true,
        status: "in_progress",
        archived: false,
      }),
      { intervalMs: 15_000, label: "Live updates every 15 seconds" }
    );
  });

  it("checks once per minute while waiting for active play", () => {
    assert.deepEqual(
      publicTournamentRefreshPolicy({
        hasLiveMatch: false,
        status: "registration_closed",
        archived: false,
      }),
      { intervalMs: 60_000, label: "Checks for updates every minute" }
    );
  });

  it("checks final results slowly so corrections can reopen play", () => {
    assert.deepEqual(
      publicTournamentRefreshPolicy({
        hasLiveMatch: false,
        status: "completed",
        archived: false,
      }),
      {
        intervalMs: 300_000,
        label: "Final results · checks for corrections every 5 minutes",
      }
    );
  });
});

describe("publicTournamentLifecycle", () => {
  it("keeps date-sensitive public controls unresolved during server rendering", () => {
    assert.deepEqual(
      publicTournamentLifecycle({
        date: "2026-07-26",
        status: "registration_open",
        hasLiveMatch: false,
        today: "",
      }),
      {
        resolved: false,
        archived: false,
        canRegister: false,
        refreshPolicy: {
          intervalMs: null,
          label: "",
        },
      }
    );
  });

  it("uses an explicit local date to keep badge, CTA, and polling consistent", () => {
    assert.deepEqual(
      publicTournamentLifecycle({
        date: "2026-07-26",
        status: "registration_open",
        hasLiveMatch: false,
        today: "2026-07-27",
      }),
      {
        resolved: true,
        archived: true,
        canRegister: false,
        refreshPolicy: {
          intervalMs: 300_000,
          label: "Final results · checks for corrections every 5 minutes",
        },
      }
    );
  });

  it("lets active play override a calendar boundary", () => {
    assert.deepEqual(
      publicTournamentLifecycle({
        date: "2026-07-26",
        status: "in_progress",
        hasLiveMatch: true,
        today: "2026-07-27",
      }),
      {
        resolved: true,
        archived: false,
        canRegister: false,
        refreshPolicy: {
          intervalMs: 15_000,
          label: "Live updates every 15 seconds",
        },
      }
    );
  });
});

describe("publicRefreshDelay", () => {
  it("staggers viewers within ten percent of the policy interval", () => {
    assert.equal(publicRefreshDelay(15_000, 0), 13_500);
    assert.equal(publicRefreshDelay(15_000, 0.5), 15_000);
    assert.equal(publicRefreshDelay(15_000, 1), 16_500);
  });
});
