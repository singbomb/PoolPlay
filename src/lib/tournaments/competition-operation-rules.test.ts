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
  OperationConflictError,
  OperationValidationError,
  assertExpectedRevision,
  assertParticipantWinner,
  canTransitionRegistrationStatus,
} from "./competition-operation-rules";

describe("score revision rules", () => {
  it("accepts the current revision and rejects a stale writer", () => {
    assert.doesNotThrow(() => assertExpectedRevision(4, 4));
    assert.throws(
      () => assertExpectedRevision(4, 3),
      (error) =>
        error instanceof OperationConflictError &&
        error.currentRevision === 4
    );
  });

  it("requires a winner to be a participant", () => {
    assert.doesNotThrow(() =>
      assertParticipantWinner("team-a", "team-a", "team-b", false)
    );
    assert.throws(
      () =>
        assertParticipantWinner("unrelated-team", "team-a", "team-b", false),
      OperationValidationError
    );
  });

  it("allows a tie only for formats that explicitly permit one", () => {
    assert.doesNotThrow(() =>
      assertParticipantWinner(null, "team-a", "team-b", true)
    );
    assert.throws(
      () => assertParticipantWinner(null, "team-a", "team-b", false),
      OperationValidationError
    );
  });
});

describe("registration status rules", () => {
  it("requires confirmation before check-in", () => {
    assert.equal(
      canTransitionRegistrationStatus("pending", "checked_in"),
      false
    );
    assert.equal(
      canTransitionRegistrationStatus("confirmed", "checked_in"),
      true
    );
  });

  it("allows an organizer to undo one stage at a time", () => {
    assert.equal(
      canTransitionRegistrationStatus("checked_in", "confirmed"),
      true
    );
    assert.equal(
      canTransitionRegistrationStatus("checked_in", "pending"),
      false
    );
    assert.equal(
      canTransitionRegistrationStatus("confirmed", "pending"),
      true
    );
  });
});
