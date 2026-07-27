export type BracketSection = "main" | "winners" | "losers" | "grand_final";

interface BracketRoundLabelInput {
  section: BracketSection;
  round: number;
  maxRound?: number;
}

interface BracketRulesSummaryInput {
  playFormat: string;
  bracketCount: number;
  goldTeamCount: number | null;
  silverTeamCount: number | null;
}

function eliminationRoundLabel(round: number, maxRound?: number): string {
  if (maxRound == null) return `Round ${round}`;
  if (round === maxRound) return "Final";
  if (round === maxRound - 1) return "Semifinals";
  if (round === maxRound - 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function formatBracketRoundLabel({
  section,
  round,
  maxRound,
}: BracketRoundLabelInput): string {
  if (section === "grand_final") {
    return round === 1 ? "Grand Final" : "Reset Final";
  }

  const roundLabel = eliminationRoundLabel(round, maxRound);
  if (section === "winners") return `Winners ${roundLabel}`;
  if (section === "losers") return `Losers ${roundLabel}`;
  return roundLabel;
}

export function formatBracketRulesSummary({
  playFormat,
  bracketCount,
  goldTeamCount,
  silverTeamCount,
}: BracketRulesSummaryInput): string {
  if (playFormat === "double_elimination") {
    return "Double elimination bracket. A team is eliminated after two losses. Sets start at 0–0.";
  }
  if (playFormat === "single_elimination") {
    return "Single elimination bracket. One loss eliminates a team. Sets start at 0–0.";
  }
  if (bracketCount <= 1) {
    return "Single elimination bracket (all pools combine). Sets start at 0–0.";
  }
  if (bracketCount === 2) {
    return `Gold (${goldTeamCount ?? "?"} teams) and Silver (remainder) brackets. All pools combine. Sets start at 0–0.`;
  }
  return `Gold (${goldTeamCount ?? "?"}), Silver (${silverTeamCount ?? "?"}), and Bronze (remainder) brackets. All pools combine. Sets start at 0–0.`;
}
