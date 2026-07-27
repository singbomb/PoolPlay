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
import { eq, and, count } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import type { UserForPermissions } from "@/lib/tournaments/permissions";
import {
  canAssignTeamsToPools,
  resolveIsTournamentOrganizer,
  poolAssignmentBlockedMessage,
} from "@/lib/tournaments/permissions";
import { regeneratePoolMatchesFromSeeds } from "@/lib/tournaments/pool-matches";
import {
  ensureDivisionBracketSkeleton,
  assignBracketRefsForBracket,
  countTournamentCombinedBracketTeams,
  regenerateTournamentCombinedBrackets,
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

async function assertCanAssignTeamsToPools(
  tournamentId: string,
  user: UserForPermissions
) {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    return { error: "Tournament not found" as const };
  }

  const [{ value: pendingCount }] = await db
    .select({ value: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        eq(registrations.status, "pending")
      )
    );

  const pending = pendingCount ?? 0;

  const blocked = poolAssignmentBlockedMessage(pending);
  if (blocked) {
    return { error: blocked };
  }

  if (!await canAssignTeamsToPools(tournament, user, pending)) {
    return {
      error:
        "Pool seeding can only be updated after registration closes. Only the organizer can change seeds.",
    };
  }

  return { tournament };
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

  const [pool] = await db
    .select({ divisionId: pools.divisionId })
    .from(pools)
    .where(eq(pools.id, poolId))
    .limit(1);

  if (!pool) return { error: "Pool not found" };

  const [division] = await db
    .select()
    .from(divisions)
    .where(eq(divisions.id, pool.divisionId))
    .limit(1);

  if (!division || division.tournamentId !== tournamentId) {
    return { error: "Tournament mismatch" };
  }

  const gate = await assertCanAssignTeamsToPools(tournamentId, user);
  if ("error" in gate) {
    return { error: gate.error };
  }

  const uniqueIds = [...new Set(orderedTeamIds)];
  if (uniqueIds.length < 2) {
    return { error: "Need at least 2 teams to set seeding" };
  }

  const members = await db
    .select({ teamId: poolTeams.teamId })
    .from(poolTeams)
    .where(eq(poolTeams.poolId, poolId));

  const memberIds = new Set(members.map((m) => m.teamId));
  if (
    uniqueIds.length !== members.length ||
    uniqueIds.some((id) => !memberIds.has(id))
  ) {
    return { error: "Seeding must include every team in this pool" };
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < uniqueIds.length; i++) {
      await tx
        .update(poolTeams)
        .set({ seed: i + 1 })
        .where(
          and(
            eq(poolTeams.poolId, poolId),
            eq(poolTeams.teamId, uniqueIds[i])
          )
        );
    }
  });

  const matchResult = await regeneratePoolMatchesFromSeeds(poolId);
  if (matchResult.error) {
    return { error: matchResult.error };
  }

  if (division.format === "single_elimination") {
    await tryFillBracketFromDivisionSeeds(division.id);
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return {
    success: true as const,
    matchCount: matchResult.matchCount ?? 0,
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

  const totalTeams = await countTournamentCombinedBracketTeams(tournamentId);
  if (totalTeams >= 2) {
    const tierValidation = validateBracketTierSettings(
      totalTeams,
      bracketCount,
      goldTeamCount,
      silverTeamCount
    );
    if (!tierValidation.ok) {
      return { error: tierValidation.error };
    }
  }

  const poolDivisions = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(
      and(
        eq(divisions.tournamentId, tournamentId),
        eq(divisions.format, "pool_to_bracket")
      )
    );

  const placed = await db
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

  const hasTeams = placed.some((m) => m.teamAId != null || m.teamBId != null);

  if (hasTeams) {
    const regenerateState = await tournamentCombinedBracketsRegenerateState(
      tournamentId
    );
    if (!regenerateState.canRegenerate) {
      return {
        error:
          regenerateState.reason ??
          "Bracket settings are locked while bracket play is in progress",
      };
    }
  }

  await db
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
    const result = await regenerateTournamentCombinedBrackets(tournamentId);
    if (result.error) return { error: result.error };
  } else if (poolDivisions.length > 0) {
    for (const div of poolDivisions) {
      const existing = await db
        .select({ id: brackets.id })
        .from(brackets)
        .where(eq(brackets.divisionId, div.id));
      for (const b of existing) {
        await db.delete(matches).where(eq(matches.bracketId, b.id));
        await db.delete(brackets).where(eq(brackets.id, b.id));
      }
    }
    await ensureDivisionBracketSkeleton(
      poolDivisions[0].id,
      "pool_to_bracket"
    );
  }

  revalidatePath("/tournaments/[slug]", "page");
  return {
    success: true as const,
    bracketCount,
    goldTeamCount,
    silverTeamCount,
    rebuilt: hasTeams || poolDivisions.length > 0,
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

  const result = await regenerateTournamentCombinedBrackets(tournamentId);
  if (result.error) return { error: result.error };

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const };
}
