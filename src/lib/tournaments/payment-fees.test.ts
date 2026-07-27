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
  MAX_PAYMENT_FEE_CENTS,
  MAX_PAYMENT_FEE_INPUT_LENGTH,
  parsePaymentFeeCents,
  resolveTournamentPaymentFeeCents,
} from "./payment-fees";

describe("parsePaymentFeeCents", () => {
  it("parses ordinary formatted dollar amounts into integer cents", () => {
    assert.equal(parsePaymentFeeCents("$1,234.56"), 123_456);
    assert.equal(parsePaymentFeeCents("75"), 7_500);
    assert.equal(parsePaymentFeeCents("0.5"), 50);
  });

  it("rejects ambiguous and non-decimal numeric syntax", () => {
    assert.equal(parsePaymentFeeCents("1.234"), null);
    assert.equal(parsePaymentFeeCents("1e5"), null);
    assert.equal(parsePaymentFeeCents("-1"), null);
    assert.equal(parsePaymentFeeCents(""), null);
  });

  it("rejects values beyond the business and input-size limits", () => {
    assert.equal(
      parsePaymentFeeCents(String(MAX_PAYMENT_FEE_CENTS / 100 + 0.01)),
      null
    );
    assert.equal(
      parsePaymentFeeCents("1".repeat(MAX_PAYMENT_FEE_INPUT_LENGTH + 1)),
      null
    );
  });
});

describe("resolveTournamentPaymentFeeCents", () => {
  it("keeps first-team and additional-team values in cents", () => {
    assert.deepEqual(resolveTournamentPaymentFeeCents(true, "100", "25"), {
      firstTeamFeeCents: 10_000,
      additionalTeamFeeCents: 2_500,
    });
  });

  it("defaults the additional-team fee to the first-team fee", () => {
    assert.deepEqual(resolveTournamentPaymentFeeCents(true, "75", ""), {
      firstTeamFeeCents: 7_500,
      additionalTeamFeeCents: 7_500,
    });
  });

  it("clears both fees when payment tracking is disabled", () => {
    assert.deepEqual(resolveTournamentPaymentFeeCents(false, "", ""), {
      firstTeamFeeCents: null,
      additionalTeamFeeCents: null,
    });
  });
});
