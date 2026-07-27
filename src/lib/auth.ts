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

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Comma-separated list of emails that should be auto-promoted to the
 * "admin" role on login. Lower-cased for case-insensitive comparison.
 * Empty when the env var is unset.
 */
function adminBootstrapEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const getCurrentAuthProfile = cache(async function getCurrentAuthProfile() {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));

  if (!hasAuthCookie) return null;

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  return {
    email: authUser.email ?? "",
    fullName:
      (authUser.user_metadata?.full_name as string | undefined) ??
      authUser.email?.split("@")[0] ??
      "User",
  };
});

/**
 * De-duplicates the auth-user + DB lookup within a single server request.
 * Layouts, pages, and components that all call getCurrentUser() share one
 * result instead of each triggering their own round-trips to Supabase Auth
 * and the database.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const bootstrapAdmins = adminBootstrapEmails();
  const email = (authUser.email ?? "").toLowerCase();
  const shouldBeAdmin = email.length > 0 && bootstrapAdmins.has(email);

  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.authId, authUser.id))
    .limit(1);

  if (dbUser) {
    // Auto-promote bootstrap admins on every login so revoking an env entry
    // does not leak access (we don't auto-demote, that stays manual).
    if (shouldBeAdmin && dbUser.role !== "admin") {
      const [promoted] = await db
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(users.id, dbUser.id))
        .returning();
      return promoted ?? { ...dbUser, role: "admin" as const };
    }
    return dbUser;
  }

  // Auth user exists but no DB row (signup succeeded in Supabase Auth
  // but the DB insert failed, e.g. due to a connection issue at the time).
  // Auto-create the missing row so the app doesn't redirect-loop.
  const meta = authUser.user_metadata ?? {};
  const university = (meta.university as string)?.trim() || null;
  const accountEmail = authUser.email ?? "";
  const [newUser] = await db
    .insert(users)
    .values({
      authId: authUser.id,
      email: accountEmail,
      fullName: (meta.full_name as string) || authUser.email?.split("@")[0] || "User",
      university,
      displayEmail: accountEmail || null,
      displaySchool: university,
      role: shouldBeAdmin ? "admin" : "player",
    })
    .onConflictDoNothing({ target: users.authId })
    .returning();

  return newUser ?? null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export function isAdmin(user: { role: string } | null | undefined): boolean {
  return user?.role === "admin";
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) {
    throw new Error("Forbidden");
  }
  return user;
}
