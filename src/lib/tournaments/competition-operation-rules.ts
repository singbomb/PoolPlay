/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { RegistrationStatus } from "@/types";

export class OperationConflictError extends Error {
  readonly currentRevision: number | null;

  constructor(message: string, currentRevision: number | null = null) {
    super(message);
    this.name = "OperationConflictError";
    this.currentRevision = currentRevision;
  }
}

export class OperationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationValidationError";
  }
}

export function assertExpectedRevision(
  currentRevision: number,
  expectedRevision: number
): void {
  if (currentRevision !== expectedRevision) {
    throw new OperationConflictError(
      "This record changed on another device. Refresh and try again.",
      currentRevision
    );
  }
}

export function assertParticipantWinner(
  winnerId: string | null,
  teamAId: string | null,
  teamBId: string | null,
  allowTie: boolean
): void {
  if (!teamAId || !teamBId) {
    throw new OperationValidationError(
      "Both teams must be assigned before recording a result."
    );
  }

  if (winnerId === null) {
    if (!allowTie) {
      throw new OperationValidationError(
        "This match format requires a winning team."
      );
    }
    return;
  }

  if (winnerId !== teamAId && winnerId !== teamBId) {
    throw new OperationValidationError(
      "The winner must be one of the teams in this match."
    );
  }
}

const REGISTRATION_TRANSITIONS: Record<
  RegistrationStatus,
  readonly RegistrationStatus[]
> = {
  pending: ["pending", "confirmed"],
  confirmed: ["pending", "confirmed", "checked_in"],
  checked_in: ["confirmed", "checked_in"],
};

export function canTransitionRegistrationStatus(
  fromStatus: RegistrationStatus,
  toStatus: RegistrationStatus
): boolean {
  return REGISTRATION_TRANSITIONS[fromStatus].includes(toStatus);
}
