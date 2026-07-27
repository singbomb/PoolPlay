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

import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Download, User } from "lucide-react";
import { and, count, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  courts,
  divisions,
  registrations,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { BackLink } from "@/components/layout/back-link";
import { TeamAttributesBadges } from "@/components/team-attributes-badges";
import { TournamentHostSchoolLink } from "@/components/tournament-host-school-link";
import { TournamentLocationLink } from "@/components/tournament-location-link";
import { MatchRealtimeRefresh } from "@/components/realtime/match-realtime-refresh";
import { formatTournamentDateDisplay } from "@/lib/date-iso";
import {
  canEditTournamentSetup,
  canRegisterTeams,
  hostChecklistSteps,
  resolveIsTournamentOrganizer,
  tournamentPreparationLockedReason,
} from "@/lib/tournaments/permissions";
import {
  getTournamentPlaySignals,
} from "@/lib/tournaments/match-query";
import { getHostSchoolById } from "@/lib/tournaments/host-school";
import { getTournamentBySlugIfVisible } from "@/lib/tournaments/access";
import { userCanDownloadTournamentPacket } from "@/lib/tournaments/packet-access";
import { userCanAccessTournamentWaiver } from "@/lib/tournaments/waiver-access";
import { userCanAccessTournamentPayment } from "@/lib/tournaments/payment-access";
import {
  userCanViewTournamentChat,
} from "@/lib/tournaments/chat-access";
import {
  buildTournamentTabGroups,
  DEFAULT_TOURNAMENT_TAB,
  parseTournamentTab,
  type TournamentTabId,
  type TournamentTabItem,
} from "./constants";
import { TournamentPageHeading } from "./tournament-page-heading";
import { TournamentTabs } from "./tournament-tabs";
import { TournamentPanelSkeleton } from "./panels/panel-skeleton";
import { TournamentChatNotifier } from "./tournament-chat-notifier";
import { TournamentActivePanel } from "./tournament-active-panel";
import type { Metadata } from "next";
import {
  getTournamentNameBySlug,
  tournamentDetailTitle,
} from "@/lib/tournaments/metadata";
import { pageMetadata } from "@/lib/metadata";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ tab?: string; division?: string; pool?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">): Promise<Metadata> {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const name = await getTournamentNameBySlug(slug);
  if (!name) return pageMetadata("Tournament");
  return pageMetadata(tournamentDetailTitle(name, sp.tab));
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tournament = await getTournamentBySlugIfVisible(slug, user);
  if (!tournament) notFound();

  const id = tournament.id;
  const isOrganizer = await resolveIsTournamentOrganizer(tournament, user);
  const canEditSetup =
    isOrganizer && await canEditTournamentSetup(tournament, user);
  const preparationLockedReason = isOrganizer
    ? tournamentPreparationLockedReason(tournament)
    : null;
  const showRegisterLink = canRegisterTeams(tournament);

  // Shell queries only — tab panels load their own heavy data.
  const [
    organizerRows,
    tournamentDivisions,
    courtCountRow,
    registrationCounts,
    memberRows,
    hostSchool,
  ] = await Promise.all([
    db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, tournament.organizerId))
      .limit(1),
    db
      .select({
        id: divisions.id,
        format: divisions.format,
        poolsReleasedAt: divisions.poolsReleasedAt,
      })
      .from(divisions)
      .where(eq(divisions.tournamentId, id)),
    db
      .select({ value: count() })
      .from(courts)
      .where(eq(courts.tournamentId, id)),
    db
      .select({
        status: registrations.status,
        value: count(),
      })
      .from(registrations)
      .where(eq(registrations.tournamentId, id))
      .groupBy(registrations.status),
    db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id)),
    getHostSchoolById(tournament.hostSchoolId),
  ]);

  const organizer = organizerRows[0] ?? null;
  const courtCount = courtCountRow[0]?.value ?? 0;
  const divisionCount = tournamentDivisions.length;

  let pendingCount = 0;
  let confirmedCount = 0;
  let registrationCount = 0;
  for (const row of registrationCounts) {
    registrationCount += row.value;
    if (row.status === "pending") pendingCount = row.value;
    if (row.status === "confirmed" || row.status === "checked_in") {
      confirmedCount += row.value;
    }
  }

  const myTeamIds = memberRows.map((r) => r.teamId);
  const myTeamIdsSet = new Set(myTeamIds);

  const [
    playSignals,
    canDownloadPacket,
    canAccessWaiver,
    canAccessPayment,
    showChatTab,
    myPendingRow,
  ] = await Promise.all([
    getTournamentPlaySignals(id, { forOrganizer: isOrganizer }),
    userCanDownloadTournamentPacket(tournament, user, myTeamIdsSet),
    userCanAccessTournamentWaiver(tournament, user, myTeamIdsSet),
    userCanAccessTournamentPayment(tournament, user, myTeamIdsSet),
    userCanViewTournamentChat(tournament, user, myTeamIds),
    !isOrganizer && myTeamIds.length > 0
      ? db
          .select({ value: count() })
          .from(registrations)
          .where(
            and(
              eq(registrations.tournamentId, id),
              eq(registrations.status, "pending"),
              inArray(registrations.teamId, myTeamIds)
            )
          )
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);

  const hasScheduledMatches = playSignals.hasScheduledMatches;
  const myPendingCount = myPendingRow?.value ?? 0;

  const hasPoolPlayFormat = tournamentDivisions.some(
    (d) => d.format === "pool_to_bracket"
  );
  const hasBracketFormat = tournamentDivisions.some(
    (d) =>
      d.format === "pool_to_bracket" ||
      d.format === "single_elimination" ||
      d.format === "double_elimination"
  );
  const hasReleasedPoolPlay = tournamentDivisions.some(
    (d) => d.poolsReleasedAt != null
  );

  const showTeamsTab = isOrganizer;
  const showPendingTab = isOrganizer || myPendingCount > 0;
  const showPoolPlayTab = isOrganizer
    ? playSignals.hasPoolMatches || hasPoolPlayFormat
    : hasReleasedPoolPlay;
  const showBracketTab = isOrganizer
    ? playSignals.hasBrackets || hasBracketFormat
    : playSignals.hasBrackets;
  const showMatchesTab = playSignals.hasVisibleMatches;

  const showPacketTab = isOrganizer || canDownloadPacket;
  const showWaiverTab =
    isOrganizer || (tournament.waiverEnabled && canAccessWaiver);
  const showPaymentTab =
    isOrganizer || (tournament.paymentEnabled && canAccessPayment);
  const captainTeamIds = new Set(
    memberRows.filter((r) => r.role === "captain").map((r) => r.teamId)
  );

  const allowedTabs = new Set<TournamentTabId>([DEFAULT_TOURNAMENT_TAB]);
  if (showPacketTab) allowedTabs.add("packet");
  if (showWaiverTab) allowedTabs.add("waiver");
  if (showPaymentTab) allowedTabs.add("payment");
  if (isOrganizer) allowedTabs.add("messages");
  if (showChatTab) allowedTabs.add("chat");
  if (showTeamsTab) allowedTabs.add("teams");
  if (showPendingTab) allowedTabs.add("pending");
  if (showPoolPlayTab) allowedTabs.add("pool-play");
  if (showBracketTab) allowedTabs.add("bracket");
  if (showMatchesTab) allowedTabs.add("matches");

  const fallbackTab: TournamentTabId =
    !isOrganizer && myPendingCount > 0 && allowedTabs.has("pending")
      ? "pending"
      : DEFAULT_TOURNAMENT_TAB;

  const activeTab = parseTournamentTab(sp.tab, allowedTabs, fallbackTab);

  const tabItems: TournamentTabItem[] = [
    { id: "setup", label: "Setup" },
  ];
  if (showPacketTab) {
    tabItems.push({ id: "packet", label: "Packet" });
  }
  if (showWaiverTab) {
    tabItems.push({ id: "waiver", label: "Waiver" });
  }
  if (showPaymentTab) {
    tabItems.push({ id: "payment", label: "Payment" });
  }
  if (isOrganizer) {
    tabItems.push({ id: "messages", label: "Messages" });
  }
  if (showChatTab) {
    tabItems.push({ id: "chat", label: "Chat" });
  }
  if (showTeamsTab) {
    tabItems.push({ id: "teams", label: "Teams", count: confirmedCount });
  }
  if (showPendingTab) {
    tabItems.push({
      id: "pending",
      label: isOrganizer ? "Pending" : "Your application",
      badge: isOrganizer ? pendingCount : myPendingCount,
    });
  }
  if (showPoolPlayTab) tabItems.push({ id: "pool-play", label: "Pools" });
  if (showBracketTab) tabItems.push({ id: "bracket", label: "Bracket" });
  if (showMatchesTab) tabItems.push({ id: "matches", label: "Matches" });

  const tabGroups = buildTournamentTabGroups(tabItems);

  const checklist = isOrganizer
    ? hostChecklistSteps({
        status: tournament.status,
        description: tournament.description,
        address: tournament.address,
        playFormat: tournament.playFormat ?? "pool_to_bracket",
        divisionCount,
        courtCount,
        registrationCount,
        pendingCount,
        matchFormat: tournament.matchFormat,
        setStartingScore: tournament.setStartingScore,
        setTargetScore: tournament.setTargetScore,
        tiebreakTargetScore: tournament.tiebreakTargetScore,
        warmupFormat: tournament.warmupFormat,
        poolTiebreakCriteria: tournament.poolTiebreakCriteria,
        poolSettingsSavedAt: tournament.poolSettingsSavedAt,
        bracketCount: tournament.bracketCount ?? 1,
        goldTeamCount: tournament.goldTeamCount,
        silverTeamCount: tournament.silverTeamCount,
        bracketSettingsSavedAt: tournament.bracketSettingsSavedAt,
        hasPools: playSignals.hasPoolMatches,
        hasPoolsReleased: hasReleasedPoolPlay,
        hasSeededBrackets: playSignals.hasSeededBrackets,
        hasScheduledMatches,
      })
    : [];

  const emptySetup = divisionCount === 0 && courtCount === 0;

  return (
    <div className={emptySetup ? "space-y-3 pb-6" : "space-y-6 pb-6"}>
      <MatchRealtimeRefresh tournamentId={id} />
      <BackLink href="/tournaments">All tournaments</BackLink>

      {isOrganizer ? (
        <TournamentPageHeading
          tournamentId={tournament.id}
          initialSlug={tournament.slug}
          initialName={tournament.name}
          description={tournament.description}
          location={tournament.location}
          address={tournament.address}
          date={tournament.date}
          gender={tournament.gender}
          region={tournament.region}
          organizerName={organizer?.fullName ?? "Unknown organizer"}
          status={tournament.status}
          showRegisterLink={showRegisterLink}
          hostChecklistSteps={checklist}
          hostSchool={hostSchool}
          hasScheduledMatches={hasScheduledMatches}
          compact={emptySetup}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
                {tournament.name}
              </h1>
              <StatusBadge
                kind="tournament"
                status={tournament.status}
                date={tournament.date}
                className="shrink-0"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              <TournamentLocationLink
                location={tournament.location}
                address={tournament.address}
              />
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatTournamentDateDisplay(tournament.date)}
              </span>
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {organizer?.fullName ?? "Unknown organizer"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <TeamAttributesBadges
                gender={tournament.gender}
                region={tournament.region}
              />
              <TournamentHostSchoolLink school={hostSchool} />
            </div>
            {tournament.description && (
              <p className="max-w-2xl whitespace-pre-wrap text-pretty text-sm text-muted-foreground">
                {tournament.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {canDownloadPacket && !isOrganizer && (
              <Link
                href={`/tournaments/${tournament.slug}/packet`}
                className={buttonVariants({
                  variant: "outline",
                  className: "inline-flex items-center gap-2",
                })}
              >
                <Download className="h-4 w-4" />
                Tournament packet
              </Link>
            )}
            {showRegisterLink && (
              <Link
                href={`/tournaments/${tournament.slug}/register`}
                className={buttonVariants({ className: "w-full sm:w-auto" })}
              >
                Register Team
              </Link>
            )}
            <Link
              href={`/tournaments/${tournament.slug}/scoring`}
              className={buttonVariants({ variant: "outline" })}
            >
              Live Scoring
            </Link>
          </div>
        </div>
      )}

      {isOrganizer && showChatTab && tournament.status === "in_progress" ? (
        <TournamentChatNotifier tournamentId={id} />
      ) : null}

      <TournamentTabs
        slug={tournament.slug}
        activeTab={activeTab}
        groups={tabGroups}
      />

      <Suspense key={activeTab} fallback={<TournamentPanelSkeleton />}>
        <TournamentActivePanel
          activeTab={activeTab}
          tournament={tournament}
          user={user}
          canEditSetup={canEditSetup}
          preparationLockedReason={preparationLockedReason}
          myTeamIds={myTeamIds}
          captainTeamIds={captainTeamIds}
          isOrganizer={isOrganizer}
          showPacketTab={showPacketTab}
          showWaiverTab={showWaiverTab}
          showPaymentTab={showPaymentTab}
          showChatTab={showChatTab}
          showTeamsTab={showTeamsTab}
          showPendingTab={showPendingTab}
          showPoolPlayTab={showPoolPlayTab}
          showBracketTab={showBracketTab}
          showMatchesTab={showMatchesTab}
          divisionId={sp.division ?? null}
          focusPoolId={sp.pool ?? null}
        />
      </Suspense>
    </div>
  );
}
