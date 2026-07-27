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

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { divisions, sets, teams, courts, teamMembers, tournaments } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { BackLink } from "@/components/layout/back-link";
import { getTournamentBySlugIfVisible } from "@/lib/tournaments/access";
import {
  canRefereeMatch,
  canViewDivisionPoolPlay,
  resolveIsTournamentOrganizer,
} from "@/lib/tournaments/permissions";
import { resolveMatchInTournament } from "@/lib/tournaments/match-query";
import { isUuid } from "@/lib/tournaments/match-slug";
import {
  getMatchDivisionIdMap,
} from "@/lib/tournaments/unreleased-divisions";
import { isBracketRoundOneByeMatch, byeWinnerId } from "@/lib/utils/bracket";
import { setStartingScoreForMatch } from "@/lib/tournaments/match-format";
import { tournamentTabUrl } from "../../constants";
import { ByeMatchNotice } from "./bye-match-notice";
import { MatchConsole } from "./match-console";
import type { Metadata } from "next";
import { getTournamentNameBySlug } from "@/lib/tournaments/metadata";
import { pageMetadata, pageTitle } from "@/lib/metadata";

interface Props {
  params: Promise<{ slug: string; matchSlug: string }>;
}

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { slug, matchSlug: rawMatchSlug } = await params;
  const matchSlug = decodeURIComponent(rawMatchSlug).trim();
  const tournamentName = await getTournamentNameBySlug(slug);
  if (!tournamentName) return pageMetadata("Match");

  const [tournament] = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(eq(tournaments.slug, slug))
    .limit(1);
  if (!tournament) return pageMetadata(pageTitle("Match", tournamentName));

  const match = await resolveMatchInTournament(tournament.id, matchSlug);
  if (!match) return pageMetadata(pageTitle("Match", tournamentName));

  const [teamA, teamB] = await Promise.all([
    loadTeam(match.teamAId),
    loadTeam(match.teamBId),
  ]);
  const matchup =
    teamA?.name && teamB?.name
      ? `${teamA.name} vs ${teamB.name}`
      : teamA?.name ?? teamB?.name ?? "Match";

  return pageMetadata(pageTitle(matchup, tournamentName));
}

async function loadTeam(teamId: string | null) {
  if (!teamId) return null;
  const [row] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export default async function MatchPage({ params }: Props) {
  const { slug, matchSlug: rawMatchSlug } = await params;
  const matchSlug = decodeURIComponent(rawMatchSlug).trim();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tournament = await getTournamentBySlugIfVisible(slug, user);
  if (!tournament) notFound();

  const match = await resolveMatchInTournament(tournament.id, matchSlug);
  if (!match) notFound();

  // Canonicalize legacy UUID links to the readable slug URL.
  if (isUuid(matchSlug) && match.slug !== matchSlug) {
    redirect(`/tournaments/${slug}/matches/${match.slug}`);
  }

  const isOrganizer = await resolveIsTournamentOrganizer(tournament, user);

  const divisionByMatch = await getMatchDivisionIdMap(tournament.id);
  const divisionId = divisionByMatch.get(match.id);
  if (divisionId) {
    const [division] = await db
      .select({ poolsReleasedAt: divisions.poolsReleasedAt })
      .from(divisions)
      .where(eq(divisions.id, divisionId))
      .limit(1);
    if (
      !await canViewDivisionPoolPlay(
        tournament,
        user,
        division?.poolsReleasedAt ?? null
      )
    ) {
      notFound();
    }
  }

  const [teamA, teamB, refTeam, courtRow, matchSets, memberRows] =
    await Promise.all([
      loadTeam(match.teamAId),
      loadTeam(match.teamBId),
      loadTeam(match.refTeamId),
      match.courtId
        ? db
            .select({ name: courts.name })
            .from(courts)
            .where(eq(courts.id, match.courtId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          setNumber: sets.setNumber,
          teamAScore: sets.teamAScore,
          teamBScore: sets.teamBScore,
        })
        .from(sets)
        .where(eq(sets.matchId, match.id))
        .orderBy(asc(sets.setNumber)),
      db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, user.id)),
    ]);

  const userTeamIds = new Set(memberRows.map((r) => r.teamId));
  const canControl = await canRefereeMatch(tournament, user, match, userTeamIds);
  const isRefMember =
    !isOrganizer &&
    match.refTeamId != null &&
    userTeamIds.has(match.refTeamId);

  const isBye = isBracketRoundOneByeMatch(match);

  const backHref =
    match.poolId && divisionId
      ? tournamentTabUrl(slug, "pool-play", {
          division: divisionId,
          pool: match.poolId,
        })
      : match.bracketId
        ? tournamentTabUrl(slug, "bracket")
        : `/tournaments/${slug}`;
  const backLabel =
    match.poolId && divisionId
      ? "Back to pool"
      : match.bracketId
        ? "Back to brackets"
        : "Back to tournament";

  if (isBye) {
    const winnerId = byeWinnerId(match);
    const byeTeam =
      winnerId === match.teamAId
        ? teamA
        : winnerId === match.teamBId
          ? teamB
          : teamA ?? teamB;

    return (
      <div className="space-y-6">
        <BackLink href={backHref}>{backLabel}</BackLink>
        <ByeMatchNotice teamName={byeTeam?.name ?? "Team"} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href={backHref}>{backLabel}</BackLink>
      <MatchConsole
        slug={slug}
        tournamentId={tournament.id}
        tournamentDate={tournament.date}
        match={{
          id: match.id,
          status: match.status,
          scheduledTime: match.scheduledTime
            ? match.scheduledTime.toISOString()
            : null,
          warmupStartedAt: match.warmupStartedAt
            ? match.warmupStartedAt.toISOString()
            : null,
          startedAt: match.startedAt ? match.startedAt.toISOString() : null,
          winnerId: match.winnerId,
          scoreRevision: match.scoreRevision,
          teamA,
          teamB,
          refTeamName: refTeam?.name ?? null,
          courtName: courtRow[0]?.name ?? null,
          sets: matchSets,
        }}
        settings={{
          matchFormat: tournament.matchFormat,
          setStartingScore: setStartingScoreForMatch(tournament, match),
          setTargetScore: tournament.setTargetScore,
          tiebreakTargetScore: tournament.tiebreakTargetScore,
          warmupFormat: tournament.warmupFormat,
        }}
        canControl={canControl}
        isOrganizer={isOrganizer}
        isRefMember={isRefMember}
      />
    </div>
  );
}
