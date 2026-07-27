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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import Link from "next/link";
import {
  ArrowUpRight,
  CircleDashed,
  GitBranch,
  RotateCcw,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { MatchFormat } from "@/lib/labels/match-format";
import { buildMatchScoreState } from "@/lib/tournaments/match-format";
import { cn } from "@/lib/utils";
import type { DivisionPlayData } from "./data";

type Bracket = DivisionPlayData["brackets"][number];
type BracketMatch = Bracket["matches"][number];
type BracketSection = BracketMatch["bracketSection"];
interface SectionDefinition {
  section: BracketSection;
  title: string;
  description: string;
}
interface BracketScoreSettings {
  format: MatchFormat;
  targetScore: number;
  tiebreakTargetScore: number;
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    section: "winners",
    title: "Winners bracket",
    description: "Teams stay here until their first loss.",
  },
  {
    section: "losers",
    title: "Losers bracket",
    description: "One more loss eliminates a team.",
  },
];

function compareMatches(a: BracketMatch, b: BracketMatch): number {
  const roundDifference = (a.bracketRound ?? 0) - (b.bracketRound ?? 0);
  if (roundDifference !== 0) return roundDifference;
  return (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0);
}

function groupMatchesByRound(
  matches: BracketMatch[]
): Array<[number, BracketMatch[]]> {
  const rounds = new Map<number, BracketMatch[]>();
  for (const match of [...matches].sort(compareMatches)) {
    const round = match.bracketRound ?? 1;
    const roundMatches = rounds.get(round) ?? [];
    roundMatches.push(match);
    rounds.set(round, roundMatches);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b);
}

function winnerName(match: BracketMatch | null): string | null {
  if (!match || match.status !== "completed" || !match.winnerId) return null;
  if (match.winnerId === match.teamAId)
    return match.teamAName ?? match.teamA?.name ?? "Team";
  if (match.winnerId === match.teamBId)
    return match.teamBName ?? match.teamB?.name ?? "Team";
  return null;
}
function championshipMatch(
  firstFinal: BracketMatch | null,
  resetFinal: BracketMatch | null
): BracketMatch | null {
  if (!resetFinal) return firstFinal;
  if (resetFinal.bracketActivation === "required") return resetFinal;
  if (resetFinal.bracketActivation === "not_required") return firstFinal;
  return null;
}

export function DoubleEliminationBracketView({
  bracket,
  slug,
  scoreSettings,
}: {
  bracket: Bracket;
  slug: string;
  scoreSettings: BracketScoreSettings;
}) {
  const matchesBySection = new Map<BracketSection, BracketMatch[]>();
  for (const match of bracket.matches) {
    const sectionMatches = matchesBySection.get(match.bracketSection) ?? [];
    sectionMatches.push(match);
    matchesBySection.set(match.bracketSection, sectionMatches);
  }

  const winnersMatches = matchesBySection.get("winners")?.length
    ? (matchesBySection.get("winners") ?? [])
    : (matchesBySection.get("main") ?? []);
  const championshipMatches = [
    ...(matchesBySection.get("grand_final") ?? []),
  ].sort(compareMatches);
  const firstFinal =
    championshipMatches.find((match) => match.bracketRound === 1) ??
    championshipMatches[0] ??
    null;
  const resetFinal =
    championshipMatches.find((match) => match.bracketRound === 2) ??
    championshipMatches[1] ??
    null;
  const champion = winnerName(championshipMatch(firstFinal, resetFinal));

  const title = bracket.name ? `${bracket.name} Bracket` : "Double Elimination";

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/40 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.5)] dark:shadow-[inset_0_1px_0_0_oklch(1_0_0/0.06)]">
      <header className="border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          <GitBranch className="size-3.5" aria-hidden />
          Double elimination · {bracket.seedCount} teams
        </div>
        <h3 className="font-heading text-lg font-semibold tracking-tight">
          {title}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          A team is eliminated after two losses. Follow each bracket separately,
          then see both finalists meet for the championship.
        </p>
      </header>

      <div className="space-y-7 p-4 sm:p-6">
        {SECTION_DEFINITIONS.map((definition) => {
          const sectionMatches =
            definition.section === "winners"
              ? winnersMatches
              : (matchesBySection.get(definition.section) ?? []);

          return (
            <BracketSectionView
              key={definition.section}
              headingId={`${bracket.id}-${definition.section}-bracket-heading`}
              definition={definition}
              matches={sectionMatches}
              slug={slug}
              scoreSettings={scoreSettings}
            />
          );
        })}

        <ChampionshipSection
          headingId={`${bracket.id}-championship-bracket-heading`}
          matches={championshipMatches}
          slug={slug}
          champion={champion}
          scoreSettings={scoreSettings}
        />
      </div>
    </section>
  );
}

function BracketSectionView({
  headingId,
  definition,
  matches,
  slug,
  scoreSettings,
}: {
  headingId: string;
  definition: SectionDefinition;
  matches: BracketMatch[];
  slug: string;
  scoreSettings: BracketScoreSettings;
}) {
  const rounds = groupMatchesByRound(matches);
  const isWinners = definition.section === "winners";

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={definition.title}
        description={definition.description}
        icon={isWinners ? ShieldCheck : RotateCcw}
        tone={isWinners ? "primary" : "warning"}
      />
      {rounds.length > 0 ? (
        <RoundColumns
          rounds={rounds}
          slug={slug}
          section={definition.section}
          scoreSettings={scoreSettings}
        />
      ) : (
        <EmptySection message="This section has not been generated yet." />
      )}
    </section>
  );
}

function ChampionshipSection({
  headingId,
  matches,
  slug,
  champion,
  scoreSettings,
}: {
  headingId: string;
  matches: BracketMatch[];
  slug: string;
  champion: string | null;
  scoreSettings: BracketScoreSettings;
}) {
  const rounds = groupMatchesByRound(matches);

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title="Championship"
        description="The winners- and losers-bracket finalists meet here."
        icon={Trophy}
        tone="championship"
      />
      {rounds.length > 0 ? (
        <RoundColumns
          rounds={rounds}
          slug={slug}
          section="grand_final"
          scoreSettings={scoreSettings}
        />
      ) : (
        <EmptySection message="The championship matches have not been generated yet." />
      )}
      {champion && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/8 px-4 py-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Trophy className="size-4" aria-hidden />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              Bracket champion
            </p>
            <p className="font-heading text-base font-bold">{champion}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function SectionHeading({
  id,
  title,
  description,
  icon: Icon,
  tone,
}: {
  id: string;
  title: string;
  description: string;
  icon: typeof Trophy;
  tone: "primary" | "warning" | "championship";
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md border",
          tone === "primary" &&
            "border-primary/25 bg-primary/10 text-primary",
          tone === "warning" &&
            "border-warning/25 bg-warning/10 text-warning",
          tone === "championship" &&
            "border-foreground/15 bg-foreground text-background"
        )}
      >
        <Icon className="size-4" aria-hidden />
      </div>
      <div>
        <h4 id={id} className="font-heading text-sm font-bold tracking-tight">
          {title}
        </h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function RoundColumns({
  rounds,
  slug,
  section,
  scoreSettings,
}: {
  rounds: Array<[number, BracketMatch[]]>;
  slug: string;
  section: BracketSection;
  scoreSettings: BracketScoreSettings;
}) {
  const maxRound = rounds.at(-1)?.[0] ?? 1;

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="grid min-w-max grid-flow-col auto-cols-[minmax(15rem,17rem)] gap-3">
        {rounds.map(([round, matches]) => (
          <div key={`${section}-${round}`} className="space-y-2">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {roundLabel(section, round, maxRound)}
              </p>
              <p className="text-[10px] tabular-nums text-muted-foreground/80">
                {matches.length} match{matches.length === 1 ? "" : "es"}
              </p>
            </div>
            <div className="space-y-2">
              {matches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  slug={slug}
                  label={matchLabel(section, round, match.bracketPosition)}
                  scoreSettings={scoreSettings}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCard({
  match,
  slug,
  label,
  scoreSettings,
}: {
  match: BracketMatch;
  slug: string;
  label: string;
  scoreSettings: BracketScoreSettings;
}) {
  const isNotRequired = match.bracketActivation === "not_required";
  const isConditional = match.bracketActivation === "conditional";
  const isGrandFinal = match.bracketSection === "grand_final";
  const hasBothTeams = Boolean(match.teamAId && match.teamBId);
  const automaticTeamName =
    match.teamAName ?? match.teamBName ?? match.teamA?.name ?? match.teamB?.name;
  const isAutomaticAdvance =
    match.bracketActivation === "required" &&
    match.status === "completed" &&
    Boolean(match.teamAId) !== Boolean(match.teamBId);
  const isLinkable = match.bracketActivation === "required" && hasBothTeams;
  const scoreState = buildMatchScoreState(scoreSettings, match.sets);

  const content = (
    <article
      className={cn(
        "rounded-lg border bg-background/85 transition-colors",
        isLinkable && "group-hover:border-primary/35 group-hover:bg-background",
        isNotRequired && "border-dashed border-border/70 bg-muted/20",
        isConditional && "border-dashed border-warning/35 bg-warning/5",
        !isNotRequired && !isConditional && "border-border/60"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isNotRequired && (
            <StatusBadge kind="match" status={match.status} />
          )}
          {isLinkable && (
            <ArrowUpRight
              className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary"
              aria-hidden
            />
          )}
        </div>
      </div>

      {isNotRequired ? (
        <MatchState
          icon={ShieldCheck}
          title={isGrandFinal ? "Reset not needed" : "Match not needed"}
          description={
            isGrandFinal
              ? "GF1 decided the champion, so this match will not be played."
              : "The available teams advanced without needing this match."
          }
        />
      ) : isConditional ? (
        <MatchState
          icon={CircleDashed}
          title={isGrandFinal ? "Reset if needed" : "Waiting on bracket results"}
          description={
            isGrandFinal
              ? "This match activates only if the losers-bracket finalist wins GF1."
              : "This match activates only if the required earlier result occurs."
          }
        />
      ) : isAutomaticAdvance ? (
        <MatchState
          icon={ShieldCheck}
          title="Advanced automatically"
          description={`${automaticTeamName ?? "The available team"} advanced because no opponent reached this match.`}
        />
      ) : (
        <div className="divide-y divide-border/50 px-3">
          <TeamLine
            name={match.teamAName}
            setsWon={scoreState.setsWonA}
            won={match.winnerId === match.teamAId && Boolean(match.teamAId)}
          />
          <TeamLine
            name={match.teamBName}
            setsWon={scoreState.setsWonB}
            won={match.winnerId === match.teamBId && Boolean(match.teamBId)}
          />
        </div>
      )}
    </article>
  );

  if (!isLinkable) return content;

  return (
    <Link
      href={`/tournaments/${slug}/matches/${match.slug}`}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Open ${label}`}
    >
      {content}
    </Link>
  );
}

function MatchState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Trophy;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-2.5 px-3 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function TeamLine({
  name,
  setsWon,
  won,
}: {
  name: string | null;
  setsWon: number;
  won: boolean;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-2">
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          won ? "font-bold text-foreground" : "font-medium",
          !name && "italic text-muted-foreground"
        )}
      >
        {name ?? "TBD"}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm font-bold tabular-nums",
          won ? "text-primary" : "text-muted-foreground"
        )}
      >
        {setsWon}
      </span>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function roundLabel(
  section: BracketSection,
  round: number,
  totalRounds: number
): string {
  if (section === "grand_final") {
    return round === 1 ? "Grand Final" : "Reset Final";
  }
  if (round === totalRounds) return "Final";
  return `Round ${round}`;
}

function matchLabel(
  section: BracketSection,
  round: number,
  position: number | null
): string {
  if (section === "grand_final") return round === 1 ? "GF1" : "GF2";
  const prefix = section === "losers" ? "L" : "W";
  return `${prefix}${round} · Match ${position ?? 1}`;
}
