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
  PUBLIC_TOURNAMENTS_CACHE_TAG,
  publicTournamentCacheTag,
} from "./public-cache";

describe("public tournament cache tags", () => {
  it("keeps list invalidation separate from per-tournament details", () => {
    assert.equal(PUBLIC_TOURNAMENTS_CACHE_TAG, "public-tournaments");
    assert.equal(
      publicTournamentCacheTag("lake-effect-classic"),
      "public-tournament:lake-effect-classic"
    );
    assert.notEqual(
      publicTournamentCacheTag("lake-effect-classic"),
      publicTournamentCacheTag("summer-classic")
    );
  });
});
