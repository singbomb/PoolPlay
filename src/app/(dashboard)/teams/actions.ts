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
  schoolMembers,
  schools,
  teams,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser, isAdmin } from "@/lib/auth";
import { createTeamSchema } from "@/lib/validators";
import { flagBlockedContent } from "@/lib/admin/content-flags";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { isSchoolOfficerOrAbove } from "@/lib/schools/permissions";
import type { SchoolMemberRole } from "@/types";

/**
 * Returns the user's school role, or null if not a member. Used to gate
 * captain-equivalent actions on teams attached to a school.
 */
async function getSchoolRole(
  schoolId: string,
  userId: string
): Promise<SchoolMemberRole | null> {
  const [row] = await db
    .select({ role: schoolMembers.role })
    .from(schoolMembers)
    .where(
      and(
        eq(schoolMembers.schoolId, schoolId),
        eq(schoolMembers.userId, userId)
      )
    )
    .limit(1);
  return row?.role ?? null;
}

export async function createTeam(formData: FormData) {
  const user = await requireUser();

  const rawSchoolId = formData.get("schoolId");
  const parsed = createTeamSchema.safeParse({
    name: formData.get("name"),
    gender: formData.get("gender"),
    region: formData.get("region"),
    schoolId:
      typeof rawSchoolId === "string" && rawSchoolId.length > 0
        ? rawSchoolId
        : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let teamGender = parsed.data.gender;
  let teamRegion = parsed.data.region;
  let teamUniversity: string | null = null;

  if (parsed.data.schoolId) {
    const role = await getSchoolRole(parsed.data.schoolId, user.id);
    const allowed =
      isAdmin(user) || role === "president" || role === "officer";
    if (!allowed) {
      return {
        error:
          "Only school presidents or officers can create teams under a school.",
      };
    }

    const [parentSchool] = await db
      .select({
        gender: schools.gender,
        region: schools.region,
        university: schools.university,
      })
      .from(schools)
      .where(eq(schools.id, parsed.data.schoolId))
      .limit(1);
    if (!parentSchool) {
      return { error: "Selected school no longer exists." };
    }
    teamGender = parentSchool.gender;
    teamRegion = parentSchool.region;
    teamUniversity = parentSchool.university;
  } else {
    const [profile] = await db
      .select({ university: users.university })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    teamUniversity = profile?.university?.trim() ?? "";
    if (!teamUniversity) {
      return {
        error:
          "Link this team to a school, or add your university when you sign up.",
      };
    }
  }

  const teamContentError = await flagBlockedContent(user.id, [
    { area: "team.name", text: parsed.data.name },
    { area: "team.university", text: teamUniversity },
  ]);
  if (teamContentError) return { error: teamContentError };

  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.name, parsed.data.name),
        eq(teams.university, teamUniversity),
        eq(teams.gender, teamGender)
      )
    )
    .limit(1);

  if (existing) {
    return {
      error:
        "A team with this name, university, and gender already exists",
    };
  }

  const base = slugify(`${parsed.data.name} ${teamUniversity}`, "team");
  const existingSlugs = await db.select({ slug: teams.slug }).from(teams);
  const slug = uniqueSlug(
    base,
    existingSlugs.map((t) => t.slug)
  );

  const [team] = await db
    .insert(teams)
    .values({
      name: parsed.data.name,
      slug,
      university: teamUniversity,
      gender: teamGender,
      region: teamRegion,
      schoolId: parsed.data.schoolId ?? null,
      verificationStatus: parsed.data.schoolId ? "verified" : "pending",
    })
    .returning();

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "captain",
  });

  // Promote user to captain role if currently player
  if (user.role === "player") {
    await db
      .update(users)
      .set({ role: "captain" })
      .where(eq(users.id, user.id));
  }

  redirect(`/teams/${team.slug}`);
}

export async function addTeamMember(teamId: string, formData: FormData) {
  const user = await requireUser();
  const email = formData.get("email") as string;

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return { error: "Team not found" };

  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id))
    );

  const isCaptain = membership?.role === "captain";
  let canManage: boolean = isAdmin(user) || isCaptain;

  // School officers/presidents can manage rosters of teams under their school
  // even if they're not a team captain themselves.
  if (!canManage && team.schoolId) {
    const role = await getSchoolRole(team.schoolId, user.id);
    canManage = isSchoolOfficerOrAbove(
      role ? { schoolId: team.schoolId, userId: user.id, role } : null
    );
  }

  if (!canManage) {
    return { error: "Only captains or school officers can add members" };
  }

  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!targetUser) {
    return { error: "No user found with that email" };
  }

  // When the team belongs to a school, the new player must already be on the
  // school's master roster. This keeps the school as the source of truth.
  if (team.schoolId) {
    const [schoolRow] = await db
      .select({ slug: schools.slug })
      .from(schools)
      .where(eq(schools.id, team.schoolId))
      .limit(1);

    const targetRole = await getSchoolRole(team.schoolId, targetUser.id);
    if (!targetRole) {
      return {
        error: schoolRow
          ? `Add this user to the school roster first at /schools/${schoolRow.slug}`
          : "User must be on the school roster first.",
      };
    }
  }

  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, targetUser.id)
      )
    );

  if (existing) {
    return { error: "User is already on this team" };
  }

  const jerseyNumber = formData.get("jerseyNumber");

  await db.insert(teamMembers).values({
    teamId,
    userId: targetUser.id,
    role: "player",
    jerseyNumber: jerseyNumber ? parseInt(jerseyNumber as string, 10) : null,
  });

  revalidatePath("/teams/[slug]", "page");
  return { success: true };
}

export async function removeTeamMember(teamId: string, memberId: string) {
  const user = await requireUser();

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return { error: "Team not found" };

  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id))
    );

  let canManage: boolean =
    isAdmin(user) || membership?.role === "captain";

  if (!canManage && team.schoolId) {
    const role = await getSchoolRole(team.schoolId, user.id);
    canManage = isSchoolOfficerOrAbove(
      role ? { schoolId: team.schoolId, userId: user.id, role } : null
    );
  }

  if (!canManage) {
    return { error: "Only captains or school officers can remove members" };
  }

  const [removedMember] = await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.id, memberId),
        eq(teamMembers.teamId, teamId)
      )
    )
    .returning({ id: teamMembers.id });

  if (!removedMember) {
    return { error: "Member not found" };
  }

  revalidatePath("/teams/[slug]", "page");
  return { success: true };
}

export async function deleteTeam(teamId: string, confirmationName: string) {
  const user = await requireUser();

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return { error: "Team not found" };

  if (team.name.trim() !== confirmationName.trim()) {
    return {
      error:
        "Team name does not match — type it exactly as shown (including spaces).",
    };
  }

  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id))
    )
    .limit(1);

  let canManage: boolean =
    isAdmin(user) || membership?.role === "captain";

  if (!canManage && team.schoolId) {
    const role = await getSchoolRole(team.schoolId, user.id);
    canManage = isSchoolOfficerOrAbove(
      role ? { schoolId: team.schoolId, userId: user.id, role } : null
    );
  }

  if (!canManage) {
    return { error: "Only team captains or school officers can delete this team" };
  }

  try {
    await db.delete(teams).where(eq(teams.id, teamId));
  } catch {
    return { error: "Could not delete team. Try again." };
  }

  revalidatePath("/teams");
  revalidatePath("/admin");
  return { success: true as const };
}
