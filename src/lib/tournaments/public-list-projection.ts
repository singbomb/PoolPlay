/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type {
  SchoolVerificationStatus,
  TeamGender,
  TeamRegion,
} from "@/types";

interface PublicHostSchool {
  name: string;
  slug: string;
  verificationStatus: SchoolVerificationStatus;
}

export interface PublicTournamentListSourceItem {
  slug: string;
  name: string;
  description: string | null;
  location: string;
  date: string;
  status: string;
  gender: TeamGender;
  region: TeamRegion;
  hostSchool: PublicHostSchool | null;
}

export interface PublicTournamentListItem {
  slug: string;
  name: string;
  description: string | null;
  location: string;
  date: string;
  status: string;
  gender: TeamGender;
  region: TeamRegion;
  hostSchool: PublicHostSchool | null;
}

function publicHostSchool(
  school: PublicHostSchool | null
): PublicHostSchool | null {
  if (!school) return null;
  return {
    name: school.name,
    slug: school.slug,
    verificationStatus: school.verificationStatus,
  };
}

/** Removes server-side join identifiers before tournament cards are serialized. */
export function buildPublicTournamentListProjection<
  T extends PublicTournamentListSourceItem,
>(
  rows: T[]
): PublicTournamentListItem[] {
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    date: row.date,
    status: row.status,
    gender: row.gender,
    region: row.region,
    hostSchool: publicHostSchool(row.hostSchool),
  }));
}
