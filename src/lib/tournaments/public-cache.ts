/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export const PUBLIC_TOURNAMENTS_CACHE_TAG = "public-tournaments";

export function publicTournamentCacheTag(slug: string): string {
  return `public-tournament:${slug}`;
}
