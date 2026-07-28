/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicTournamentDetail } from "@/components/public-tournament-detail";
import { getCurrentAuthProfile } from "@/lib/auth";
import { pageMetadata } from "@/lib/metadata";
import {
  getPublicTournamentMetadataBySlug,
  getPublicTournamentViewBySlug,
} from "@/lib/tournaments/public-view";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await getPublicTournamentMetadataBySlug(slug);
  return pageMetadata(
    tournament?.name ?? "Tournament",
    tournament?.description ??
      "Follow public schedules, standings, brackets, and live scores."
  );
}

export default async function ExploreTournamentPage({ params }: Props) {
  const { slug } = await params;
  const [authProfile, view] = await Promise.all([
    getCurrentAuthProfile(),
    getPublicTournamentViewBySlug(slug),
  ]);
  if (!view) notFound();
  return <PublicTournamentDetail authProfile={authProfile} view={view} />;
}
