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
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { signUpSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "@/lib/validators";
import { checkContentFilter } from "@/lib/utils/content-filter";
import { appBaseUrl } from "@/lib/email/resend";
import {
  loginRedirectPath,
  pathWithSafeNext,
} from "@/lib/security/safe-redirect";

export async function login(formData: FormData) {
  const requestedDestination = formData.get("next");
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  let error: { message: string } | null = null;
  try {
    const res = await supabase.auth.signInWithPassword(parsed.data);
    error = res.error;
  } catch {
    return {
      error:
        "Authentication service is unavailable or blocked from this network. Try again in a few minutes or switch networks.",
    };
  }

  if (error) {
    return { error: error.message };
  }

  redirect(
    loginRedirectPath(
      typeof requestedDestination === "string" ? requestedDestination : null
    )
  );
}

export async function requestPasswordReset(formData: FormData) {
  const requestedDestination = formData.get("next");
  const raw = {
    email: formData.get("email") as string,
  };

  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const resetPasswordPath = pathWithSafeNext(
    "/reset-password",
    typeof requestedDestination === "string" ? requestedDestination : null
  );
  const callbackPath = pathWithSafeNext("/auth/callback", resetPasswordPath);
  const redirectTo = `${appBaseUrl()}${callbackPath}`;

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
    });
    if (error) {
      return { error: error.message };
    }
  } catch {
    return {
      error:
        "Authentication service is unavailable or blocked from this network. Try again in a few minutes or switch networks.",
    };
  }

  return {
    success: true as const,
    message:
      "If an account exists for that email, we sent a link to reset your password.",
  };
}

export async function updatePassword(formData: FormData) {
  const requestedDestination = formData.get("next");
  const raw = {
    password: formData.get("password") as string,
    confirmPassword: formData.get("confirmPassword") as string,
  };

  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your reset link expired. Request a new one from the sign-in page." };
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      return { error: error.message };
    }
  } catch {
    return {
      error:
        "Authentication service is unavailable or blocked from this network. Try again in a few minutes or switch networks.",
    };
  }

  redirect(
    pathWithSafeNext(
      "/login?reset=success",
      typeof requestedDestination === "string" ? requestedDestination : null
    )
  );
}

export async function signup(formData: FormData) {
  const requestedDestination = formData.get("next");
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    fullName: formData.get("fullName") as string,
    university: (formData.get("university") as string) || undefined,
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const signupContentError = checkContentFilter(
    parsed.data.fullName,
    parsed.data.university
  );
  if (signupContentError) return { error: signupContentError };

  const supabase = await createClient();
  let data: { user: { id: string } | null } | null = null;
  let error: { message: string } | null = null;
  try {
    const res = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          full_name: parsed.data.fullName,
          university: parsed.data.university,
        },
      },
    });
    data = res.data as { user: { id: string } | null };
    error = res.error;
  } catch {
    return {
      error:
        "Authentication service is unavailable or blocked from this network. Try again in a few minutes or switch networks.",
    };
  }

  if (error) {
    return { error: error.message };
  }

  if (data.user) {
    try {
      await db.insert(users).values({
        authId: data.user.id,
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        university: parsed.data.university || null,
        displayEmail: parsed.data.email,
        displaySchool: parsed.data.university?.trim() || null,
        role: "player",
      });
    } catch {
      // User row may already exist from a trigger
    }
  }

  redirect(
    loginRedirectPath(
      typeof requestedDestination === "string" ? requestedDestination : null
    )
  );
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
