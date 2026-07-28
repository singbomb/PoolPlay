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
} from "@/lib/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
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
} from "@/lib/tournaments/bracket-structure";
import { seedStraightEliminationDivision } from "@/lib/tournaments/straight-elimination-seeding";
import { loadLockedTournamentForOrganizer } from "@/lib/tournaments/locked-tournament-authorization";
import {
  eligibleBracketRefIds,
  type BracketMatchForRefs,
} from "@/lib/tournaments/bracket-refs";
import { validateBracketTierSettings } from "@/lib/tournaments/bracket-tiers";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";
import { invalidatePublicTournamentCachesByIds } from "@/lib/tournaments/public-cache-invalidation";

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
      if (division.format !== "pool_to_bracket") {
        return {
          error:
            "Pool-match generation is only available for pool-to-bracket divisions.",
        };
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
      return { matchCount: regenerated.matchCount ?? 0 };
    });
    if ("error" in result) return { error: result.error };
    matchCount = result.matchCount;
  } catch (error) {
    return {
      error: bracketOperationError(error, "Could not update pool seeding"),
    };
  }

  await invalidatePublicTournamentCachesByIds([tournamentId]);
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return {
    success: true as const,
    matchCount,
  };
}

/**
 * Save seed order and generate a straight-elimination bracket without creating
 * any round-robin pool matches.
 */
export async function updateEliminationSeeding(
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
            "Elimination seeding can only be updated by the current organizer.",
        };
      }
      if (
        tournament.status !== "registration_closed" ||
        isTournamentArchived(tournament.date)
      ) {
        return {
          error:
            "Elimination seeding can only be updated after registration closes.",
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
        })
        .from(pools)
        .innerJoin(divisions, eq(pools.divisionId, divisions.id))
        .where(eq(pools.id, poolId))
        .for("share")
        .limit(1);
      if (!division || division.tournamentId !== tournamentId) {
        return { error: "Division not found" };
      }

      return seedStraightEliminationDivision(
        {
          tournamentId,
          divisionId: division.id,
          orderedTeamIds: uniqueIds,
        },
        executor
      );
    });
    if ("error" in result) return { error: result.error };
    matchCount = result.matchCount;
  } catch (error) {
    return {
      error: bracketOperationError(
        error,
        "Could not generate the elimination bracket"
      ),
    };
  }

  await invalidatePublicTournamentCachesByIds([tournamentId]);
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
          error: "Only the current organizer can change the working team",
        };
      }

      await executor.execute(sql`
        SELECT id
        FROM ${matches}
        WHERE ${matches.id} = ${matchId}
          AND ${matches.tournamentId} = ${tournamentId}
        FOR UPDATE
      `);
      const [match] = await executor
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
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournamentId)
          )
        )
        .limit(1);

      if (!match || (!match.poolId && !match.bracketId)) {
        return { error: "Resource not found or access denied" };
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
        const [member] = await executor
          .select({ teamId: poolTeams.teamId })
          .from(poolTeams)
          .where(
            and(
              eq(poolTeams.poolId, match.poolId),
              eq(poolTeams.teamId, refTeamId)
            )
          )
          .for("share")
          .limit(1);
        if (!member) {
          return { error: "Working team must be in the same pool" };
        }
      }

      if (refTeamId !== null && match.bracketId) {
        const bracketRows = await executor
          .select({
            id: matches.id,
            bracketSection: matches.bracketSection,
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
          .where(eq(matches.bracketId, match.bracketId))
          .for("share");

        const allForRefs: BracketMatchForRefs[] = bracketRows
          .filter((row) => row.bracketRound != null && row.bracketPosition != null)
          .map((row) => ({
            id: row.id,
            bracketSection: row.bracketSection,
            bracketRound: row.bracketRound!,
            bracketPosition: row.bracketPosition!,
            teamAId: row.teamAId,
            teamBId: row.teamBId,
            winnerId: row.winnerId,
            status: row.status,
            courtId: row.courtId,
            scheduledTime: row.scheduledTime,
          }));
        const target = allForRefs.find((row) => row.id === match.id);
        if (!target) {
          return { error: "Match not found" };
        }
        if (!eligibleBracketRefIds(target, allForRefs).includes(refTeamId)) {
          return {
            error: "Selected working team is not eligible for this match",
          };
        }
      }

      const [updatedMatch] = await executor
        .update(matches)
        .set({ refTeamId, updatedAt: new Date() })
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournamentId)
          )
        )
        .returning({ id: matches.id });
      return updatedMatch
        ? { success: true as const }
        : { error: "Resource not found or access denied" };
    });

    if ("error" in result) return result;
    revalidatePath("/tournaments/[slug]", "page");
    revalidatePath("/tournaments/[slug]/scoring", "page");
    return result;
  } catch (error) {
    console.error("Could not change the working team", error);
    return { error: "Could not change the working team" };
  }
}

/** Assign a court to a bracket match and refresh round-1 ref suggestions. */
export async function updateBracketMatchCourt(
  tournamentId: string,
  matchId: string,
  courtId: string | null
) {
  const user = await requireUser();

  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as BracketActionDbClient;
      const tournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!tournament || isTournamentArchived(tournament.date)) {
        return { error: "Only the organizer can assign courts" };
      }

      const [match] = await executor
        .select({
          id: matches.id,
          bracketId: matches.bracketId,
          status: matches.status,
        })
        .from(matches)
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournament.id)
          )
        )
        .for("update")
        .limit(1);
      if (!match?.bracketId) {
        return { error: "Resource not found or access denied" };
      }
      if (match.status === "completed") {
        return { error: "Match is already completed" };
      }

      if (courtId) {
        const [court] = await executor
          .select({ id: courts.id })
          .from(courts)
          .where(
            and(
              eq(courts.id, courtId),
              eq(courts.tournamentId, tournament.id)
            )
          )
          .for("share")
          .limit(1);
        if (!court) {
          return { error: "Court not found" };
        }
      }

      const [updatedMatch] = await executor
        .update(matches)
        .set({ courtId, updatedAt: new Date() })
        .where(
          and(
            eq(matches.id, matchId),
            eq(matches.tournamentId, tournament.id)
          )
        )
        .returning({ id: matches.id });
      if (!updatedMatch) {
        return { error: "Resource not found or access denied" };
      }

      await assignBracketRefsForBracket(match.bracketId, executor, {
        resetRoundOneCourtId: courtId,
      });
      return { success: true as const };
    });
    if ("error" in result) return result;
  } catch (error) {
    console.error("Could not assign the bracket court", error);
    return { error: "Could not assign the bracket court" };
  }

  await invalidatePublicTournamentCachesByIds([tournamentId]);
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

  await invalidatePublicTournamentCachesByIds([tournamentId]);
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

  await invalidatePublicTournamentCachesByIds([tournamentId]);
  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}
