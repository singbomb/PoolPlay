interface MatchContestState {
  bracketId: string | null;
  bracketActivation: "required" | "conditional" | "not_required" | null;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
}

/** Pool matches and required bracket paths belong on operational schedules. */
export function isActiveMatch(match: MatchContestState): boolean {
  if (!match.bracketId) return true;
  if (match.bracketActivation !== "required") return false;

  const participantCount =
    Number(match.teamAId !== null) + Number(match.teamBId !== null);
  return !(match.status === "completed" && participantCount === 1);
}

/** Pool matches and fully assigned, active bracket matches are real contests. */
export function isPlayableMatch(match: MatchContestState): boolean {
  return (
    isActiveMatch(match) &&
    (!match.bracketId ||
      (match.teamAId !== null && match.teamBId !== null))
  );
}
