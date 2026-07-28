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

const REDIRECT_VALIDATION_ORIGIN = "https://poolplay.invalid";
const ASCII_CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

/** Reject any target that browser URL parsing could resolve off-site. */
export function safeRedirectPath(
  next: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!next) return fallback;
  if (
    !next.startsWith("/") ||
    ASCII_CONTROL_OR_SPACE.test(next) ||
    next.includes("\\")
  ) {
    return fallback;
  }
  try {
    const destination = new URL(next, REDIRECT_VALIDATION_ORIGIN);
    if (destination.origin !== REDIRECT_VALIDATION_ORIGIN) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

/** Preserve the normal login landing page unless a safe local target is given. */
export function loginRedirectPath(next: string | null | undefined): string {
  return safeRedirectPath(next, "/dashboard?welcome=1");
}

/** Add a validated local destination to an auth page without changing its default. */
export function pathWithSafeNext(
  path: string,
  next: string | null | undefined
): string {
  const safeNext = safeRedirectPath(next, "");
  if (!safeNext) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}next=${encodeURIComponent(safeNext)}`;
}
