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
  buildPublicTournamentListProjection,
  buildPublicTournamentProjection,
  type PublicTournamentProjectionSource,
} from "./public-projection";

function releasedSource(): PublicTournamentProjectionSource {
  return {
    tournament: {
      id: "tournament-private-id",
      hostSchoolId: "school-private-id",
      slug: "lake-effect-classic",
      name: "Lake Effect Classic",
      description: "A two-day club volleyball tournament.",
      date: "2027-02-13",
      location: "Cleveland Fieldhouse",
      address: "100 Public Ave",
      status: "in_progress",
      gender: "mens",
      region: "central",
      matchFormat: "two_with_tiebreak",
      setTargetScore: 25,
      tiebreakTargetScore: 15,
      poolTiebreakCriteria: [
        "match_record",
        "set_record",
        "point_diff",
        "head_to_head",
      ],
    },
    hostSchool: {
      name: "Case Western Reserve University",
      slug: "case-western-reserve",
      verificationStatus: "verified",
    },
    divisions: [
      {
        id: "division-released",
        name: "Open",
        format: "pool_to_bracket",
        poolsReleasedAt: new Date("2027-02-12T12:00:00Z"),
      },
      {
        id: "division-private",
        name: "Hidden",
        format: "pool_to_bracket",
        poolsReleasedAt: null,
      },
    ],
    pools: [
      {
        id: "pool-public",
        divisionId: "division-released",
        name: "Pool A",
      },
      {
        id: "pool-private",
        divisionId: "division-private",
        name: "Secret Pool",
      },
    ],
    poolTeams: [
      { poolId: "pool-public", teamId: "team-a", seed: 1 },
      { poolId: "pool-public", teamId: "team-b", seed: 2 },
      { poolId: "pool-private", teamId: "team-secret", seed: 1 },
    ],
    brackets: [
      {
        id: "bracket-public",
        divisionId: "division-released",
        bracketType: "single_elimination",
        seedCount: 2,
        name: "Gold",
        tier: 0,
      },
      {
        id: "bracket-private",
        divisionId: "division-private",
        bracketType: "single_elimination",
        seedCount: 2,
        name: "Secret",
        tier: 0,
      },
    ],
    matches: [
      {
        id: "pool-match",
        slug: "open-pool-a-1",
        poolId: "pool-public",
        bracketId: null,
        courtId: "court-1",
        teamAId: "team-a",
        teamBId: "team-b",
        winnerId: "team-a",
        status: "completed",
        scheduledTime: new Date("2027-02-13T16:00:00Z"),
        bracketSection: null,
        bracketActivation: null,
        bracketRound: null,
        bracketPosition: null,
      },
      {
        id: "bracket-live",
        slug: "gold-final",
        poolId: null,
        bracketId: "bracket-public",
        courtId: "court-1",
        teamAId: "team-a",
        teamBId: "team-b",
        winnerId: null,
        status: "in_progress",
        scheduledTime: new Date("2027-02-13T18:00:00Z"),
        bracketSection: "main",
        bracketActivation: "required",
        bracketRound: 1,
        bracketPosition: 1,
      },
      {
        id: "conditional-reset",
        slug: "gold-reset",
        poolId: null,
        bracketId: "bracket-public",
        courtId: "court-1",
        teamAId: null,
        teamBId: null,
        winnerId: null,
        status: "upcoming",
        scheduledTime: new Date("2027-02-13T19:00:00Z"),
        bracketSection: "grand_final",
        bracketActivation: "conditional",
        bracketRound: 2,
        bracketPosition: 1,
      },
      {
        id: "private-match",
        slug: "secret-match",
        poolId: "pool-private",
        bracketId: null,
        courtId: "court-1",
        teamAId: "team-secret",
        teamBId: null,
        winnerId: null,
        status: "upcoming",
        scheduledTime: new Date("2027-02-13T20:00:00Z"),
        bracketSection: null,
        bracketActivation: null,
        bracketRound: null,
        bracketPosition: null,
      },
    ],
    teams: [
      { id: "team-a", name: "Spartans A", university: "CWRU" },
      { id: "team-b", name: "Spartans B", university: "CWRU" },
      { id: "team-secret", name: "Secret Team", university: "Private U" },
    ],
    courts: [{ id: "court-1", name: "Court 1" }],
    sets: [
      {
        matchId: "pool-match",
        setNumber: 1,
        teamAScore: 25,
        teamBScore: 20,
      },
      {
        matchId: "pool-match",
        setNumber: 2,
        teamAScore: 25,
        teamBScore: 22,
      },
      {
        matchId: "bracket-live",
        setNumber: 1,
        teamAScore: 18,
        teamBScore: 16,
      },
      {
        matchId: "private-match",
        setNumber: 1,
        teamAScore: 5,
        teamBScore: 3,
      },
    ],
  };
}

describe("buildPublicTournamentProjection", () => {
  it("returns no data for a draft tournament", () => {
    const source = releasedSource();
    source.tournament.status = "draft";

    assert.equal(buildPublicTournamentProjection(source), null);
  });

  it("omits every unreleased division and its competition data", () => {
    const projection = buildPublicTournamentProjection(releasedSource());

    assert.ok(projection);
    assert.deepEqual(
      projection.divisions.map((division) => division.name),
      ["Open"]
    );
    assert.doesNotMatch(JSON.stringify(projection), /Hidden|Secret|Private U/);
  });

  it("computes public standings and live scores without exposing internal ids", () => {
    const source = releasedSource();
    Object.assign(source.hostSchool!, {
      id: "school-private-id",
      contactEmail: "private@example.com",
    });
    const projection = buildPublicTournamentProjection(source);

    assert.ok(projection);
    assert.deepEqual(projection.divisions[0].pools[0].standings, [
      {
        rank: 1,
        teamName: "Spartans A",
        university: "CWRU",
        wins: 1,
        losses: 0,
        setsWon: 2,
        setsLost: 0,
        pointDiff: 8,
      },
      {
        rank: 2,
        teamName: "Spartans B",
        university: "CWRU",
        wins: 0,
        losses: 1,
        setsWon: 0,
        setsLost: 2,
        pointDiff: -8,
      },
    ]);
    assert.deepEqual(projection.schedule[0], {
      key: "gold-final",
      kind: "bracket",
      context: "Open · Final",
      teamAName: "Spartans A",
      teamBName: "Spartans B",
      winner: null,
      status: "in_progress",
      scheduledTime: "2027-02-13T18:00:00.000Z",
      courtName: "Court 1",
      sets: [{ teamAScore: 18, teamBScore: 16 }],
    });
    assert.doesNotMatch(
      JSON.stringify(projection),
      /private-id|private@example|team-a|team-b|division-released|pool-public|bracket-public/
    );
  });

  it("keeps conditional bracket context out of the public schedule", () => {
    const projection = buildPublicTournamentProjection(releasedSource());

    assert.ok(projection);
    assert.deepEqual(
      projection.schedule.map((match) => match.key),
      ["gold-final", "open-pool-a-1"]
    );
    assert.equal(
      projection.divisions[0].brackets[0].rounds.some((round) =>
        round.matches.some((match) => match.key === "gold-reset")
      ),
      true
    );
  });
});

describe("buildPublicTournamentListProjection", () => {
  it("removes operational identifiers from public tournament cards", () => {
    const projection = buildPublicTournamentListProjection([
      {
        id: "tournament-private-id",
        organizerId: "organizer-private-id",
        hostSchoolId: "school-private-id",
        slug: "lake-effect-classic",
        name: "Lake Effect Classic",
        description: "Public tournament",
        location: "Cleveland",
        date: "2027-02-13",
        status: "registration_open",
        gender: "mens",
        region: "central",
        hostSchool: {
          id: "school-private-id",
          contactEmail: "private@example.com",
          name: "Case Western Reserve University",
          slug: "case-western-reserve",
          verificationStatus: "verified",
        },
      },
    ]);

    assert.deepEqual(projection, [
      {
        slug: "lake-effect-classic",
        name: "Lake Effect Classic",
        description: "Public tournament",
        location: "Cleveland",
        date: "2027-02-13",
        status: "registration_open",
        gender: "mens",
        region: "central",
        hostSchool: {
          name: "Case Western Reserve University",
          slug: "case-western-reserve",
          verificationStatus: "verified",
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(projection), /private-id/);
  });
});
