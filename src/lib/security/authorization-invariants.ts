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

const AUTHORIZATION_DENIED_MESSAGE = "Resource not found or access denied";

type ResourceParentInput = {
  childParentId: string | null | undefined;
  authorizedParentId: string;
};

type MatchTournamentInput = {
  matchTournamentId: string | null | undefined;
  authorizedTournamentId: string;
};

type ScheduledCourtInput = {
  matchTournamentId: string;
  courtTournamentId: string | null | undefined;
};

type TeamSchoolAttachmentInput = {
  canManageTeam: boolean;
  canManageSchool: boolean;
};

function assertMatchingNonEmptyIds(
  actualId: string | null | undefined,
  expectedId: string
): void {
  if (!actualId || !expectedId || actualId !== expectedId) {
    throw new Error(AUTHORIZATION_DENIED_MESSAGE);
  }
}

export function assertChildBelongsToAuthorizedParent(
  input: ResourceParentInput
): void {
  assertMatchingNonEmptyIds(input.childParentId, input.authorizedParentId);
}

export function assertMatchBelongsToAuthorizedTournament(
  input: MatchTournamentInput
): void {
  assertMatchingNonEmptyIds(
    input.matchTournamentId,
    input.authorizedTournamentId
  );
}

export function assertScheduledCourtBelongsToMatchTournament(
  input: ScheduledCourtInput
): void {
  if (input.courtTournamentId == null) return;
  assertMatchingNonEmptyIds(
    input.courtTournamentId,
    input.matchTournamentId
  );
}

export function assertTeamSchoolAttachmentAuthorized(
  input: TeamSchoolAttachmentInput
): void {
  if (!input.canManageTeam || !input.canManageSchool) {
    throw new Error(AUTHORIZATION_DENIED_MESSAGE);
  }
}
