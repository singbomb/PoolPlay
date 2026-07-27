import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createTournamentSchema } from "@/lib/validators";
import {
  PLAY_FORMAT_OPTIONS,
  PLAY_FORMATS,
  formatPlayFormatLabel,
} from "./play-format";

const tournamentActions = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "(dashboard)",
    "tournaments",
    "actions.ts"
  ),
  "utf8"
);
const bracketStructure = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "lib",
    "tournaments",
    "bracket-structure.ts"
  ),
  "utf8"
);

const validTournament = {
  hostSchoolId: "00000000-0000-4000-8000-000000000001",
  name: "Safe Tournament",
  date: "2026-08-01",
  location: "Campus Gym",
};

describe("play-format choices", () => {
  it("offers every supported competition format", () => {
    assert.deepEqual(
      PLAY_FORMAT_OPTIONS.map((option) => option.value),
      ["pool_to_bracket", "single_elimination", "double_elimination"]
    );
  });

  it("accepts double elimination for new tournaments", () => {
    assert.equal(
      createTournamentSchema.safeParse({
        ...validTournament,
        playFormat: "double_elimination",
      }).success,
      true
    );
  });

  it("keeps the enum value and display label readable", () => {
    assert.ok(PLAY_FORMATS.includes("double_elimination"));
    assert.equal(
      formatPlayFormatLabel("double_elimination"),
      "Double elimination"
    );
  });

  it("validates tournament creation against the supported formats", () => {
    assert.match(
      tournamentActions,
      /!isCreatablePlayFormat\(requestedPlayFormat\)/
    );
    assert.doesNotMatch(
      bracketStructure,
      /DOUBLE_ELIMINATION_UNAVAILABLE_MESSAGE/
    );
  });
});
