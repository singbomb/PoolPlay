/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brackets,
  divisions,
  matches,
  pools,
} from "@/lib/db/schema";
import { OperationValidationError } from "@/lib/tournaments/competition-operation-rules";
import { isStraightEliminationFormat } from "@/lib/tournaments/straight-elimination-seeding";
import { straightEliminationDivisionHasCurrentSeededBracket } from "@/lib/tournaments/tournament-completion";

type DbClient = typeof db;

/**
 * Release a division only after its selected competition format has matches.
 * Straight elimination checks bracket matches; pool formats check pool matches.
 */
export async function releaseDivisionPlay(
  input: { tournamentId: string; divisionId: string },
  client: DbClient = db
): Promise<{ alreadyReleased: boolean; matchCount: number }> {
  if (client === db) {
    return db.transaction((tx) =>
      releaseDivisionPlay(input, tx as unknown as DbClient)
    );
  }

  const [division] = await client
    .select({
      id: divisions.id,
      tournamentId: divisions.tournamentId,
      format: divisions.format,
      poolsReleasedAt: divisions.poolsReleasedAt,
    })
    .from(divisions)
    .where(eq(divisions.id, input.divisionId))
    .for("update")
    .limit(1);
  if (!division || division.tournamentId !== input.tournamentId) {
    throw new OperationValidationError("Division not found.");
  }
  if (
    isStraightEliminationFormat(division.format) &&
    !(await straightEliminationDivisionHasCurrentSeededBracket(
      input.tournamentId,
      division.id,
      client
    ))
  ) {
    throw new OperationValidationError(
      "Reseed the elimination bracket so it exactly matches the current roster before releasing it."
    );
  }
  if (division.poolsReleasedAt) {
    return { alreadyReleased: true, matchCount: 0 };
  }

  const releasedMatchRows = isStraightEliminationFormat(division.format)
    ? await client
        .select({ id: matches.id })
        .from(matches)
        .innerJoin(brackets, eq(matches.bracketId, brackets.id))
        .where(
          and(
            eq(brackets.divisionId, division.id),
            gte(brackets.seedCount, 2)
          )
        )
    : await client
        .select({ id: matches.id })
        .from(matches)
        .innerJoin(pools, eq(matches.poolId, pools.id))
        .where(eq(pools.divisionId, division.id));
  const matchCount = releasedMatchRows.length;
  if (matchCount === 0) {
    throw new OperationValidationError(
      isStraightEliminationFormat(division.format)
        ? "Generate the elimination bracket before releasing it."
        : "Save seeding and generate pool matches before releasing."
    );
  }

  const releasedAt = new Date();
  await client
    .update(divisions)
    .set({ poolsReleasedAt: releasedAt })
    .where(eq(divisions.id, division.id));
  await client
    .update(matches)
    .set({ updatedAt: releasedAt })
    .where(inArray(matches.id, releasedMatchRows.map((match) => match.id)));
  return { alreadyReleased: false, matchCount };
}
