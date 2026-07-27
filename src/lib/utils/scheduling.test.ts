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
  autoScheduleMatchesWithCourtSets,
  buildBracketScheduleDependencies,
  deriveSingleEliminationDependencies,
  isAutoScheduleCandidate,
  SchedulePlanningError,
  type ScheduleDependency,
  type ScheduleItem,
  type ScheduleMatchState,
} from "./scheduling";

const START = new Date("2026-08-01T08:00:00.000Z");
const COURTS = ["court-1", "court-2", "court-3", "court-4"];

function items(matchIds: string[], courtIds = COURTS): ScheduleItem[] {
  return matchIds.map((matchId) => ({ matchId, courtIds }));
}

function states(matchIds: string[]): ScheduleMatchState[] {
  return matchIds.map((matchId) => ({
    matchId,
    status: "upcoming",
    activation: "required",
    scheduledTime: null,
  }));
}

function timeByMatch(
  schedule: ReturnType<typeof autoScheduleMatchesWithCourtSets>
): Map<string, number> {
  return new Map(
    schedule.map((slot) => [slot.matchId, slot.scheduledTime.getTime()])
  );
}

describe("dependency-aware auto scheduling", () => {
  it("keeps every double-elimination target after its feeders on multiple courts", () => {
    const matchIds = [
      "W1-M1",
      "W1-M2",
      "W1-M3",
      "W1-M4",
      "W2-M1",
      "W2-M2",
      "W3-M1",
      "L1-M1",
      "L1-M2",
      "L2-M1",
      "L2-M2",
      "L3-M1",
    ];
    const dependencies: ScheduleDependency[] = [
      { sourceMatchId: "W1-M1", targetMatchId: "W2-M1" },
      { sourceMatchId: "W1-M2", targetMatchId: "W2-M1" },
      { sourceMatchId: "W1-M3", targetMatchId: "W2-M2" },
      { sourceMatchId: "W1-M4", targetMatchId: "W2-M2" },
      { sourceMatchId: "W1-M1", targetMatchId: "L1-M1" },
      { sourceMatchId: "W1-M2", targetMatchId: "L1-M1" },
      { sourceMatchId: "W1-M3", targetMatchId: "L1-M2" },
      { sourceMatchId: "W1-M4", targetMatchId: "L1-M2" },
      { sourceMatchId: "W2-M1", targetMatchId: "W3-M1" },
      { sourceMatchId: "W2-M2", targetMatchId: "W3-M1" },
      { sourceMatchId: "L1-M1", targetMatchId: "L2-M1" },
      { sourceMatchId: "W2-M1", targetMatchId: "L2-M1" },
      { sourceMatchId: "L1-M2", targetMatchId: "L2-M2" },
      { sourceMatchId: "W2-M2", targetMatchId: "L2-M2" },
      { sourceMatchId: "L2-M1", targetMatchId: "L3-M1" },
      { sourceMatchId: "L2-M2", targetMatchId: "L3-M1" },
    ];

    const schedule = autoScheduleMatchesWithCourtSets(
      items(matchIds),
      START,
      30,
      10,
      { dependencies, matchStates: states(matchIds) }
    );
    const times = timeByMatch(schedule);
    const firstRoundTime = times.get("W1-M1")!;
    const nextBlockTime = firstRoundTime + 40 * 60 * 1000;

    for (const matchId of ["W1-M1", "W1-M2", "W1-M3", "W1-M4"]) {
      assert.equal(times.get(matchId), firstRoundTime);
    }
    for (const matchId of ["W2-M1", "W2-M2", "L1-M1", "L1-M2"]) {
      assert.equal(
        times.get(matchId),
        nextBlockTime,
        `${matchId} should share the second block`
      );
    }
    assert.ok(times.get("W3-M1")! > times.get("W2-M1")!);
    assert.ok(times.get("L3-M1")! > times.get("L2-M1")!);

    for (const dependency of dependencies) {
      assert.ok(
        times.get(dependency.sourceMatchId)! <
          times.get(dependency.targetMatchId)!,
        `${dependency.sourceMatchId} must precede ${dependency.targetMatchId}`
      );
    }

    const courtsByTime = new Map<number, Set<string>>();
    for (const slot of schedule) {
      const time = slot.scheduledTime.getTime();
      const used = courtsByTime.get(time) ?? new Set<string>();
      assert.equal(
        used.has(slot.courtId),
        false,
        `${slot.courtId} was assigned twice in one block`
      );
      used.add(slot.courtId);
      courtsByTime.set(time, used);
    }
  });

  it("never puts a target in the same block as a feeder with fewer courts", () => {
    const matchIds = ["W1-M1", "W1-M2", "W2-M1", "L1-M1", "L2-M1", "GF1"];
    const dependencies: ScheduleDependency[] = [
      { sourceMatchId: "W1-M1", targetMatchId: "W2-M1" },
      { sourceMatchId: "W1-M2", targetMatchId: "W2-M1" },
      { sourceMatchId: "W1-M1", targetMatchId: "L1-M1" },
      { sourceMatchId: "W1-M2", targetMatchId: "L1-M1" },
      { sourceMatchId: "W2-M1", targetMatchId: "L2-M1" },
      { sourceMatchId: "L1-M1", targetMatchId: "L2-M1" },
      { sourceMatchId: "W2-M1", targetMatchId: "GF1" },
      { sourceMatchId: "L2-M1", targetMatchId: "GF1" },
    ];

    for (const courtIds of [COURTS.slice(0, 2), COURTS.slice(0, 3)]) {
      const schedule = autoScheduleMatchesWithCourtSets(
        items(matchIds, courtIds),
        START,
        30,
        10,
        { dependencies, matchStates: states(matchIds) }
      );
      const times = timeByMatch(schedule);
      for (const dependency of dependencies) {
        assert.ok(
          times.get(dependency.sourceMatchId)! <
            times.get(dependency.targetMatchId)!
        );
      }
    }
  });

  it("honors completed and already-scheduled feeders", () => {
    const scheduledFeederTime = new Date("2026-08-01T09:00:00.000Z");
    const schedule = autoScheduleMatchesWithCourtSets(
      items(["target"], ["court-2"]),
      START,
      30,
      10,
      {
        dependencies: [
          { sourceMatchId: "completed", targetMatchId: "target" },
          { sourceMatchId: "scheduled", targetMatchId: "target" },
        ],
        matchStates: [
          {
            matchId: "completed",
            status: "completed",
            activation: "required",
          },
          {
            matchId: "scheduled",
            status: "upcoming",
            activation: "required",
            scheduledTime: scheduledFeederTime,
            courtId: "court-1",
          },
          {
            matchId: "target",
            status: "upcoming",
            activation: "required",
          },
        ],
      }
    );

    assert.equal(
      schedule[0].scheduledTime.toISOString(),
      "2026-08-01T10:10:00.000Z"
    );
  });

  it("collapses a skipped conditional feeder to its live prerequisites", () => {
    const schedule = autoScheduleMatchesWithCourtSets(
      items(["source", "target"], ["court-1", "court-2"]),
      START,
      30,
      0,
      {
        dependencies: [
          { sourceMatchId: "source", targetMatchId: "conditional" },
          { sourceMatchId: "conditional", targetMatchId: "target" },
        ],
        matchStates: [
          ...states(["source", "target"]),
          {
            matchId: "conditional",
            status: "upcoming",
            activation: "conditional",
            scheduledTime: null,
          },
        ],
      }
    );
    const times = timeByMatch(schedule);

    assert.ok(times.get("source")! < times.get("target")!);
  });

  it("deduplicates winner and loser edges between the same two matches", () => {
    const schedule = autoScheduleMatchesWithCourtSets(
      items(["GF1", "GF2"], ["court-1", "court-2"]),
      START,
      30,
      0,
      {
        dependencies: [
          { sourceMatchId: "GF1", targetMatchId: "GF2" },
          { sourceMatchId: "GF1", targetMatchId: "GF2" },
        ],
        matchStates: states(["GF1", "GF2"]),
      }
    );
    const times = timeByMatch(schedule);

    assert.ok(times.get("GF1")! < times.get("GF2")!);
  });

  it("keeps unique courts across mixed division-specific court sets", () => {
    const schedule = autoScheduleMatchesWithCourtSets(
      [
        { matchId: "division-a", courtIds: ["shared", "court-a"] },
        { matchId: "division-b", courtIds: ["shared", "court-b"] },
        { matchId: "shared-only", courtIds: ["shared"] },
      ],
      START,
      30,
      0
    );

    assert.equal(
      new Set(schedule.map((slot) => slot.scheduledTime.getTime())).size,
      1
    );
    assert.equal(
      new Set(schedule.map((slot) => slot.courtId)).size,
      schedule.length
    );
  });

  it("uses augmenting paths when first-fit courts would miss a deadline", () => {
    const targetTime = new Date("2026-08-01T08:30:00.000Z");
    const schedule = autoScheduleMatchesWithCourtSets(
      [
        { matchId: "A", courtIds: ["court-1", "court-2"] },
        { matchId: "B", courtIds: ["court-2", "court-3"] },
        { matchId: "C", courtIds: ["court-1", "court-2"] },
      ],
      START,
      30,
      0,
      {
        dependencies: [
          { sourceMatchId: "A", targetMatchId: "target-A" },
          { sourceMatchId: "B", targetMatchId: "target-B" },
          { sourceMatchId: "C", targetMatchId: "target-C" },
        ],
        matchStates: [
          ...states(["A", "B", "C"]),
          ...["target-A", "target-B", "target-C"].map((matchId) => ({
            matchId,
            status: "upcoming" as const,
            activation: "required" as const,
            scheduledTime: targetTime,
            courtId: null,
          })),
        ],
      }
    );

    assert.equal(schedule.length, 3);
    assert.equal(
      new Set(schedule.map((slot) => slot.courtId)).size,
      schedule.length
    );
    for (const slot of schedule) {
      assert.equal(slot.scheduledTime.toISOString(), START.toISOString());
    }
  });

  it("rejects cycles and unresolved non-automatic feeders", () => {
    assert.throws(
      () =>
        autoScheduleMatchesWithCourtSets(
          [{ matchId: "no-court", courtIds: [] }],
          START,
          30,
          0
        ),
      /has no available court/
    );

    assert.throws(
      () =>
        autoScheduleMatchesWithCourtSets(
          items(["a", "b"]),
          START,
          30,
          0,
          {
            dependencies: [
              { sourceMatchId: "a", targetMatchId: "b" },
              { sourceMatchId: "b", targetMatchId: "a" },
            ],
            matchStates: states(["a", "b"]),
          }
        ),
      SchedulePlanningError
    );

    assert.throws(
      () =>
        autoScheduleMatchesWithCourtSets(
          items(["target"]),
          START,
          30,
          0,
          {
            dependencies: [
              { sourceMatchId: "unresolved", targetMatchId: "target" },
            ],
            matchStates: [
              ...states(["target"]),
              {
                matchId: "unresolved",
                status: "in_progress",
                activation: "required",
                scheduledTime: null,
              },
            ],
          }
        ),
      /neither completed nor scheduled/
    );
  });
});

describe("single-elimination coordinate dependencies", () => {
  it("derives winner feeds within each bracket section", () => {
    assert.deepEqual(
      deriveSingleEliminationDependencies([
        {
          matchId: "r1m1",
          bracketId: "bracket",
          bracketSection: "main",
          bracketRound: 1,
          bracketPosition: 1,
        },
        {
          matchId: "r1m2",
          bracketId: "bracket",
          bracketSection: "main",
          bracketRound: 1,
          bracketPosition: 2,
        },
        {
          matchId: "final",
          bracketId: "bracket",
          bracketSection: "main",
          bracketRound: 2,
          bracketPosition: 1,
        },
      ]),
      [
        { sourceMatchId: "r1m1", targetMatchId: "final" },
        { sourceMatchId: "r1m2", targetMatchId: "final" },
      ]
    );
  });
});

describe("tournament action constraint construction", () => {
  it("combines persisted DE edges with derived SE edges and excludes conditional GF2", () => {
    const dependencies = buildBracketScheduleDependencies(
      [
        {
          matchId: "GF1",
          bracketId: "double",
          bracketType: "double_elimination",
          bracketSection: "grand_final",
          bracketRound: 1,
          bracketPosition: 1,
        },
        {
          matchId: "GF2",
          bracketId: "double",
          bracketType: "double_elimination",
          bracketSection: "grand_final",
          bracketRound: 2,
          bracketPosition: 1,
        },
        {
          matchId: "SE-R1-M1",
          bracketId: "single",
          bracketType: "single_elimination",
          bracketSection: "main",
          bracketRound: 1,
          bracketPosition: 1,
        },
        {
          matchId: "SE-F",
          bracketId: "single",
          bracketType: "single_elimination",
          bracketSection: "main",
          bracketRound: 2,
          bracketPosition: 1,
        },
      ],
      [
        {
          bracketId: "double",
          sourceMatchId: "GF1",
          targetMatchId: "GF2",
        },
        {
          bracketId: "double",
          sourceMatchId: "GF1",
          targetMatchId: "GF2",
        },
      ]
    );

    assert.deepEqual(dependencies, [
      { sourceMatchId: "GF1", targetMatchId: "GF2" },
      { sourceMatchId: "GF1", targetMatchId: "GF2" },
      { sourceMatchId: "SE-R1-M1", targetMatchId: "SE-F" },
    ]);
    assert.equal(
      isAutoScheduleCandidate({
        status: "upcoming",
        scheduledTime: null,
        bracketId: "double",
        bracketActivation: "conditional",
      }),
      false
    );
    assert.equal(
      isAutoScheduleCandidate({
        status: "upcoming",
        scheduledTime: null,
        bracketId: "double",
        bracketActivation: "required",
      }),
      true
    );
  });
});
