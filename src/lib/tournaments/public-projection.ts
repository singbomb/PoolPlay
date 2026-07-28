/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { MatchFormat } from "@/lib/labels/match-format";
import type {
  SchoolVerificationStatus,
  TeamGender,
  TeamRegion,
} from "@/types";
import { buildReleasedProjection } from "./public-projection-builders";

export { buildPublicTournamentListProjection } from "./public-list-projection";

export type PoolTiebreakCriterion =
  | "match_record"
  | "set_record"
  | "point_diff"
  | "head_to_head";
export type BracketSection = "main" | "winners" | "losers" | "grand_final";
export type BracketActivation = "required" | "conditional" | "not_required";
export type WinnerSide = "a" | "b" | null;

export interface PublicSourceTournament {
  id: string;
  hostSchoolId: string | null;
  slug: string;
  name: string;
  description: string | null;
  date: string;
  location: string;
  address: string | null;
  status: string;
  gender: TeamGender;
  region: TeamRegion;
  matchFormat: MatchFormat;
  setTargetScore: number;
  tiebreakTargetScore: number;
  poolTiebreakCriteria: PoolTiebreakCriterion[];
}

export interface PublicSourceMatch {
  id: string;
  slug: string;
  poolId: string | null;
  bracketId: string | null;
  courtId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  status: string;
  scheduledTime: Date | string | null;
  bracketSection: BracketSection | null;
  bracketActivation: BracketActivation | null;
  bracketRound: number | null;
  bracketPosition: number | null;
}

export interface PublicScoreSet {
  teamAScore: number;
  teamBScore: number;
}

export interface PublicTournamentProjectionSource {
  tournament: PublicSourceTournament;
  hostSchool: {
    name: string;
    slug: string;
    verificationStatus: SchoolVerificationStatus;
  } | null;
  divisions: Array<{
    id: string;
    name: string;
    format: string;
    poolsReleasedAt: Date | string | null;
  }>;
  pools: Array<{ id: string; divisionId: string; name: string }>;
  poolTeams: Array<{
    poolId: string;
    teamId: string;
    seed: number | null;
  }>;
  brackets: Array<{
    id: string;
    divisionId: string;
    bracketType: string;
    seedCount: number;
    name: string | null;
    tier: number;
  }>;
  matches: PublicSourceMatch[];
  teams: Array<{ id: string; name: string; university: string }>;
  courts: Array<{ id: string; name: string }>;
  sets: Array<PublicScoreSet & { matchId: string; setNumber: number }>;
}

export interface PublicMatchView {
  key: string;
  kind: "pool" | "bracket";
  context: string;
  teamAName: string | null;
  teamBName: string | null;
  winner: WinnerSide;
  status: string;
  scheduledTime: string | null;
  courtName: string | null;
  sets: PublicScoreSet[];
}

export interface PublicPoolStanding {
  rank: number;
  teamName: string;
  university: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointDiff: number;
}

export interface PublicPoolView {
  name: string;
  teams: Array<{ name: string; university: string; seed: number | null }>;
  standings: PublicPoolStanding[];
  matches: PublicMatchView[];
}

export interface PublicBracketMatchView {
  key: string;
  teamAName: string | null;
  teamBName: string | null;
  winner: WinnerSide;
  status: string;
  activation: BracketActivation;
  scheduledTime: string | null;
  courtName: string | null;
  sets: PublicScoreSet[];
}

export interface PublicBracketView {
  name: string;
  bracketType: string;
  seedCount: number;
  tier: number;
  rounds: Array<{
    key: string;
    label: string;
    section: BracketSection;
    matches: PublicBracketMatchView[];
  }>;
}

export interface PublicTournamentProjection {
  tournament: {
    slug: string;
    name: string;
    description: string | null;
    date: string;
    location: string;
    address: string | null;
    status: string;
    gender: TeamGender;
    region: TeamRegion;
    matchFormat: MatchFormat;
    setTargetScore: number;
    tiebreakTargetScore: number;
    hostSchool: PublicTournamentProjectionSource["hostSchool"];
  };
  summary: {
    releasedDivisions: number;
    pools: number;
    brackets: number;
    matches: number;
    liveMatches: number;
  };
  schedule: PublicMatchView[];
  divisions: Array<{
    name: string;
    format: string;
    pools: PublicPoolView[];
    brackets: PublicBracketView[];
  }>;
}

function publicTournamentHeader(
  source: PublicTournamentProjectionSource
): PublicTournamentProjection["tournament"] {
  const tournament = source.tournament;
  const hostSchool = source.hostSchool
    ? {
        name: source.hostSchool.name,
        slug: source.hostSchool.slug,
        verificationStatus: source.hostSchool.verificationStatus,
      }
    : null;
  return {
    slug: tournament.slug,
    name: tournament.name,
    description: tournament.description,
    date: tournament.date,
    location: tournament.location,
    address: tournament.address,
    status: tournament.status,
    gender: tournament.gender,
    region: tournament.region,
    matchFormat: tournament.matchFormat,
    setTargetScore: tournament.setTargetScore,
    tiebreakTargetScore: tournament.tiebreakTargetScore,
    hostSchool,
  };
}

function publicSummary(
  schedule: PublicMatchView[],
  divisions: PublicTournamentProjection["divisions"]
): PublicTournamentProjection["summary"] {
  return {
    releasedDivisions: divisions.length,
    pools: divisions.reduce(
      (total, division) => total + division.pools.length,
      0
    ),
    brackets: divisions.reduce(
      (total, division) => total + division.brackets.length,
      0
    ),
    matches: schedule.length,
    liveMatches: schedule.filter((match) => match.status === "in_progress")
      .length,
  };
}

/**
 * Converts released operational rows into the only shape a public page may
 * serialize. Internal identifiers are used only while joining the rows.
 */
export function buildPublicTournamentProjection(
  source: PublicTournamentProjectionSource
): PublicTournamentProjection | null {
  if (source.tournament.status === "draft") return null;
  const { schedule, divisions } = buildReleasedProjection(source);
  return {
    tournament: publicTournamentHeader(source),
    summary: publicSummary(schedule, divisions),
    schedule,
    divisions,
  };
}
