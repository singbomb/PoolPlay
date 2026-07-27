"use server";

/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  brackets,
  courts,
  divisions,
  matches,
  tournaments,
  registrations,
  pools,
  poolTeams,
  schoolMembers,
  users,
} from "@/lib/db/schema";
import { eq, and, count, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import {
  resolveIsTournamentOrganizer,
  poolAssignmentBlockedMessage,
} from "@/lib/tournaments/permissions";
import { regeneratePoolMatchesFromSeedsInTransaction } from "@/lib/tournaments/pool-matches";
import {
  ensureDivisionBracketSkeleton,
  assignBracketRefsForBracket,
  countTournamentCombinedBracketTeams,
  regenerateTournamentCombinedBracketsInTransaction,
  tournamentCombinedBracketsRegenerateState,
  tryFillBracketFromDivisionSeeds,
} from "@/lib/tournaments/bracket-structure";
import {
  eligibleBracketRefIds,
  type BracketMatchForRefs,
} from "@/lib/tournaments/bracket-refs";
import { validateBracketTierSettings } from "@/lib/tournaments/bracket-tiers";
import { assertMatchBelongsToAuthorizedTournament } from "@/lib/security/authorization-invariants";
import { getMatchTournamentId } from "@/lib/tournaments/match-query";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";

type BracketActionDbClient = typeof db;

function bracketOperationError(error: unknown, fallback: string): string {
  if (
    error instanceof OperationConflictError ||
    error instanceof OperationValidationError
  ) {
    return error.message;
  }
  console.error(fallback, error);
  return fallback;
}

async function loadLockedTournamentForOrganizer(
  tournamentId: string,
  actorUserId: string,
  executor: BracketActionDbClient
): Promise<typeof tournaments.$inferSelect | null> {
  await executor.execute(sql`
    SELECT id
    FROM ${tournaments}
    WHERE ${tournaments.id} = ${tournamentId}
    FOR UPDATE
  `);
  const [tournament] = await executor
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  const [actor] = await executor
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, actorUserId))
    .for("share")
    .limit(1);
  if (!tournament || !actor || actor.disabledAt != null) return null;
  if (tournament.organizerId === actorUserId || actor.role === "admin") {
    return tournament;
  }
  if (!tournament.hostSchoolId) return null;
  const [officer] = await executor
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, tournament.hostSchoolId),
        eq(schoolMembers.userId, actorUserId),
        or(
          eq(schoolMembers.role, "president"),
          eq(schoolMembers.role, "officer")
        )
      )
    )
    .for("share")
    .limit(1);
  return officer ? tournament : null;
}

/**
 * Save seed order for a pool and generate round-robin matches from that order.
 */
export async function updatePoolSeeding(
  tournamentId: string,
  poolId: string,
  orderedTeamIds: string[]
) {
  const user = await requireUser();
  const uniqueIds = [...new Set(orderedTeamIds)];
  if (uniqueIds.length < 2) {
    return { error: "Need at least 2 teams to set seeding" };
  }

  let matchCount = 0;
  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as BracketActionDbClient;
      const tournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!tournament) {
        return {
          error:
            "Pool seeding can only be updated by the current organizer.",
        };
      }
      if (
        tournament.status !== "registration_closed" ||
        isTournamentArchived(tournament.date)
      ) {
        return {
          error:
            "Pool seeding can only be updated after registration closes.",
        };
      }

      const [{ value: pendingCount }] = await executor
        .select({ value: count() })
        .from(registrations)
        .where(
          and(
            eq(registrations.tournamentId, tournamentId),
            eq(registrations.status, "pending")
          )
        );
      const blocked = poolAssignmentBlockedMessage(pendingCount ?? 0);
      if (blocked) return { error: blocked };

      const [division] = await executor
        .select({
          id: divisions.id,
          tournamentId: divisions.tournamentId,
          format: divisions.format,
        })
        .from(pools)
        .innerJoin(divisions, eq(pools.divisionId, divisions.id))
        .where(eq(pools.id, poolId))
        .for("share")
        .limit(1);
      if (!division) return { error: "Pool not found" };
      if (division.tournamentId !== tournamentId) {
        return { error: "Tournament mismatch" };
      }

      const members = await executor
        .select({ teamId: poolTeams.teamId })
        .from(poolTeams)
        .where(eq(poolTeams.poolId, poolId))
        .for("share");
      const memberIds = new Set(members.map((member) => member.teamId));
      if (
        uniqueIds.length !== members.length ||
        uniqueIds.some((id) => !memberIds.has(id))
      ) {
        return { error: "Seeding must include every team in this pool" };
      }

      for (let index = 0; index < uniqueIds.length; index += 1) {
        await executor
          .update(poolTeams)
          .set({ seed: index + 1 })
          .where(
            and(
              eq(poolTeams.poolId, poolId),
              eq(poolTeams.teamId, uniqueIds[index])
            )
          );
      }

      const regenerated = await regeneratePoolMatchesFromSeedsInTransaction(
        poolId,
        executor
      );
      if (regenerated.error) {
        throw new OperationValidationError(regenerated.error);
      }
      if (division.format === "single_elimination") {
        await tryFillBracketFromDivisionSeeds(division.id, executor);
      }
      return { matchCount: regenerated.matchCount ?? 0 };
    });
    if ("error" in result) return { error: result.error };
    matchCount = result.matchCount;
  } catch (error) {
    return {
      error: bracketOperationError(error, "Could not update pool seeding"),
    };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return {
    success: true as const,
    matchCount,
  };
}

/** Override the auto-assigned working/ref team for a pool or bracket match. */
export async function updateMatchRef(
  tournamentId: string,
  matchId: string,
  refTeamId: string | null
) {
  const user = await requireUser();

  const matchTournamentId = await getMatchTournamentId(matchId);
  if (!matchTournamentId) {
    return { error: "Resource not found or access denied" };
  }

  try {
    assertMatchBelongsToAuthorizedTournament({
      matchTournamentId,
      authorizedTournamentId: tournamentId,
    });
  } catch {
    return { error: "Resource not found or access denied" };
  }

  const [match] = await db
    .select({
      id: matches.id,
      poolId: matches.poolId,
      bracketId: matches.bracketId,
      bracketRound: matches.bracketRound,
      bracketPosition: matches.bracketPosition,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      status: matches.status,
      courtId: matches.courtId,
      scheduledTime: matches.scheduledTime,
      winnerId: matches.winnerId,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!match || (!match.poolId && !match.bracketId)) {
    return { error: "Resource not found or access denied" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, matchTournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can change the working team" };
  }

  if (match.status === "completed") {
    return { error: "Match is already completed" };
  }

  if (
    refTeamId !== null &&
    (refTeamId === match.teamAId || refTeamId === match.teamBId)
  ) {
    return { error: "Working team can't be one of the playing teams" };
  }

  if (refTeamId !== null && match.poolId) {
    const [member] = await db
      .select({ teamId: poolTeams.teamId })
      .from(poolTeams)
      .where(
        and(eq(poolTeams.poolId, match.poolId), eq(poolTeams.teamId, refTeamId))
      )
      .limit(1);
    if (!member) {
      return { error: "Working team must be in the same pool" };
    }
  }

  if (refTeamId !== null && match.bracketId) {
    const bracketRows = await db
      .select({
        id: matches.id,
        bracketRound: matches.bracketRound,
        bracketPosition: matches.bracketPosition,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        winnerId: matches.winnerId,
        status: matches.status,
        courtId: matches.courtId,
        scheduledTime: matches.scheduledTime,
      })
      .from(matches)
      .where(eq(matches.bracketId, match.bracketId));

    const allForRefs: BracketMatchForRefs[] = bracketRows
      .filter((m) => m.bracketRound != null && m.bracketPosition != null)
      .map((m) => ({
        id: m.id,
        bracketRound: m.bracketRound!,
        bracketPosition: m.bracketPosition!,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        winnerId: m.winnerId,
        status: m.status,
        courtId: m.courtId,
        scheduledTime: m.scheduledTime,
      }));

    const target = allForRefs.find((m) => m.id === match.id);
    if (!target) {
      return { error: "Match not found" };
    }

    const eligible = eligibleBracketRefIds(target, allForRefs);
    if (!eligible.includes(refTeamId)) {
      return {
        error:
          "Ref must be a bye team, a team from a later match on the same court, or a loser from the previous round",
      };
    }
  }

  const [updatedMatch] = await db
    .update(matches)
    .set({ refTeamId, updatedAt: new Date() })
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.tournamentId, matchTournamentId)
      )
    )
    .returning({ id: matches.id });

  if (!updatedMatch) {
    return { error: "Resource not found or access denied" };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/scoring", "page");
  return { success: true as const };
}

/** Assign a court to a bracket match and refresh round-1 ref suggestions. */
export async function updateBracketMatchCourt(
  tournamentId: string,
  matchId: string,
  courtId: string | null
) {
  const user = await requireUser();

  const matchTournamentId = await getMatchTournamentId(matchId);
  if (!matchTournamentId) {
    return { error: "Resource not found or access denied" };
  }

  try {
    assertMatchBelongsToAuthorizedTournament({
      matchTournamentId,
      authorizedTournamentId: tournamentId,
    });
  } catch {
    return { error: "Resource not found or access denied" };
  }

  const [match] = await db
    .select({
      id: matches.id,
      bracketId: matches.bracketId,
      status: matches.status,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!match?.bracketId) {
    return { error: "Resource not found or access denied" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, matchTournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can assign courts" };
  }

  if (match.status === "completed") {
    return { error: "Match is already completed" };
  }

  if (courtId) {
    const [court] = await db
      .select({ id: courts.id })
      .from(courts)
      .where(and(eq(courts.id, courtId), eq(courts.tournamentId, tournamentId)))
      .limit(1);
    if (!court) {
      return { error: "Court not found" };
    }
  }

  const [updatedMatch] = await db
    .update(matches)
    .set({ courtId, updatedAt: new Date() })
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.tournamentId, matchTournamentId)
      )
    )
    .returning({ id: matches.id });

  if (!updatedMatch) {
    return { error: "Resource not found or access denied" };
  }

  await assignBracketRefsForBracket(match.bracketId, db, {
    resetRoundOneCourtId: courtId,
  });

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/schedule");
  return { success: true as const };
}

/**
 * Host settings for tournament-wide gold / silver / bronze brackets.
 * All pools combine into these tiers after pool play.
 */
export async function updateTournamentBracketSettings(
  tournamentId: string,
  input: {
    bracketCount: number;
    goldTeamCount: number | null;
    silverTeamCount: number | null;
  }
) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can change bracket settings" };
  }

  const bracketCount = Math.min(3, Math.max(1, Math.floor(input.bracketCount)));
  let goldTeamCount = input.goldTeamCount;
  let silverTeamCount = input.silverTeamCount;

  if (bracketCount >= 2) {
    if (goldTeamCount == null || goldTeamCount < 2) {
      return { error: "Gold needs at least 2 teams" };
    }
  } else {
    goldTeamCount = null;
    silverTeamCount = null;
  }

  if (bracketCount === 3) {
    if (silverTeamCount == null || silverTeamCount < 2) {
      return { error: "Silver needs at least 2 teams when using three brackets" };
    }
  } else {
    silverTeamCount = null;
  }

  let rebuilt = false;
  try {
    const transactionResult = await db.transaction(async (tx) => {
      const executor = tx as unknown as BracketActionDbClient;
      const lockedTournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!lockedTournament) {
        return { error: "Only the organizer can change bracket settings" };
      }

      const totalTeams = await countTournamentCombinedBracketTeams(
        tournamentId,
        executor
      );
      if (totalTeams >= 2) {
        const tierValidation = validateBracketTierSettings(
          totalTeams,
          bracketCount,
          goldTeamCount,
          silverTeamCount
        );
        if (!tierValidation.ok) return { error: tierValidation.error };
      }

      const poolDivisions = await executor
        .select({ id: divisions.id })
        .from(divisions)
        .where(
          and(
            eq(divisions.tournamentId, tournamentId),
            eq(divisions.format, "pool_to_bracket")
          )
        );
      const placed = await executor
        .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
        .from(matches)
        .innerJoin(brackets, eq(matches.bracketId, brackets.id))
        .innerJoin(divisions, eq(brackets.divisionId, divisions.id))
        .where(
          and(
            eq(divisions.tournamentId, tournamentId),
            eq(divisions.format, "pool_to_bracket")
          )
        );
      const hasTeams = placed.some(
        (match) => match.teamAId != null || match.teamBId != null
      );

      if (hasTeams) {
        const state = await tournamentCombinedBracketsRegenerateState(
          tournamentId,
          executor
        );
        if (!state.canRegenerate) {
          return {
            error:
              state.reason ??
              "Bracket settings are locked while bracket play is in progress",
          };
        }
      }

      await executor
        .update(tournaments)
        .set({
          bracketCount,
          goldTeamCount,
          silverTeamCount,
          bracketSettingsSavedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tournaments.id, tournamentId));

      if (hasTeams) {
        const result =
          await regenerateTournamentCombinedBracketsInTransaction(
            tournamentId,
            executor
          );
        if (result.error) {
          throw new OperationValidationError(result.error);
        }
      } else if (poolDivisions.length > 0) {
        for (const division of poolDivisions) {
          const existing = await executor
            .select({ id: brackets.id })
            .from(brackets)
            .where(eq(brackets.divisionId, division.id));
          for (const bracket of existing) {
            await executor
              .delete(matches)
              .where(eq(matches.bracketId, bracket.id));
            await executor
              .delete(brackets)
              .where(eq(brackets.id, bracket.id));
          }
        }
        await ensureDivisionBracketSkeleton(
          poolDivisions[0].id,
          "pool_to_bracket",
          executor
        );
      }
      return { rebuilt: hasTeams || poolDivisions.length > 0 };
    });
    if ("error" in transactionResult) {
      return { error: transactionResult.error };
    }
    rebuilt = transactionResult.rebuilt;
  } catch (error) {
    return {
      error: bracketOperationError(
        error,
        "Could not update bracket settings"
      ),
    };
  }

  revalidatePath("/tournaments/[slug]", "page");
  return {
    success: true as const,
    bracketCount,
    goldTeamCount,
    silverTeamCount,
    rebuilt,
  };
}

/** Re-seed brackets from current pool standings (organizer only). */
export async function regenerateTournamentBrackets(tournamentId: string) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can regenerate brackets" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as BracketActionDbClient;
      const lockedTournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!lockedTournament) {
        return { error: "Only the organizer can regenerate brackets" };
      }
      return regenerateTournamentCombinedBracketsInTransaction(
        tournamentId,
        executor
      );
    });
    if (result.error) return { error: result.error };
  } catch (error) {
    return {
      error: bracketOperationError(error, "Could not regenerate brackets"),
    };
  }

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}
