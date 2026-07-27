/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brackets,
  divisions,
  matches,
  poolTeams,
} from "@/lib/db/schema";
import {
  ensureDivisionBracketSkeleton,
  fillBracketRoundOne,
} from "@/lib/tournaments/bracket-structure";
import { ensureDivisionAutoPool } from "@/lib/tournaments/division-pools";
import { OperationValidationError } from "@/lib/tournaments/competition-operation-rules";

type DbClient = typeof db;

export type StraightEliminationFormat =
  | "single_elimination"
  | "double_elimination";

export function isStraightEliminationFormat(
  format: string
): format is StraightEliminationFormat {
  return format === "single_elimination" || format === "double_elimination";
}

/**
 * Persist an exact seed order and materialize its straight-elimination graph.
 * The caller supplies the transaction used for its authorization checks.
 */
export async function seedStraightEliminationDivision(
  input: {
    tournamentId: string;
    divisionId: string;
    orderedTeamIds: string[];
  },
  client: DbClient = db
): Promise<{ matchCount: number }> {
  if (client === db) {
    return db.transaction((tx) =>
      seedStraightEliminationDivision(
        input,
        tx as unknown as DbClient
      )
    );
  }

  const orderedTeamIds = [...new Set(input.orderedTeamIds)];
  if (orderedTeamIds.length < 2) {
    throw new OperationValidationError(
      "Need at least 2 teams to generate an elimination bracket."
    );
  }

  const [division] = await client
    .select({
      id: divisions.id,
      tournamentId: divisions.tournamentId,
      format: divisions.format,
    })
    .from(divisions)
    .where(eq(divisions.id, input.divisionId))
    .for("share")
    .limit(1);
  if (!division || division.tournamentId !== input.tournamentId) {
    throw new OperationValidationError("Division not found.");
  }
  if (!isStraightEliminationFormat(division.format)) {
    throw new OperationValidationError(
      "This division does not use straight elimination."
    );
  }

  const poolId = await ensureDivisionAutoPool(division.id, client);
  if (!poolId) {
    throw new OperationValidationError(
      "This legacy division has multiple pools and cannot be seeded here."
    );
  }

  const members = await client
    .select({ teamId: poolTeams.teamId })
    .from(poolTeams)
    .where(eq(poolTeams.poolId, poolId))
    .orderBy(asc(poolTeams.seed), asc(poolTeams.teamId))
    .for("update");
  const memberIds = new Set(members.map((member) => member.teamId));
  if (
    orderedTeamIds.length !== members.length ||
    orderedTeamIds.some((teamId) => !memberIds.has(teamId))
  ) {
    throw new OperationValidationError(
      "Seeding must include every confirmed team in this division."
    );
  }

  await ensureDivisionBracketSkeleton(division.id, division.format, client);
  const [bracket] = await client
    .select({ id: brackets.id })
    .from(brackets)
    .where(eq(brackets.divisionId, division.id))
    .for("update")
    .limit(1);
  if (!bracket) {
    throw new OperationValidationError(
      "The elimination bracket could not be created."
    );
  }

  for (let index = 0; index < orderedTeamIds.length; index += 1) {
    await client
      .update(poolTeams)
      .set({ seed: index + 1 })
      .where(
        and(
          eq(poolTeams.poolId, poolId),
          eq(poolTeams.teamId, orderedTeamIds[index])
        )
      );
  }

  const filled = await fillBracketRoundOne(
    bracket.id,
    orderedTeamIds,
    client
  );
  if (filled.error) {
    throw new OperationValidationError(filled.error);
  }

  const [{ value }] = await client
    .select({ value: count() })
    .from(matches)
    .where(eq(matches.bracketId, bracket.id));
  return { matchCount: value ?? 0 };
}
