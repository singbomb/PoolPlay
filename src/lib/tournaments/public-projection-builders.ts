/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { formatBracketRoundLabel } from "./bracket-labels";
import { isActiveMatch } from "./match-visibility";
import { calculatePoolStandings } from "@/lib/utils/pool";
import type {
  BracketSection,
  PublicBracketMatchView,
  PublicBracketView,
  PublicMatchView,
  PublicPoolStanding,
  PublicPoolView,
  PublicScoreSet,
  PublicSourceMatch,
  PublicTournamentProjection,
  PublicTournamentProjectionSource,
  WinnerSide,
} from "./public-projection";

type DivisionRow = PublicTournamentProjectionSource["divisions"][number];
type PoolRow = PublicTournamentProjectionSource["pools"][number];
type BracketRow = PublicTournamentProjectionSource["brackets"][number];
type MembershipRow = PublicTournamentProjectionSource["poolTeams"][number];

interface ProjectionContext {
  teamById: Map<
    string,
    PublicTournamentProjectionSource["teams"][number]
  >;
  courtById: Map<string, string>;
  setsByMatchId: Map<string, PublicScoreSet[]>;
}

function buildSetIndex(
  source: PublicTournamentProjectionSource
): Map<string, PublicScoreSet[]> {
  const setsByMatchId = new Map<string, PublicScoreSet[]>();
  for (const set of [...source.sets].sort(
    (a, b) => a.setNumber - b.setNumber
  )) {
    const matchSets = setsByMatchId.get(set.matchId) ?? [];
    matchSets.push({
      teamAScore: set.teamAScore,
      teamBScore: set.teamBScore,
    });
    setsByMatchId.set(set.matchId, matchSets);
  }
  return setsByMatchId;
}

function buildProjectionContext(
  source: PublicTournamentProjectionSource
): ProjectionContext {
  return {
    teamById: new Map(source.teams.map((team) => [team.id, team])),
    courtById: new Map(
      source.courts.map((court) => [court.id, court.name])
    ),
    setsByMatchId: buildSetIndex(source),
  };
}

function winnerSide(match: PublicSourceMatch): WinnerSide {
  if (!match.winnerId) return null;
  if (match.winnerId === match.teamAId) return "a";
  if (match.winnerId === match.teamBId) return "b";
  return null;
}

function teamName(
  teamId: string | null,
  context: ProjectionContext
): string | null {
  return teamId ? (context.teamById.get(teamId)?.name ?? null) : null;
}

function courtName(
  courtId: string | null,
  context: ProjectionContext
): string | null {
  return courtId ? (context.courtById.get(courtId) ?? null) : null;
}

function asIsoString(value: Date | string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function toPublicMatch(
  match: PublicSourceMatch,
  kind: PublicMatchView["kind"],
  label: string,
  context: ProjectionContext
): PublicMatchView {
  return {
    key: match.slug,
    kind,
    context: label,
    teamAName: teamName(match.teamAId, context),
    teamBName: teamName(match.teamBId, context),
    winner: winnerSide(match),
    status: match.status,
    scheduledTime: asIsoString(match.scheduledTime),
    courtName: courtName(match.courtId, context),
    sets: context.setsByMatchId.get(match.id) ?? [],
  };
}

function poolStandings(
  source: PublicTournamentProjectionSource,
  membership: MembershipRow[],
  poolMatches: PublicSourceMatch[],
  context: ProjectionContext
): PublicPoolStanding[] {
  const standings = calculatePoolStandings(
    membership.map((row) => row.teamId),
    poolMatches.flatMap((match) =>
      match.teamAId && match.teamBId
        ? [
            {
              teamAId: match.teamAId,
              teamBId: match.teamBId,
              winnerId: match.winnerId,
              sets: context.setsByMatchId.get(match.id) ?? [],
            },
          ]
        : []
    ),
    { criteria: source.tournament.poolTiebreakCriteria }
  );
  return standings.map((standing, index) => {
    const team = context.teamById.get(standing.teamId);
    return {
      rank: index + 1,
      teamName: team?.name ?? "TBD",
      university: team?.university ?? "",
      wins: standing.wins,
      losses: standing.losses,
      setsWon: standing.setsWon,
      setsLost: standing.setsLost,
      pointDiff: standing.pointDiff,
    };
  });
}

function publicPoolTeams(
  membership: MembershipRow[],
  context: ProjectionContext
): PublicPoolView["teams"] {
  return membership.map((row) => {
    const team = context.teamById.get(row.teamId);
    return {
      name: team?.name ?? "TBD",
      university: team?.university ?? "",
      seed: row.seed,
    };
  });
}

function buildPublicPool(
  source: PublicTournamentProjectionSource,
  division: DivisionRow,
  pool: PoolRow,
  context: ProjectionContext,
  schedule: PublicMatchView[]
): PublicPoolView {
  const membership = source.poolTeams
    .filter((row) => row.poolId === pool.id)
    .sort(
      (a, b) =>
        (a.seed ?? Number.MAX_SAFE_INTEGER) -
        (b.seed ?? Number.MAX_SAFE_INTEGER)
    );
  const poolMatches = source.matches.filter(
    (match) => match.poolId === pool.id
  );
  const matches = poolMatches.map((match) =>
    toPublicMatch(match, "pool", `${division.name} · ${pool.name}`, context)
  );
  schedule.push(...matches);
  return {
    name: pool.name,
    teams: publicPoolTeams(membership, context),
    standings: poolStandings(source, membership, poolMatches, context),
    matches,
  };
}

function bracketMatchOrder(
  a: PublicSourceMatch,
  b: PublicSourceMatch
): number {
  const sectionOrder = ["main", "winners", "losers", "grand_final"];
  const sectionDifference =
    sectionOrder.indexOf(a.bracketSection ?? "main") -
    sectionOrder.indexOf(b.bracketSection ?? "main");
  if (sectionDifference !== 0) return sectionDifference;
  const roundDifference = (a.bracketRound ?? 0) - (b.bracketRound ?? 0);
  if (roundDifference !== 0) return roundDifference;
  return (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0);
}

function maxRoundsBySection(
  matches: PublicSourceMatch[]
): Map<BracketSection, number> {
  const result = new Map<BracketSection, number>();
  for (const match of matches) {
    if (!match.bracketSection || !match.bracketRound) continue;
    result.set(
      match.bracketSection,
      Math.max(result.get(match.bracketSection) ?? 0, match.bracketRound)
    );
  }
  return result;
}

function toPublicBracketMatch(
  match: PublicSourceMatch,
  context: ProjectionContext
): PublicBracketMatchView {
  return {
    key: match.slug,
    teamAName: teamName(match.teamAId, context),
    teamBName: teamName(match.teamBId, context),
    winner: winnerSide(match),
    status: match.status,
    activation: match.bracketActivation ?? "required",
    scheduledTime: asIsoString(match.scheduledTime),
    courtName: courtName(match.courtId, context),
    sets: context.setsByMatchId.get(match.id) ?? [],
  };
}

function isPublicScheduleMatch(
  bracketId: string,
  match: PublicSourceMatch
): boolean {
  return isActiveMatch({
    bracketId,
    bracketActivation: match.bracketActivation,
    status: match.status,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
  });
}

function buildBracketRounds(
  division: DivisionRow,
  bracket: BracketRow,
  bracketMatches: PublicSourceMatch[],
  context: ProjectionContext,
  schedule: PublicMatchView[]
): PublicBracketView["rounds"] {
  const maxRounds = maxRoundsBySection(bracketMatches);
  const rounds = new Map<string, PublicBracketView["rounds"][number]>();
  for (const match of [...bracketMatches].sort(bracketMatchOrder)) {
    const section = match.bracketSection ?? "main";
    const round = match.bracketRound ?? 1;
    const key = `${section}-${round}`;
    const publicRound = rounds.get(key) ?? {
      key,
      label: formatBracketRoundLabel({
        section,
        round,
        maxRound: maxRounds.get(section),
      }),
      section,
      matches: [],
    };
    publicRound.matches.push(toPublicBracketMatch(match, context));
    rounds.set(key, publicRound);
    if (isPublicScheduleMatch(bracket.id, match)) {
      schedule.push(
        toPublicMatch(
          match,
          "bracket",
          `${division.name} · ${publicRound.label}`,
          context
        )
      );
    }
  }
  return [...rounds.values()];
}

function buildPublicBracket(
  source: PublicTournamentProjectionSource,
  division: DivisionRow,
  bracket: BracketRow,
  context: ProjectionContext,
  schedule: PublicMatchView[]
): PublicBracketView {
  const bracketMatches = source.matches.filter(
    (match) => match.bracketId === bracket.id
  );
  return {
    name: bracket.name ?? "Bracket",
    bracketType: bracket.bracketType,
    seedCount: bracket.seedCount,
    tier: bracket.tier,
    rounds: buildBracketRounds(
      division,
      bracket,
      bracketMatches,
      context,
      schedule
    ),
  };
}

function buildPublicDivision(
  source: PublicTournamentProjectionSource,
  division: DivisionRow,
  context: ProjectionContext,
  schedule: PublicMatchView[]
): PublicTournamentProjection["divisions"][number] {
  const pools = source.pools
    .filter((pool) => pool.divisionId === division.id)
    .map((pool) => buildPublicPool(source, division, pool, context, schedule));
  const brackets = source.brackets
    .filter((bracket) => bracket.divisionId === division.id)
    .sort((a, b) => a.tier - b.tier)
    .map((bracket) =>
      buildPublicBracket(source, division, bracket, context, schedule)
    );
  return { name: division.name, format: division.format, pools, brackets };
}

function statusRank(status: string): number {
  if (status === "in_progress") return 0;
  if (status === "upcoming") return 1;
  if (status === "completed") return 2;
  return 3;
}

function comparePublicMatches(
  a: PublicMatchView,
  b: PublicMatchView
): number {
  const statusDifference = statusRank(a.status) - statusRank(b.status);
  if (statusDifference !== 0) return statusDifference;
  if (a.scheduledTime == null) return b.scheduledTime == null ? 0 : 1;
  if (b.scheduledTime == null) return -1;
  return a.scheduledTime.localeCompare(b.scheduledTime);
}

export function buildReleasedProjection(
  source: PublicTournamentProjectionSource
): Pick<PublicTournamentProjection, "schedule" | "divisions"> {
  const context = buildProjectionContext(source);
  const schedule: PublicMatchView[] = [];
  const divisions = source.divisions
    .filter((division) => division.poolsReleasedAt != null)
    .map((division) =>
      buildPublicDivision(source, division, context, schedule)
    );
  schedule.sort(comparePublicMatches);
  return { schedule, divisions };
}
