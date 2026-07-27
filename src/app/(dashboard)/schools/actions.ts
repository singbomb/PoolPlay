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
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schoolMembers,
  schools,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { flagBlockedContent } from "@/lib/admin/content-flags";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import {
  addSchoolMemberSchema,
  createSchoolSchema,
  updateSchoolSchema,
} from "@/lib/validators";
import {
  canManageSchool,
  canManageSchoolRoster,
  canSubmitForVerification,
  canTransferPresidency,
  emailMatchesDomain,
  getVerificationEligibility,
  type CurrentSchoolMembership,
} from "@/lib/schools/permissions";
import type { SchoolMemberRole } from "@/types";
import { z } from "zod";
import { TEAM_GENDERS, TEAM_REGIONS } from "@/lib/constants/team";
import {
  hasSchoolSearchCriteria,
  searchSchools,
  type SchoolSearchItem,
} from "@/lib/schools/search";
import { assertTeamSchoolAttachmentAuthorized } from "@/lib/security/authorization-invariants";

const schoolSearchSchema = z.object({
  query: z.string().max(200).optional().default(""),
  genders: z.array(z.enum(TEAM_GENDERS)).optional().default([]),
  regions: z.array(z.enum(TEAM_REGIONS)).optional().default([]),
  verificationStatuses: z
    .array(z.enum(["pending", "verified", "rejected"]))
    .optional()
    .default([]),
  offset: z.number().int().min(0).optional().default(0),
});

export type SchoolSearchResult =
  | { error: string }
  | {
      success: true;
      schools: SchoolSearchItem[];
      total: number;
      limit: number;
      offset: number;
    };

export async function searchSchoolsForDiscovery(
  input: z.input<typeof schoolSearchSchema>
): Promise<SchoolSearchResult> {
  await requireUser();

  const parsed = schoolSearchSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid search." };
  }

  const { query, genders, regions, verificationStatuses, offset } =
    parsed.data;

  if (
    !hasSchoolSearchCriteria({
      query,
      genders,
      regions,
      verificationStatuses,
    })
  ) {
    return { error: "Enter a search term or choose at least one filter." };
  }

  const result = await searchSchools({
    query,
    genders,
    regions,
    verificationStatuses,
    offset,
  });

  return { success: true, ...result };
}

async function loadMembership(
  schoolId: string,
  userId: string
): Promise<CurrentSchoolMembership> {
  const [row] = await db
    .select({
      schoolId: schoolMembers.schoolId,
      userId: schoolMembers.userId,
      role: schoolMembers.role,
    })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, schoolId),
        eq(schoolMembers.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

async function loadSchool(schoolId: string) {
  const [row] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row ?? null;
}

/** A user can only belong to one school at a time. Returns the existing
 * school's slug if they're already a member, otherwise null. */
async function findExistingSchoolSlugForUser(
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ slug: schools.slug })
    .from(schoolMembers)
    .innerJoin(schools, eq(schools.id, schoolMembers.schoolId))
    .where(eq(schoolMembers.userId, userId))
    .limit(1);
  return row?.slug ?? null;
}

export async function createSchool(formData: FormData) {
  const user = await requireUser();

  // One school per user — bounce them to their existing school instead.
  const existingSlug = await findExistingSchoolSlugForUser(user.id);
  if (existingSlug) {
    return {
      error: `You're already part of a school. Leave it before creating a new one.`,
    };
  }

  const parsed = createSchoolSchema.safeParse({
    name: formData.get("name"),
    university: formData.get("university"),
    gender: formData.get("gender"),
    region: formData.get("region"),
    description: formData.get("description"),
    websiteUrl: formData.get("websiteUrl"),
    domainHint: formData.get("domainHint"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "school.name", text: parsed.data.name },
    { area: "school.university", text: parsed.data.university },
    { area: "school.description", text: parsed.data.description ?? null },
  ]);
  if (contentError) return { error: contentError };

  const base = slugify(
    `${parsed.data.name} ${parsed.data.university}`,
    "school"
  );
  const existingSlugs = await db.select({ slug: schools.slug }).from(schools);
  const slug = uniqueSlug(
    base,
    existingSlugs.map((s) => s.slug)
  );

  const result = await db.transaction(async (tx) => {
    const [school] = await tx
      .insert(schools)
      .values({
        name: parsed.data.name,
        slug,
        university: parsed.data.university,
        gender: parsed.data.gender,
        region: parsed.data.region,
        description: parsed.data.description ?? null,
        websiteUrl: parsed.data.websiteUrl,
        domainHint: parsed.data.domainHint,
      })
      .returning();

    await tx.insert(schoolMembers).values({
      schoolId: school.id,
      userId: user.id,
      role: "president",
    });

    return school;
  });

  revalidatePath("/schools");
  redirect(`/schools/${result.slug}`);
}

export async function updateSchool(
  schoolId: string,
  formData: FormData
) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canManageSchool(membership, user)) {
    return { error: "Only the school president can edit details." };
  }

  const parsed = updateSchoolSchema.safeParse({
    name: formData.get("name") ?? undefined,
    university: formData.get("university") ?? undefined,
    gender: formData.get("gender") ?? undefined,
    region: formData.get("region") ?? undefined,
    description: formData.get("description") ?? undefined,
    websiteUrl: formData.get("websiteUrl") ?? undefined,
    domainHint: formData.get("domainHint") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const contentError = await flagBlockedContent(user.id, [
    { area: "school.name", text: parsed.data.name ?? null },
    { area: "school.university", text: parsed.data.university ?? null },
    { area: "school.description", text: parsed.data.description ?? null },
  ]);
  if (contentError) return { error: contentError };

  let slug = school.slug;
  const renaming =
    parsed.data.name !== undefined && parsed.data.name !== school.name;
  if (renaming) {
    const base = slugify(
      `${parsed.data.name} ${parsed.data.university ?? school.university}`,
      "school"
    );
    const otherSlugs = await db
      .select({ slug: schools.slug })
      .from(schools)
      .where(ne(schools.id, schoolId));
    slug = uniqueSlug(
      base,
      otherSlugs.map((r) => r.slug)
    );
  }

  await db
    .update(schools)
    .set({
      name: parsed.data.name ?? school.name,
      slug,
      university: parsed.data.university ?? school.university,
      gender: parsed.data.gender ?? school.gender,
      region: parsed.data.region ?? school.region,
      description:
        parsed.data.description !== undefined
          ? parsed.data.description ?? null
          : school.description,
      websiteUrl:
        parsed.data.websiteUrl !== undefined
          ? parsed.data.websiteUrl
          : school.websiteUrl,
      domainHint:
        parsed.data.domainHint !== undefined
          ? parsed.data.domainHint
          : school.domainHint,
      updatedAt: new Date(),
    })
    .where(eq(schools.id, schoolId));

  revalidatePath("/schools");
  revalidatePath(`/schools/${school.slug}`);
  if (slug !== school.slug) {
    revalidatePath(`/schools/${slug}`);
  }
  return { success: true as const, slug };
}

export async function deleteSchool(schoolId: string) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canManageSchool(membership, user)) {
    return { error: "Only the school president can delete this school." };
  }

  try {
    await db.delete(schools).where(eq(schools.id, schoolId));
  } catch {
    return { error: "Could not delete school. Try again." };
  }

  revalidatePath("/schools");
  revalidatePath("/teams");
  return { success: true as const };
}

export async function addSchoolMember(
  schoolId: string,
  formData: FormData
) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canManageSchoolRoster(membership, user)) {
    return { error: "Only school officers can add roster members." };
  }

  const parsed = addSchoolMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    title: formData.get("title"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email.toLowerCase().trim()))
    .limit(1);

  if (!target) {
    return {
      error: "No user found with that email. They must sign up first.",
    };
  }

  const [existing] = await db
    .select({ id: schoolMembers.id })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, schoolId),
        eq(schoolMembers.userId, target.id)
      )
    )
    .limit(1);

  if (existing) {
    return { error: "User is already a member of this school." };
  }

  // One school per user.
  const otherSchoolSlug = await findExistingSchoolSlugForUser(target.id);
  if (otherSchoolSlug) {
    return {
      error: "That user is already part of another school.",
    };
  }

  await db.insert(schoolMembers).values({
    schoolId,
    userId: target.id,
    role: parsed.data.role,
    title: parsed.data.title,
  });

  revalidatePath(`/schools/${school.slug}`);
  return { success: true as const };
}

export async function leaveSchool(schoolId: string) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!membership) {
    return { error: "You are not a member of this school." };
  }
  if (membership.role === "president") {
    return {
      error:
        "Presidents must transfer presidency or delete the school before leaving.",
    };
  }

  await db
    .delete(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, schoolId),
        eq(schoolMembers.userId, user.id)
      )
    );

  revalidatePath("/schools");
  revalidatePath(`/schools/${school.slug}`);
  return { success: true as const };
}

export async function removeSchoolMember(
  schoolId: string,
  membershipId: string
) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canManageSchoolRoster(membership, user)) {
    return { error: "Only school officers can remove roster members." };
  }

  const [target] = await db
    .select()
    .from(schoolMembers)
    .where(eq(schoolMembers.id, membershipId))
    .limit(1);

  if (!target || target.schoolId !== schoolId) {
    return { error: "Member not found." };
  }

  if (target.role === "president") {
    return {
      error:
        "Transfer presidency to another member before removing the current president.",
    };
  }

  await db.delete(schoolMembers).where(eq(schoolMembers.id, membershipId));

  revalidatePath(`/schools/${school.slug}`);
  return { success: true as const };
}

export async function updateSchoolMemberRole(
  schoolId: string,
  membershipId: string,
  role: SchoolMemberRole
) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canManageSchoolRoster(membership, user)) {
    return { error: "Only school officers can change roles." };
  }

  if (role === "president") {
    return {
      error: "Use 'Transfer presidency' to make someone president.",
    };
  }

  const [target] = await db
    .select()
    .from(schoolMembers)
    .where(eq(schoolMembers.id, membershipId))
    .limit(1);

  if (!target || target.schoolId !== schoolId) {
    return { error: "Member not found." };
  }

  if (target.role === "president") {
    return {
      error: "Transfer presidency before changing the president's role.",
    };
  }

  await db
    .update(schoolMembers)
    .set({ role, title: role === "member" ? null : target.title })
    .where(eq(schoolMembers.id, membershipId));

  revalidatePath(`/schools/${school.slug}`);
  return { success: true as const };
}

export async function transferPresidency(
  schoolId: string,
  newPresidentMembershipId: string
) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  if (!canTransferPresidency(membership, user)) {
    return {
      error: "Only the current president can transfer presidency.",
    };
  }

  const [next] = await db
    .select()
    .from(schoolMembers)
    .where(eq(schoolMembers.id, newPresidentMembershipId))
    .limit(1);

  if (!next || next.schoolId !== schoolId) {
    return { error: "Member not found." };
  }
  if (next.role === "president") {
    return { error: "That member is already the president." };
  }

  await db.transaction(async (tx) => {
    // Swap to officer first (the partial unique index requires only one
    // president row at a time).
    await tx
      .update(schoolMembers)
      .set({ role: "officer" })
      .where(
        and(
          eq(schoolMembers.schoolId, schoolId),
          eq(schoolMembers.role, "president")
        )
      );

    await tx
      .update(schoolMembers)
      .set({ role: "president" })
      .where(eq(schoolMembers.id, newPresidentMembershipId));
  });

  revalidatePath(`/schools/${school.slug}`);
  return { success: true as const };
}

export async function submitForVerification(schoolId: string) {
  const user = await requireUser();
  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);

  // Re-compute eligibility on the server: counts and president presence
  // could have changed since the page was rendered.
  const officerRows = await db
    .select({
      role: schoolMembers.role,
      email: users.email,
    })
    .from(schoolMembers)
    .innerJoin(users, eq(schoolMembers.userId, users.id))
    .where(eq(schoolMembers.schoolId, schoolId));

  const presidentRow = officerRows.find((r) => r.role === "president");
  const officerCount = officerRows.filter((r) => r.role === "officer").length;

  const eligibility = getVerificationEligibility({
    status: school.verificationStatus,
    hasPresident: !!presidentRow,
    officerCount,
  });

  if (!canSubmitForVerification(membership, user, eligibility)) {
    return {
      error:
        eligibility.reason ??
        "Only the president can submit for verification.",
    };
  }

  const domainMatched = officerRows.some(
    (r) =>
      (r.role === "president" || r.role === "officer") &&
      emailMatchesDomain(r.email, school.domainHint)
  );

  await db
    .update(schools)
    .set({
      domainMatched,
      verificationStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(schools.id, schoolId));

  revalidatePath(`/schools/${school.slug}`);
  revalidatePath("/admin");
  return { success: true as const, domainMatched };
}

/**
 * Lists schools where the current user can create a team (officer or
 * president). Used to populate the "Part of a school" picker on the team
 * create form.
 */
export async function listManageableSchoolsForUser() {
  const user = await requireUser();

  return db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      university: schools.university,
      gender: schools.gender,
      region: schools.region,
      role: schoolMembers.role,
    })
    .from(schools)
    .innerJoin(schoolMembers, eq(schoolMembers.schoolId, schools.id))
    .where(
      and(
        eq(schoolMembers.userId, user.id),
        // members cannot create teams under the school
        ne(schoolMembers.role, "member")
      )
    );
}

export async function attachTeamToSchool(teamId: string, schoolId: string) {
  const user = await requireUser();

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return { error: "Team not found" };

  const school = await loadSchool(schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(schoolId, user.id);
  const [teamMembership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, user.id)
      )
    )
    .limit(1);
  const currentSchoolMembership = team.schoolId
    ? await loadMembership(team.schoolId, user.id)
    : null;

  try {
    assertTeamSchoolAttachmentAuthorized({
      canManageTeam:
        teamMembership?.role === "captain" ||
        canManageSchoolRoster(currentSchoolMembership, user),
      canManageSchool: canManageSchoolRoster(membership, user),
    });
  } catch {
    return {
      error:
        "You must be authorized to manage both the team and the destination school.",
    };
  }

  await db
    .update(teams)
    .set({
      schoolId,
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));

  revalidatePath(`/schools/${school.slug}`);
  revalidatePath(`/teams/${team.slug}`);
  revalidatePath("/teams");
  return { success: true as const };
}

export async function detachTeamFromSchool(teamId: string) {
  const user = await requireUser();

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return { error: "Team not found" };
  if (!team.schoolId) {
    return { error: "Team is not part of a school." };
  }

  const school = await loadSchool(team.schoolId);
  if (!school) return { error: "School not found" };

  const membership = await loadMembership(team.schoolId, user.id);
  if (!canManageSchoolRoster(membership, user)) {
    return { error: "Only school officers can detach teams." };
  }

  await db
    .update(teams)
    .set({
      schoolId: null,
      verificationStatus: "pending",
      verifiedAt: null,
      verifiedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));

  revalidatePath(`/schools/${school.slug}`);
  revalidatePath(`/teams/${team.slug}`);
  revalidatePath("/teams");
  return { success: true as const };
}
