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
import { packetScheduleMatchIsVisible } from "./packet-data";

describe("packetScheduleMatchIsVisible", () => {
  it("hides unreleased pool and bracket matches from participants", () => {
    assert.equal(
      packetScheduleMatchIsVisible(
        { poolReleasedAt: null, bracketReleasedAt: null },
        false
      ),
      false
    );
  });

  it("shows either released play path to participants", () => {
    const releasedAt = new Date("2027-07-27T12:00:00Z");
    assert.equal(
      packetScheduleMatchIsVisible(
        { poolReleasedAt: releasedAt, bracketReleasedAt: null },
        false
      ),
      true
    );
    assert.equal(
      packetScheduleMatchIsVisible(
        { poolReleasedAt: null, bracketReleasedAt: releasedAt },
        false
      ),
      true
    );
  });

  it("allows organizers to include unreleased matches", () => {
    assert.equal(
      packetScheduleMatchIsVisible(
        { poolReleasedAt: null, bracketReleasedAt: null },
        true
      ),
      true
    );
  });
});
