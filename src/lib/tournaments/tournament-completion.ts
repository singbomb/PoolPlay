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
  divisions,
  matches,
  registrations,
  tournaments,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type DbClient = typeof db;

export type BracketMatchSnapshot = {
  bracketRound: number | null;
  bracketSection?: string | null;
  bracketActivation?: string | null;
  status: string;
  winnerId: string | null;
  teamAId: string | null;
  teamBId: string | null;
};

export type BracketCompletionSnapshot = {
  bracketType: string;
  divisionId: string;
  seedCount: number;
  matches: BracketMatchSnapshot[];
};

type StraightDivisionRoster = {
  id: string;
  name: string;
  teamIds: Set<string>;
};

/** True when the bracket has at least one team placed in any match. */
export function bracketIsActive(matches: BracketMatchSnapshot[]): boolean {
  return matches.some((m) => m.teamAId != null || m.teamBId != null);
}

function matchHasWinner(match: BracketMatchSnapshot | undefined): boolean {
  return Boolean(
    match &&
      match.status === "completed" &&
      match.winnerId &&
      (match.teamAId || match.teamBId)
  );
}

function doubleEliminationHasChampion(
  matches: BracketMatchSnapshot[]
): boolean {
  const grandFinal = matches.find(
    (match) =>
      match.bracketSection === "grand_final" && match.bracketRound === 1
  );
  const resetFinal = matches.find(
    (match) =>
      match.bracketSection === "grand_final" && match.bracketRound === 2
  );

  if (!grandFinal || !resetFinal) return false;
  if (resetFinal.bracketActivation === "required") {
    return matchHasWinner(resetFinal);
  }
  if (resetFinal.bracketActivation === "not_required") {
    return matchHasWinner(grandFinal);
  }
  return false;
}

/** True when the bracket's championship path is complete. */
export function bracketHasChampion(
  matches: BracketMatchSnapshot[],
  bracketType = "single_elimination"
): boolean {
  if (matches.length === 0) return false;
  if (bracketType === "double_elimination") {
    return doubleEliminationHasChampion(matches);
  }

  const maxRound = Math.max(...matches.map((m) => m.bracketRound ?? 0));
  if (maxRound < 1) return false;

  const finals = matches.filter((m) => m.bracketRound === maxRound);
  return finals.some(matchHasWinner);
}

/** Every seeded bracket must have a completed final with a winner. */
export function allActiveBracketsHaveChampions(
  bracketsWithMatches: {
    bracketType?: string;
    matches: BracketMatchSnapshot[];
  }[]
): boolean {
  const active = bracketsWithMatches.filter((b) => bracketIsActive(b.matches));
  if (active.length === 0) return false;
  return active.every((b) =>
    bracketHasChampion(b.matches, b.bracketType)
  );
}

export function allCompetitionDivisionsHaveChampions(
  bracketsWithMatches: BracketCompletionSnapshot[],
  requiredStraightDivisionIds: ReadonlySet<string>
): boolean {
  if (!allActiveBracketsHaveChampions(bracketsWithMatches)) return false;
  for (const divisionId of requiredStraightDivisionIds) {
    const divisionBrackets = bracketsWithMatches.filter(
      (bracket) => bracket.divisionId === divisionId
    );
    if (
      !divisionBrackets.some(
        (bracket) =>
          bracketIsActive(bracket.matches) &&
          bracketHasChampion(bracket.matches, bracket.bracketType)
      )
    ) {
      return false;
    }
  }
  return true;
}

export function bracketMatchesCurrentRoster(
  bracket: BracketCompletionSnapshot,
  currentTeamIds: ReadonlySet<string>
): boolean {
  if (
    currentTeamIds.size < 2 ||
    bracket.seedCount !== currentTeamIds.size ||
    !bracketIsActive(bracket.matches)
  ) {
    return false;
  }
  const bracketTeamIds = new Set<string>();
  for (const match of bracket.matches) {
    if (match.teamAId) bracketTeamIds.add(match.teamAId);
    if (match.teamBId) bracketTeamIds.add(match.teamBId);
  }
  return (
    bracketTeamIds.size === currentTeamIds.size &&
    [...currentTeamIds].every((teamId) => bracketTeamIds.has(teamId))
  );
}

export function allActiveBracketsMatchCurrentRoster(
  divisionBrackets: BracketCompletionSnapshot[],
  currentTeamIds: ReadonlySet<string>
): boolean {
  const active = divisionBrackets.filter((bracket) =>
    bracketIsActive(bracket.matches)
  );
  return (
    active.length > 0 &&
    active.every((bracket) =>
      bracketMatchesCurrentRoster(bracket, currentTeamIds)
    )
  );
}

async function loadBracketSnapshots(
  tournamentId: string,
  client: DbClient
): Promise<BracketCompletionSnapshot[]> {
  const rows = await client
    .select({
      matchId: matches.id,
      bracketId: brackets.id,
      bracketType: brackets.bracketType,
      divisionId: brackets.divisionId,
      seedCount: brackets.seedCount,
      bracketRound: matches.bracketRound,
      bracketSection: matches.bracketSection,
      bracketActivation: matches.bracketActivation,
      status: matches.status,
      winnerId: matches.winnerId,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
    })
    .from(brackets)
    .innerJoin(divisions, eq(brackets.divisionId, divisions.id))
    .leftJoin(matches, eq(matches.bracketId, brackets.id))
    .where(eq(divisions.tournamentId, tournamentId));

  const byBracket = new Map<string, BracketCompletionSnapshot>();
  for (const row of rows) {
    const entry = byBracket.get(row.bracketId) ?? {
      bracketType: row.bracketType,
      divisionId: row.divisionId,
      seedCount: row.seedCount,
      matches: [],
    };
    if (row.matchId) {
      entry.matches.push({
        bracketRound: row.bracketRound,
        bracketSection: row.bracketSection,
        bracketActivation: row.bracketActivation,
        status: row.status!,
        winnerId: row.winnerId,
        teamAId: row.teamAId,
        teamBId: row.teamBId,
      });
    }
    byBracket.set(row.bracketId, entry);
  }

  return [...byBracket.values()];
}

async function loadStraightDivisionRosters(
  tournamentId: string,
  client: DbClient
): Promise<StraightDivisionRoster[]> {
  const divisionRows = await client
    .select({ id: divisions.id, name: divisions.name })
    .from(divisions)
    .where(
      and(
        eq(divisions.tournamentId, tournamentId),
        inArray(divisions.format, [
          "single_elimination",
          "double_elimination",
        ])
      )
    );
  if (divisionRows.length === 0) return [];

  const divisionIds = divisionRows.map((division) => division.id);
  const registrationRows = await client
    .select({
      divisionId: registrations.divisionId,
      teamId: registrations.teamId,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        inArray(registrations.divisionId, divisionIds),
        inArray(registrations.status, ["confirmed", "checked_in"])
      )
    );

  const teamIdsByDivision = new Map<string, Set<string>>();
  const addTeam = (divisionId: string | null, teamId: string) => {
    if (!divisionId) return;
    const ids = teamIdsByDivision.get(divisionId) ?? new Set<string>();
    ids.add(teamId);
    teamIdsByDivision.set(divisionId, ids);
  };
  for (const row of registrationRows) addTeam(row.divisionId, row.teamId);

  return divisionRows.map((division) => ({
    ...division,
    teamIds: teamIdsByDivision.get(division.id) ?? new Set<string>(),
  }));
}

function divisionHasCurrentSeededBracket(
  division: StraightDivisionRoster,
  snapshots: BracketCompletionSnapshot[]
): boolean {
  return allActiveBracketsMatchCurrentRoster(
    snapshots.filter((bracket) => bracket.divisionId === division.id),
    division.teamIds
  );
}

function divisionRequiresCurrentBracket(
  division: StraightDivisionRoster,
  snapshots: BracketCompletionSnapshot[]
): boolean {
  return (
    division.teamIds.size >= 2 ||
    snapshots.some(
      (bracket) =>
        bracket.divisionId === division.id &&
        bracketIsActive(bracket.matches)
    )
  );
}

export async function straightEliminationDivisionsMissingSeeds(
  tournamentId: string,
  client: DbClient = db
): Promise<string[]> {
  const [requiredDivisions, snapshots] = await Promise.all([
    loadStraightDivisionRosters(tournamentId, client),
    loadBracketSnapshots(tournamentId, client),
  ]);
  return requiredDivisions
    .filter(
      (division) =>
        divisionRequiresCurrentBracket(division, snapshots) &&
        !divisionHasCurrentSeededBracket(division, snapshots)
    )
    .map((division) => division.name);
}

export async function straightEliminationDivisionHasCurrentSeededBracket(
  tournamentId: string,
  divisionId: string,
  client: DbClient = db
): Promise<boolean> {
  const [requiredDivisions, snapshots] = await Promise.all([
    loadStraightDivisionRosters(tournamentId, client),
    loadBracketSnapshots(tournamentId, client),
  ]);
  const division = requiredDivisions.find(
    (candidate) => candidate.id === divisionId
  );
  return division
    ? divisionHasCurrentSeededBracket(division, snapshots)
    : false;
}

export async function straightEliminationDivisionsMissingChampions(
  tournamentId: string,
  client: DbClient = db
): Promise<string[]> {
  const [requiredDivisions, snapshots] = await Promise.all([
    loadStraightDivisionRosters(tournamentId, client),
    loadBracketSnapshots(tournamentId, client),
  ]);
  return requiredDivisions
    .filter(
      (division) =>
        divisionRequiresCurrentBracket(division, snapshots) &&
        (!divisionHasCurrentSeededBracket(division, snapshots) ||
          !snapshots.some(
            (bracket) =>
              bracket.divisionId === division.id &&
              bracketMatchesCurrentRoster(bracket, division.teamIds) &&
              bracketHasChampion(bracket.matches, bracket.bracketType)
          ))
    )
    .map((division) => division.name);
}

export async function tournamentHasIncompleteActiveBrackets(
  tournamentId: string,
  client: DbClient = db
): Promise<boolean> {
  const snapshots = await loadBracketSnapshots(tournamentId, client);
  const active = snapshots.filter((bracket) =>
    bracketIsActive(bracket.matches)
  );
  return active.some(
    (bracket) =>
      !bracketHasChampion(bracket.matches, bracket.bracketType)
  );
}

/**
 * Marks the tournament completed when every seeded bracket has a finished final
 * with a winner. No-op if the event is not in progress or brackets are unfinished.
 */
export async function tryCompleteTournamentWhenBracketsDone(
  tournamentId: string,
  client: DbClient = db
): Promise<boolean> {
  const [tournament] = await client
    .select({ status: tournaments.status })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || tournament.status !== "in_progress") return false;

  const [snapshots, requiredDivisions] = await Promise.all([
    loadBracketSnapshots(tournamentId, client),
    loadStraightDivisionRosters(tournamentId, client),
  ]);
  const competitionDivisions = requiredDivisions.filter(
    (division) => division.teamIds.size >= 2
  );
  const requiredIds = new Set(
    competitionDivisions.map((division) => division.id)
  );
  if (
    requiredDivisions.some(
      (division) =>
        divisionRequiresCurrentBracket(division, snapshots) &&
        !divisionHasCurrentSeededBracket(division, snapshots)
    )
  ) {
    return false;
  }
  if (!allCompetitionDivisionsHaveChampions(snapshots, requiredIds)) {
    return false;
  }

  await client
    .update(tournaments)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  return true;
}

/**
 * Reverts a completed tournament to in progress when a bracket final is reopened
 * or corrected and champions are no longer all decided.
 */
export async function revertTournamentIfBracketsIncomplete(
  tournamentId: string,
  client: DbClient = db
): Promise<boolean> {
  const [tournament] = await client
    .select({ status: tournaments.status })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || tournament.status !== "completed") return false;

  const [snapshots, requiredDivisions] = await Promise.all([
    loadBracketSnapshots(tournamentId, client),
    loadStraightDivisionRosters(tournamentId, client),
  ]);
  const competitionDivisions = requiredDivisions.filter(
    (division) => division.teamIds.size >= 2
  );
  const requiredIds = new Set(
    competitionDivisions.map((division) => division.id)
  );
  const hasCurrentBrackets = requiredDivisions.every(
    (division) =>
      !divisionRequiresCurrentBracket(division, snapshots) ||
      divisionHasCurrentSeededBracket(division, snapshots)
  );
  if (
    hasCurrentBrackets &&
    allCompetitionDivisionsHaveChampions(snapshots, requiredIds)
  ) {
    return false;
  }

  await client
    .update(tournaments)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  return true;
}
