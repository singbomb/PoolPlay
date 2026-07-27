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

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  tournaments,
  divisions,
  courts,
  courtDivisions,
  users,
  schoolMembers,
  registrations,
  matches,
  pools,
  brackets,
} from "@/lib/db/schema";
import { eq, and, ne, inArray, or } from "drizzle-orm";
import { requireUser, isAdmin } from "@/lib/auth";
import {
  createTournamentSchema,
  createDivisionSchema,
  updateMatchFormatSchema,
} from "@/lib/validators";
import { flagBlockedContent } from "@/lib/admin/content-flags";
import { getHostingSchoolForUser } from "@/lib/schools/hosting";
import { registerHostSchoolTeamsOnCreate } from "@/lib/tournaments/registrations";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { isTournamentArchived } from "@/lib/tournament-status";
import {
  canCheckInRegistrations,
  canEditRegistrations,
  canEditTournamentSetup,
  resolveIsTournamentOrganizer,
  tournamentPreparationLockedReason,
} from "@/lib/tournaments/permissions";
import {
  getTeamWaiverCompliance,
  waiverBlocksCheckIn,
} from "@/lib/tournaments/waiver-compliance";
import { waiverSettingsFromTournament } from "@/lib/tournaments/waiver-access";
import {
  ensureDivisionAutoPool,
} from "@/lib/tournaments/division-pools";
import { ensureDivisionBracketSkeleton } from "@/lib/tournaments/bracket-structure";
import { releaseDivisionPlay } from "@/lib/tournaments/division-release";
import { loadLockedTournamentForOrganizer } from "@/lib/tournaments/locked-tournament-authorization";
import {
  straightEliminationDivisionsMissingChampions,
  straightEliminationDivisionsMissingSeeds,
  tournamentHasIncompleteActiveBrackets,
} from "@/lib/tournaments/tournament-completion";
import { assertChildBelongsToAuthorizedParent } from "@/lib/security/authorization-invariants";
import { transitionRegistrationStatuses } from "@/lib/tournaments/registration-transitions";
import {
  assignRegistrationsToDivisionAtomically,
  removeDivisionPreservingRegistrationsAtomically,
  removeRegistrationsAtomically,
} from "@/lib/tournaments/registration-roster-mutations";
import {
  OperationConflictError,
  OperationValidationError,
} from "@/lib/tournaments/competition-operation-rules";
import { isCreatablePlayFormat } from "@/lib/labels/play-format";
import type { TournamentStatus } from "@/types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function competitionOperationError(error: unknown): string {
  if (
    error instanceof OperationConflictError ||
    error instanceof OperationValidationError
  ) {
    return error.message;
  }
  console.error("Competition operation failed", error);
  return "Could not update registrations. Try again.";
}

export async function createTournament(formData: FormData) {
  const user = await requireUser();
  const requestedPlayFormat =
    formData.get("playFormat") || "pool_to_bracket";
  if (!isCreatablePlayFormat(requestedPlayFormat)) {
    return {
      error: "Choose a supported tournament format",
    };
  }

  const parsed = createTournamentSchema.safeParse({
    hostSchoolId: formData.get("hostSchoolId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    date: formData.get("date"),
    location: formData.get("location"),
    address: formData.get("address") || undefined,
    playFormat: requestedPlayFormat,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "tournament.name", text: parsed.data.name },
    { area: "tournament.description", text: parsed.data.description },
    { area: "tournament.location", text: parsed.data.location },
    { area: "tournament.address", text: parsed.data.address },
  ]);
  if (contentError) return { error: contentError };

  const hostSchool = await getHostingSchoolForUser(
    parsed.data.hostSchoolId,
    user.id,
    isAdmin(user)
  );
  if (!hostSchool) {
    return {
      error: "Select a school you represent as president or officer",
    };
  }

  const base = slugify(parsed.data.name, "tournament");
  const existingSlugs = await db
    .select({ slug: tournaments.slug })
    .from(tournaments);
  const slug = uniqueSlug(
    base,
    existingSlugs.map((t) => t.slug)
  );

  const tournament = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tournaments)
      .values({
        organizerId: user.id,
        hostSchoolId: hostSchool.id,
        gender: hostSchool.gender,
        region: hostSchool.region,
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
        date: parsed.data.date,
        location: parsed.data.location,
        address: parsed.data.address || null,
        playFormat: parsed.data.playFormat,
        status: "draft",
      })
      .returning();

    if (user.role !== "organizer") {
      await tx
        .update(users)
        .set({ role: "organizer" })
        .where(eq(users.id, user.id));
    }
    await registerHostSchoolTeamsOnCreate(
      created.id,
      hostSchool.id,
      user.id,
      tx as unknown as typeof db
    );
    return created;
  });

  redirect(`/tournaments/${tournament.slug}`);
}

export async function renameTournament(tournamentId: string, name: string) {
  const user = await requireUser();

  const parsed = createTournamentSchema
    .pick({ name: true })
    .safeParse({ name: name.trim() });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }

  const trimmed = parsed.data.name.trim();
  if (!trimmed) {
    return { error: "Tournament name is required" };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "tournament.name", text: trimmed },
  ]);
  if (contentError) return { error: contentError };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can rename this tournament" };
  }

  if (trimmed === tournament.name.trim()) {
    return { success: true as const, slug: tournament.slug };
  }

  const base = slugify(trimmed, "tournament");
  const otherSlugs = await db
    .select({ slug: tournaments.slug })
    .from(tournaments)
    .where(ne(tournaments.id, tournamentId));
  const newSlug = uniqueSlug(
    base,
    otherSlugs.map((r) => r.slug)
  );

  await db
    .update(tournaments)
    .set({
      name: trimmed,
      slug: newSlug,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath("/tournaments");
  revalidatePath("/explore");
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  revalidatePath("/tournaments/[slug]/scoring", "page");
  revalidatePath("/tournaments/[slug]/register", "page");

  return { success: true as const, slug: newSlug };
}

export async function updateTournamentListingDetails(
  tournamentId: string,
  input: {
    description: string;
    location: string;
    address: string;
  }
) {
  const user = await requireUser();

  const parsed = createTournamentSchema
    .pick({ description: true, location: true, address: true })
    .safeParse({
      description: input.description.trim() || undefined,
      location: input.location.trim(),
      address: input.address.trim() || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid listing details" };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "tournament.description", text: parsed.data.description },
    { area: "tournament.location", text: parsed.data.location },
    { area: "tournament.address", text: parsed.data.address },
  ]);
  if (contentError) return { error: contentError };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can edit listing details" };
  }

  const description = parsed.data.description?.trim() || null;
  const location = parsed.data.location.trim();
  const address = parsed.data.address?.trim() || null;

  await db
    .update(tournaments)
    .set({
      description,
      location,
      address,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath("/tournaments");
  revalidatePath("/explore");
  revalidatePath(`/explore/tournaments/${tournament.slug}`);
  revalidatePath("/dashboard");
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/register", "page");

  return {
    success: true as const,
    description,
    location,
    address,
  };
}

const PACKET_NOTES_MAX_LENGTH = 12000;

export async function updateTournamentPacketNotes(
  tournamentId: string,
  packetNotes: string
) {
  const user = await requireUser();

  const trimmed = packetNotes.trim();
  if (trimmed.length > PACKET_NOTES_MAX_LENGTH) {
    return {
      error: `Packet notes must be ${PACKET_NOTES_MAX_LENGTH} characters or fewer.`,
    };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "tournament.packet_notes", text: trimmed || null },
  ]);
  if (contentError) return { error: contentError };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can edit the tournament packet." };
  }

  if (!await canEditTournamentSetup(tournament, user)) {
    return {
      error:
        tournamentPreparationLockedReason(tournament) ??
        "The tournament packet cannot be edited in the current stage.",
    };
  }

  const notes = trimmed || null;

  await db
    .update(tournaments)
    .set({ packetNotes: notes, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath("/tournaments/[slug]", "page");

  return { success: true as const, packetNotes: notes };
}

/**
 * Updates the per-set scoring rules used everywhere matches are scored. Already
 * completed sets are not touched so changing format mid-tournament is safe.
 */
export async function updateTournamentMatchFormat(
  tournamentId: string,
  input: {
    matchFormat: string;
    setStartingScore: number;
    setTargetScore: number;
    tiebreakTargetScore: number;
    warmupFormat: string;
    poolTiebreakCriteria: string[];
  }
) {
  const user = await requireUser();

  const parsed = updateMatchFormatSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid match format" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can change the match format" };
  }

  await db
    .update(tournaments)
    .set({
      matchFormat: parsed.data.matchFormat,
      setStartingScore: parsed.data.setStartingScore,
      setTargetScore: parsed.data.setTargetScore,
      tiebreakTargetScore: parsed.data.tiebreakTargetScore,
      warmupFormat: parsed.data.warmupFormat,
      poolTiebreakCriteria: parsed.data.poolTiebreakCriteria,
      poolSettingsSavedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/scoring", "page");
  revalidatePath("/schedule");
  return { success: true as const };
}

export async function deleteTournament(
  tournamentId: string,
  confirmationName: string
) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can delete this tournament" };
  }

  if (tournament.name.trim() !== confirmationName.trim()) {
    return {
      error:
        "Tournament name does not match — type it exactly as shown (including spaces).",
    };
  }

  try {
    await db.transaction(async (tx) => {
      const [lockedTournament] = await tx
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update")
        .limit(1);
      if (!lockedTournament) {
        throw new OperationConflictError(
          "Tournament no longer exists. Refresh and try again."
        );
      }
      const [currentUser] = await tx
        .select({ role: users.role, disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, user.id))
        .for("share")
        .limit(1);
      let authorized =
        currentUser != null &&
        currentUser.disabledAt == null &&
        (lockedTournament.organizerId === user.id ||
          currentUser.role === "admin");
      if (
        !authorized &&
        currentUser != null &&
        currentUser.disabledAt == null &&
        lockedTournament.hostSchoolId
      ) {
        const [officer] = await tx
          .select({ id: schoolMembers.id })
          .from(schoolMembers)
          .where(
            and(
              eq(schoolMembers.schoolId, lockedTournament.hostSchoolId),
              eq(schoolMembers.userId, user.id),
              or(
                eq(schoolMembers.role, "president"),
                eq(schoolMembers.role, "officer")
              )
            )
          )
          .for("share")
          .limit(1);
        authorized = officer != null;
      }
      if (!authorized) {
        throw new OperationValidationError(
          "Only the current organizer can delete this tournament."
        );
      }
      if (lockedTournament.name.trim() !== confirmationName.trim()) {
        throw new OperationValidationError(
          "Tournament name changed. Type the current name exactly and try again."
        );
      }

      const poolRows = await tx
        .select({ id: pools.id })
        .from(pools)
        .innerJoin(divisions, eq(pools.divisionId, divisions.id))
        .where(eq(divisions.tournamentId, tournamentId));

      const bracketRows = await tx
        .select({ id: brackets.id })
        .from(brackets)
        .innerJoin(divisions, eq(brackets.divisionId, divisions.id))
        .where(eq(divisions.tournamentId, tournamentId));

      const courtRows = await tx
        .select({ id: courts.id })
        .from(courts)
        .where(eq(courts.tournamentId, tournamentId));

      const poolIds = poolRows.map((r) => r.id);
      const bracketIds = bracketRows.map((r) => r.id);
      const courtIds = courtRows.map((r) => r.id);

      const matchPredicates = [];
      if (poolIds.length > 0) {
        matchPredicates.push(inArray(matches.poolId, poolIds));
      }
      if (bracketIds.length > 0) {
        matchPredicates.push(inArray(matches.bracketId, bracketIds));
      }
      if (courtIds.length > 0) {
        matchPredicates.push(inArray(matches.courtId, courtIds));
      }

      if (matchPredicates.length === 1) {
        await tx.delete(matches).where(matchPredicates[0]);
      } else if (matchPredicates.length > 1) {
        await tx.delete(matches).where(or(...matchPredicates));
      }

      await tx.delete(tournaments).where(eq(tournaments.id, tournamentId));
    });
  } catch (error) {
    if (
      error instanceof OperationConflictError ||
      error instanceof OperationValidationError
    ) {
      return { error: error.message };
    }
    return { error: "Could not delete tournament. Try again." };
  }

  revalidatePath("/tournaments");
  revalidatePath("/explore");
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  revalidatePath("/tournaments/[slug]/scoring", "page");
  revalidatePath("/tournaments/[slug]/register", "page");

  return { success: true as const };
}

export async function updateTournamentStatus(
  tournamentId: string,
  status: TournamentStatus
) {
  const user = await requireUser();

  const allowed: TournamentStatus[] = [
    "draft",
    "registration_open",
    "registration_closed",
    "in_progress",
    "completed",
  ];
  if (!allowed.includes(status)) {
    return { error: "Invalid tournament status" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as typeof db;
      const tournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!tournament) {
        return { error: "Only the organizer can update tournament status" };
      }

      // Past-date tournaments are archived; status is read-only until the
      // organizer pushes the date forward via updateTournamentDate.
      if (isTournamentArchived(tournament.date)) {
        return {
          error:
            "This tournament is archived (past its date). Update the date first to change status.",
        };
      }

      if (status === "in_progress") {
        const missingSeeds = await straightEliminationDivisionsMissingSeeds(
          tournamentId,
          executor
        );
        if (missingSeeds.length > 0) {
          return {
            error: `Seed the elimination bracket for ${missingSeeds.join(
              ", "
            )} before starting the tournament.`,
          };
        }
      }
      if (status === "completed") {
        const missingChampions =
          await straightEliminationDivisionsMissingChampions(
            tournamentId,
            executor
          );
        if (missingChampions.length > 0) {
          return {
            error: `Finish the elimination bracket for ${missingChampions.join(
              ", "
            )} before completing the tournament.`,
          };
        }
        if (
          await tournamentHasIncompleteActiveBrackets(
            tournamentId,
            executor
          )
        ) {
          return {
            error:
              "Finish every active elimination bracket before completing the tournament.",
          };
        }
      }

      await executor
        .update(tournaments)
        .set({ status, updatedAt: new Date() })
        .where(eq(tournaments.id, tournamentId));
      return { success: true as const };
    });
    if ("error" in result) return result;
  } catch (error) {
    console.error("Could not update tournament status", error);
    return { error: "Could not update tournament status" };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true };
}

/** Updates the tournament date ("Edit date" in the header dropdown). */
export async function updateTournamentDate(
  tournamentId: string,
  date: string
) {
  const user = await requireUser();

  const trimmed = (date ?? "").trim();
  if (!ISO_DATE_RE.test(trimmed)) {
    return { error: "Pick a valid date" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can change the tournament date" };
  }

  if (tournament.date === trimmed) {
    return { success: true as const, date: trimmed };
  }

  await db
    .update(tournaments)
    .set({ date: trimmed, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath("/tournaments");
  revalidatePath("/explore");
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  revalidatePath("/tournaments/[slug]/scoring", "page");

  return { success: true as const, date: trimmed };
}

export async function addDivision(tournamentId: string, formData: FormData) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return {
      error:
        "Pools cannot be edited in the current tournament stage. Complete setup before the event starts.",
    };
  }
  if (!isCreatablePlayFormat(tournament.playFormat)) {
    return {
      error: "The tournament format is not supported.",
    };
  }

  const parsed = createDivisionSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const divContentError = await flagBlockedContent(user.id, [
    { area: "division.name", text: parsed.data.name },
  ]);
  if (divContentError) return { error: divContentError };

  const normalizedDivisionName = parsed.data.name.trim().toLowerCase();
  const existingDivisions = await db
    .select({ name: divisions.name })
    .from(divisions)
    .where(eq(divisions.tournamentId, tournamentId));

  const duplicateDivision = existingDivisions.some(
    (div) => div.name.trim().toLowerCase() === normalizedDivisionName
  );
  if (duplicateDivision) {
    return { error: "A pool with this name already exists" };
  }

  const playFormat = tournament.playFormat ?? "pool_to_bracket";

  const [inserted] = await db
    .insert(divisions)
    .values({
      tournamentId,
      name: parsed.data.name.trim(),
      format: playFormat,
    })
    .returning({ id: divisions.id });

  if (!inserted) {
    return { error: "Could not create pool" };
  }

  // Eagerly create the matching auto-pool and bracket skeleton.
  await ensureDivisionAutoPool(inserted.id);
  await ensureDivisionBracketSkeleton(inserted.id, playFormat);

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const, id: inserted.id };
}

export async function removeDivision(tournamentId: string, divisionId: string) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return { error: "Pools cannot be removed in the current tournament stage." };
  }

  try {
    await removeDivisionPreservingRegistrationsAtomically({
      tournamentId,
      divisionId,
      actorUserId: user.id,
    });
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true };
}

/** Make a division's generated pool or bracket play visible to all viewers. */
export async function releaseDivisionPools(
  tournamentId: string,
  divisionId: string
) {
  const user = await requireUser();
  try {
    const result = await db.transaction(async (tx) => {
      const executor = tx as unknown as typeof db;
      const tournament = await loadLockedTournamentForOrganizer(
        tournamentId,
        user.id,
        executor
      );
      if (!tournament) {
        return {
          error: "Only the tournament host can release this division",
        };
      }
      return releaseDivisionPlay(
        { tournamentId, divisionId },
        executor
      );
    });
    if ("error" in result) return { error: result.error };

    revalidatePath("/tournaments/[slug]", "page");
    revalidatePath("/tournaments/[slug]/scoring", "page");
    return {
      success: true as const,
      alreadyReleased: result.alreadyReleased,
    };
  } catch (error) {
    if (
      error instanceof OperationConflictError ||
      error instanceof OperationValidationError
    ) {
      return { error: error.message };
    }
    console.error("Could not release division", error);
    return { error: "Could not release this division. Try again." };
  }
}

export async function addCourt(tournamentId: string, formData: FormData) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return { error: "Courts cannot be edited in the current tournament stage." };
  }

  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { error: "Court name is required" };

  const courtContentError = await flagBlockedContent(user.id, [
    { area: "court.name", text: name },
  ]);
  if (courtContentError) return { error: courtContentError };

  const existingCourts = await db
    .select({ name: courts.name })
    .from(courts)
    .where(eq(courts.tournamentId, tournamentId));

  const duplicateCourt = existingCourts.some(
    (court) => court.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicateCourt) {
    return { error: "A court with this name already exists" };
  }

  const [inserted] = await db
    .insert(courts)
    .values({ tournamentId, name })
    .returning({ id: courts.id });

  if (!inserted) {
    return { error: "Could not create court" };
  }

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true as const, id: inserted.id };
}

export async function removeCourt(tournamentId: string, courtId: string) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return { error: "Courts cannot be removed in the current tournament stage." };
  }

  const [removedCourt] = await db
    .delete(courts)
    .where(
      and(eq(courts.id, courtId), eq(courts.tournamentId, tournamentId))
    )
    .returning({
      id: courts.id,
      tournamentId: courts.tournamentId,
    });

  if (!removedCourt) {
    return { error: "Resource not found or access denied" };
  }

  assertChildBelongsToAuthorizedParent({
    childParentId: removedCourt.tournamentId,
    authorizedParentId: tournamentId,
  });

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true };
}

export async function updateRegistrationStatus(
  registrationId: string,
  status: "confirmed" | "pending" | "checked_in",
  operationId: string
) {
  const user = await requireUser();

  if (!UUID_RE.test(operationId)) {
    return { error: "Could not start this update. Try again." };
  }

  const [reg] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);

  if (!reg) return { error: "Registration not found" };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, reg.tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can update registrations" };
  }

  if (status === "checked_in") {
    if (!await canCheckInRegistrations(tournament, user)) {
      return {
        error: "Teams can only be checked in while the tournament is in progress.",
      };
    }

    const waiverSettings = waiverSettingsFromTournament(tournament);
    const compliance = await getTeamWaiverCompliance(tournament, reg.teamId);
    if (waiverBlocksCheckIn(waiverSettings, compliance)) {
      return {
        error: `Waiver incomplete (${compliance.completedCount}/${compliance.totalCount}). Complete waivers or waive players before check-in.`,
      };
    }
  } else if (!await canEditRegistrations(tournament, user)) {
    return {
      error: "Registrations cannot be updated in the current tournament stage.",
    };
  }

  try {
    await transitionRegistrationStatuses({
      tournamentId: reg.tournamentId,
      registrationIds: [registrationId],
      toStatus: status,
      actorUserId: user.id,
      operationId,
      reason: "Organizer changed registration status",
    });
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true };
}

/** Confirm multiple pending registrations in one action (e.g. all teams from a school). */
export async function confirmPendingRegistrations(
  tournamentId: string,
  registrationIds: string[],
  operationId: string
) {
  const user = await requireUser();
  const uniqueIds = [...new Set(registrationIds)];
  if (uniqueIds.length === 0) {
    return { error: "No registrations selected" };
  }
  if (!UUID_RE.test(operationId)) {
    return { error: "Could not start this update. Try again." };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can update registrations" };
  }

  if (!await canEditRegistrations(tournament, user)) {
    return {
      error: "Registrations cannot be updated in the current tournament stage.",
    };
  }

  let count: number;
  try {
    const result = await transitionRegistrationStatuses({
      tournamentId,
      registrationIds: uniqueIds,
      toStatus: "confirmed",
      actorUserId: user.id,
      operationId,
      reason: "Organizer confirmed pending registrations",
    });
    count = result.count;
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true as const, count };
}

export async function updateDivision(
  tournamentId: string,
  divisionId: string,
  formData: FormData
) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return { error: "Pools cannot be edited in the current tournament stage." };
  }

  const [existingDiv] = await db
    .select()
    .from(divisions)
    .where(eq(divisions.id, divisionId))
    .limit(1);

  if (!existingDiv || existingDiv.tournamentId !== tournamentId) {
    return { error: "Pool not found" };
  }

  const parsed = createDivisionSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const divContentError = await flagBlockedContent(user.id, [
    { area: "division.name", text: parsed.data.name },
  ]);
  if (divContentError) return { error: divContentError };

  const normalizedName = parsed.data.name.trim().toLowerCase();

  const others = await db
    .select({ name: divisions.name })
    .from(divisions)
    .where(
      and(
        eq(divisions.tournamentId, tournamentId),
        ne(divisions.id, divisionId)
      )
    );

  if (
    others.some((d) => d.name.trim().toLowerCase() === normalizedName)
  ) {
    return { error: "A pool with this name already exists" };
  }

  await db
    .update(divisions)
    .set({
      name: parsed.data.name.trim(),
    })
    .where(eq(divisions.id, divisionId));

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true };
}

export async function setCourtsForDivision(
  tournamentId: string,
  divisionId: string,
  courtIds: string[]
) {
  const user = await requireUser();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await canEditTournamentSetup(tournament, user)) {
    return { error: "Court assignments cannot be changed in the current tournament stage." };
  }

  const [div] = await db
    .select()
    .from(divisions)
    .where(eq(divisions.id, divisionId))
    .limit(1);

  if (!div || div.tournamentId !== tournamentId) {
    return { error: "Pool not found" };
  }

  const uniqueIds = [...new Set(courtIds)];
  if (uniqueIds.length !== courtIds.length) {
    return { error: "Duplicate court selection" };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(courtDivisions)
        .where(eq(courtDivisions.divisionId, divisionId));

      if (uniqueIds.length === 0) return;

      const rows = await tx
        .select({ id: courts.id })
        .from(courts)
        .where(
          and(
            eq(courts.tournamentId, tournamentId),
            inArray(courts.id, uniqueIds)
          )
        );

      if (rows.length !== uniqueIds.length) {
        throw new Error("invalid_courts");
      }

      await tx.insert(courtDivisions).values(
        uniqueIds.map((courtId) => ({ courtId, divisionId }))
      );
    });
  } catch {
    return { error: "Could not update court assignments" };
  }

  revalidatePath("/tournaments/[slug]", "page");
  return { success: true };
}

export async function setRegistrationDivision(
  registrationId: string,
  divisionId: string | null
) {
  const user = await requireUser();

  const [reg] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);

  if (!reg) return { error: "Registration not found" };

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, reg.tournamentId))
    .limit(1);

  if (!tournament || !await canEditRegistrations(tournament, user)) {
    return {
      error: "Pool assignments cannot be changed in the current tournament stage.",
    };
  }

  try {
    await assignRegistrationsToDivisionAtomically({
      tournamentId: reg.tournamentId,
      registrationIds: [registrationId],
      divisionId,
      actorUserId: user.id,
    });
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true };
}

/** Assign multiple registrations to one pool (or unassign) in a single update. */
export async function bulkAssignRegistrationsToDivision(
  tournamentId: string,
  registrationIds: string[],
  divisionId: string | null
) {
  const user = await requireUser();
  const uniqueIds = [...new Set(registrationIds)];
  if (uniqueIds.length === 0) {
    return { error: "No teams selected" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can update registrations" };
  }

  if (!await canEditRegistrations(tournament, user)) {
    return {
      error: "Pool assignments cannot be changed in the current tournament stage.",
    };
  }

  let count: number;
  try {
    const result = await assignRegistrationsToDivisionAtomically({
      tournamentId,
      registrationIds: uniqueIds,
      divisionId,
      actorUserId: user.id,
    });
    count = result.count;
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true as const, count };
}

/** Host-only: delete multiple registrations from a tournament at once. */
export async function bulkRemoveRegistrations(
  tournamentId: string,
  registrationIds: string[]
) {
  const user = await requireUser();
  const uniqueIds = [...new Set(registrationIds)];
  if (uniqueIds.length === 0) {
    return { error: "No teams selected" };
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || !await resolveIsTournamentOrganizer(tournament, user)) {
    return { error: "Only the organizer can remove teams" };
  }

  if (!await canEditRegistrations(tournament, user)) {
    return {
      error: "Teams cannot be removed in the current tournament stage.",
    };
  }

  let count: number;
  try {
    const result = await removeRegistrationsAtomically({
      tournamentId,
      registrationIds: uniqueIds,
      actorUserId: user.id,
    });
    count = result.count;
  } catch (error) {
    return { error: competitionOperationError(error) };
  }

  revalidatePath("/tournaments/[slug]", "page");
  revalidatePath("/tournaments/[slug]/register", "page");
  revalidatePath("/tournaments/[slug]/brackets", "page");
  return { success: true as const, count };
}
