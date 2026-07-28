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
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/tournaments/public-view.ts"),
  "utf8"
);

describe("public tournament read safety", () => {
  it("loads the multi-query projection from one read-only repeatable snapshot", () => {
    assert.match(source, /db\.transaction\(\s*async \(tx\) =>/);
    assert.match(source, /isolationLevel:\s*"repeatable read"/);
    assert.match(source, /accessMode:\s*"read only"/);
  });

  it("shares the expensive projection briefly across public viewers", () => {
    assert.match(source, /unstable_cache\(/);
    assert.match(source, /revalidate:\s*5/);
    assert.match(source, /publicTournamentCacheTag\(slug\)/);
  });
});
