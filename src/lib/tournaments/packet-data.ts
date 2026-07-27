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

import { db } from "@/lib/db";
import {
  brackets,
  courts,
  divisions,
  matches,
  pools,
  registrations,
  teams,
  tournaments,
  users,
} from "@/lib/db/schema";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { TEAM_GENDER_LABELS, TEAM_REGION_LABELS } from "@/lib/constants/team";
import {
  formatMatchFormatLabel,
  type MatchFormat,
} from "@/lib/labels/match-format";
import { formatPlayFormatLabel } from "@/lib/labels/play-format";
import {
  formatPoolTiebreakCriterionLabel,
  type PoolTiebreakCriterion,
} from "@/lib/labels/pool-tiebreak";
import { formatWarmupFormatLabel } from "@/lib/labels/warmup-format";
import { formatTournamentDateDisplay } from "@/lib/date-iso";
import { getHostSchoolById } from "@/lib/tournaments/host-school";
import {
  formatBracketRoundLabel,
  formatBracketRulesSummary,
  type BracketSection,
} from "@/lib/tournaments/bracket-labels";
import { isActiveMatch } from "@/lib/tournaments/match-visibility";
import { matchFormatForMatch } from "@/lib/tournaments/match-format";
import {
  paymentInstructionsText,
  paymentSettingsFromTournament,
} from "@/lib/tournaments/payment-settings";
import { warmupMinutesForFormat } from "@/lib/labels/warmup-format";
import { format } from "date-fns";

export type PacketRegisteredTeam = {
  name: string;
};

export type PacketScheduleRow = {
  scheduledTime: Date;
  warmupTime: Date | null;
  courtName: string | null;
  teamAName: string;
  teamBName: string;
  roundLabel: string;
};

export type PacketData = {
  generatedAt: Date;
  liveUrl: string;
  name: string;
  date: string;
  dateDisplay: string;
  location: string;
  address: string | null;
  description: string | null;
  packetNotes: string | null;
  paymentInstructions: string | null;
  genderLabel: string;
  regionLabel: string;
  hostSchoolName: string | null;
  organizerName: string;
  registeredTeams: PacketRegisteredTeam[];
  playFormatLabel: string;
  hasPoolPlay: boolean;
  poolRules: {
    matchFormat: string;
    matchFormatLabel: string;
    setStartingScore: number;
    setTargetScore: number;
    tiebreakTargetScore: number;
    warmupFormatLabel: string;
    tiebreakCriteria: string[];
  };
  bracketRules: {
    summary: string;
    bracketCount: number;
    matchFormat: MatchFormat;
    matchFormatLabel: string;
    setStartingScore: number;
    setTargetScore: number;
    tiebreakTargetScore: number;
  } | null;
  schedule: PacketScheduleRow[];
};

const PACKET_REGISTRATION_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
] as const;

function tournamentLiveUrl(slug: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${base}/tournaments/${slug}`;
}

const packetPoolDivision = alias(divisions, "packet_pool_division");
const packetBracketDivision = alias(divisions, "packet_bracket_division");

export function packetScheduleMatchIsVisible(
  match: {
    poolReleasedAt: Date | null;
    bracketReleasedAt: Date | null;
  },
  includeUnreleased: boolean
): boolean {
  return (
    includeUnreleased ||
    match.poolReleasedAt != null ||
    match.bracketReleasedAt != null
  );
}

export async function gatherPacketData(
  tournamentId: string,
  options?: { includeUnreleased?: boolean }
): Promise<PacketData | null> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) return null;

  const [organizer, hostSchool, registrationRows, rawScheduledMatchRows] =
    await Promise.all([
      db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, tournament.organizerId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      getHostSchoolById(tournament.hostSchoolId),
      db
        .select({
          teamName: teams.name,
        })
        .from(registrations)
        .innerJoin(teams, eq(registrations.teamId, teams.id))
        .where(
          and(
            eq(registrations.tournamentId, tournamentId),
            inArray(registrations.status, [...PACKET_REGISTRATION_STATUSES])
          )
        )
        .orderBy(asc(teams.name)),
      db
        .select({
          scheduledTime: matches.scheduledTime,
          status: matches.status,
          bracketActivation: matches.bracketActivation,
          bracketSection: matches.bracketSection,
          bracketRound: matches.bracketRound,
          bracketId: matches.bracketId,
          poolId: matches.poolId,
          teamAId: matches.teamAId,
          teamBId: matches.teamBId,
          courtId: matches.courtId,
          poolReleasedAt: packetPoolDivision.poolsReleasedAt,
          bracketReleasedAt: packetBracketDivision.poolsReleasedAt,
        })
        .from(matches)
        .leftJoin(pools, eq(matches.poolId, pools.id))
        .leftJoin(
          packetPoolDivision,
          eq(pools.divisionId, packetPoolDivision.id)
        )
        .leftJoin(brackets, eq(matches.bracketId, brackets.id))
        .leftJoin(
          packetBracketDivision,
          eq(brackets.divisionId, packetBracketDivision.id)
        )
        .where(
          and(
            eq(matches.tournamentId, tournamentId),
            isNotNull(matches.scheduledTime)
          )
        )
        .orderBy(asc(matches.scheduledTime)),
    ]);

  const scheduledMatchRows = rawScheduledMatchRows
    .filter(isActiveMatch)
    .filter((match) =>
      packetScheduleMatchIsVisible(
        match,
        options?.includeUnreleased === true
      )
    );

  const teamIds = [
    ...new Set(
      scheduledMatchRows
        .flatMap((m) => [m.teamAId, m.teamBId])
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const courtIds = [
    ...new Set(
      scheduledMatchRows
        .map((m) => m.courtId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const poolIds = [
    ...new Set(
      scheduledMatchRows
        .map((m) => m.poolId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const bracketIds = [
    ...new Set(
      scheduledMatchRows
        .map((m) => m.bracketId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [teamRows, courtRows, poolRows, bracketRows, bracketMaxRounds] =
    await Promise.all([
      teamIds.length
        ? db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(inArray(teams.id, teamIds))
        : Promise.resolve([]),
      courtIds.length
        ? db
            .select({ id: courts.id, name: courts.name })
            .from(courts)
            .where(inArray(courts.id, courtIds))
        : Promise.resolve([]),
      poolIds.length
        ? db
            .select({ id: pools.id, name: pools.name })
            .from(pools)
            .where(inArray(pools.id, poolIds))
        : Promise.resolve([]),
      bracketIds.length
        ? db
            .select({ id: brackets.id, name: brackets.name })
            .from(brackets)
            .where(inArray(brackets.id, bracketIds))
        : Promise.resolve([]),
      bracketIds.length
        ? db
            .select({
              bracketId: matches.bracketId,
              bracketSection: matches.bracketSection,
              maxRound: matches.bracketRound,
            })
            .from(matches)
            .where(
              and(
                eq(matches.tournamentId, tournamentId),
                inArray(matches.bracketId, bracketIds)
              )
            )
        : Promise.resolve([]),
    ]);

  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
  const courtNameById = new Map(courtRows.map((c) => [c.id, c.name]));
  const poolNameById = new Map(poolRows.map((p) => [p.id, p.name]));
  const bracketNameById = new Map(
    bracketRows.map((b) => [b.id, b.name ?? "Bracket"])
  );

  const maxRoundByBracketSection = new Map<string, number>();
  for (const row of bracketMaxRounds) {
    if (!row.bracketId || !row.bracketSection || row.maxRound == null) continue;
    const key = `${row.bracketId}:${row.bracketSection}`;
    const prev = maxRoundByBracketSection.get(key) ?? 0;
    if (row.maxRound > prev) {
      maxRoundByBracketSection.set(key, row.maxRound);
    }
  }

  const warmupMinutes = warmupMinutesForFormat(tournament.warmupFormat);

  const schedule: PacketScheduleRow[] = scheduledMatchRows
    .filter((m): m is typeof m & { scheduledTime: Date } =>
      Boolean(m.scheduledTime)
    )
    .map((m) => {
      let roundLabel = "Match";
      if (m.poolId) {
        roundLabel = poolNameById.get(m.poolId) ?? "Pool";
      } else if (m.bracketId && m.bracketRound != null) {
        const section = (m.bracketSection ?? "main") as BracketSection;
        const maxRound =
          maxRoundByBracketSection.get(`${m.bracketId}:${section}`) ??
          m.bracketRound;
        const bracketName = bracketNameById.get(m.bracketId);
        roundLabel = `${bracketName} · ${formatBracketRoundLabel({
          section,
          round: m.bracketRound,
          maxRound,
        })}`;
      }

      const teamAName = m.teamAId
        ? (teamNameById.get(m.teamAId) ?? "TBD")
        : "TBD";
      const teamBName = m.teamBId
        ? (teamNameById.get(m.teamBId) ?? "TBD")
        : "TBD";

      const warmupTime =
        warmupMinutes > 0
          ? new Date(
              m.scheduledTime.getTime() - warmupMinutes * 60 * 1000
            )
          : null;

      return {
        scheduledTime: m.scheduledTime,
        warmupTime,
        courtName: m.courtId
          ? (courtNameById.get(m.courtId) ?? null)
          : null,
        teamAName,
        teamBName,
        roundLabel,
      };
    });

  const playFormat = tournament.playFormat ?? "pool_to_bracket";
  const hasBracketPlay =
    playFormat === "pool_to_bracket" ||
    playFormat === "single_elimination" ||
    playFormat === "double_elimination";
  const bracketMatchFormat = matchFormatForMatch(tournament.matchFormat, {
    bracketId: "bracket",
  });

  const tiebreakCriteria = (tournament.poolTiebreakCriteria ?? []).map((c) =>
    formatPoolTiebreakCriterionLabel(c as PoolTiebreakCriterion)
  );

  return {
    generatedAt: new Date(),
    liveUrl: tournamentLiveUrl(tournament.slug),
    name: tournament.name,
    date: tournament.date,
    dateDisplay: formatTournamentDateDisplay(tournament.date),
    location: tournament.location,
    address: tournament.address,
    description: tournament.description,
    packetNotes: tournament.packetNotes,
    paymentInstructions: paymentInstructionsText(
      paymentSettingsFromTournament(tournament)
    ),
    genderLabel:
      TEAM_GENDER_LABELS[
        tournament.gender as keyof typeof TEAM_GENDER_LABELS
      ] ?? tournament.gender,
    regionLabel:
      TEAM_REGION_LABELS[
        tournament.region as keyof typeof TEAM_REGION_LABELS
      ] ?? tournament.region,
    hostSchoolName: hostSchool?.name ?? null,
    organizerName: organizer?.fullName ?? "Tournament host",
    registeredTeams: registrationRows.map((r) => ({
      name: r.teamName,
    })),
    playFormatLabel: formatPlayFormatLabel(playFormat),
    hasPoolPlay: playFormat === "pool_to_bracket",
    poolRules: {
      matchFormat: tournament.matchFormat,
      matchFormatLabel: formatMatchFormatLabel(tournament.matchFormat),
      setStartingScore: tournament.setStartingScore,
      setTargetScore: tournament.setTargetScore,
      tiebreakTargetScore: tournament.tiebreakTargetScore,
      warmupFormatLabel: formatWarmupFormatLabel(tournament.warmupFormat),
      tiebreakCriteria,
    },
    bracketRules: hasBracketPlay
      ? {
          summary: formatBracketRulesSummary({
            playFormat,
            bracketCount: tournament.bracketCount ?? 1,
            goldTeamCount: tournament.goldTeamCount,
            silverTeamCount: tournament.silverTeamCount,
          }),
          bracketCount: tournament.bracketCount ?? 1,
          matchFormat: bracketMatchFormat,
          matchFormatLabel: formatMatchFormatLabel(bracketMatchFormat),
          setStartingScore: tournament.bracketSetStartingScore,
          setTargetScore: tournament.setTargetScore,
          tiebreakTargetScore: tournament.tiebreakTargetScore,
        }
      : null,
    schedule,
  };
}

/** Format a schedule row time for the PDF. */
export function formatPacketTime(date: Date): string {
  return format(date, "h:mm a");
}

/** Format generated timestamp for the PDF footer. */
export function formatPacketGeneratedAt(date: Date): string {
  return format(date, "MMM d, yyyy 'at' h:mm a");
}
