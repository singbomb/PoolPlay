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

import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  isTournamentArchived,
  tournamentStatusLabel,
} from "@/lib/tournament-status";
import { formatRegistrationStatusLabel } from "@/lib/labels/registration";
import { formatMatchStatusLabel } from "@/lib/labels/match";

/** School and team verification share the same enum + labels. */
const VERIFICATION_LABELS: Record<string, string> = {
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
};

/**
 * Single source of truth for status pills across the app. Tournament and
 * registration lifecycle states map to a small, consistent tone vocabulary so
 * "registration open" and "completed" never look alike. Tone is conveyed by
 * color + label (and a pulse dot on truly-live states), never color alone.
 */

type Tone =
  | "neutral"
  | "archived"
  | "success"
  | "warning"
  | "info"
  | "live"
  | "destructive";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  archived:
    "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  info: "border-info/25 bg-info/10 text-info",
  live: "border-live/30 bg-live/10 text-live",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
};

function tournamentTone(status: string, archived: boolean): Tone {
  if (archived) return "archived";
  switch (status) {
    case "registration_open":
      return "success";
    case "registration_closed":
      return "warning";
    case "in_progress":
      return "live";
    case "completed":
      return "info";
    case "draft":
    default:
      return "neutral";
  }
}

function registrationTone(status: string): Tone {
  switch (status) {
    case "confirmed":
      return "success";
    case "checked_in":
      return "live";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

function matchTone(status: string): Tone {
  switch (status) {
    case "in_progress":
      return "live";
    case "completed":
      return "info";
    case "paused":
      return "warning";
    case "upcoming":
    default:
      return "neutral";
  }
}

function verificationTone(status: string): Tone {
  switch (status) {
    case "verified":
      return "success";
    case "rejected":
      return "destructive";
    case "pending":
    default:
      return "warning";
  }
}

/** Pulsing dot that inherits the badge's text color, gated on reduced motion. */
function LiveDot() {
  return (
    <span className="relative flex size-1.5 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
  );
}

interface StatusBadgeProps {
  /** Which lifecycle the status belongs to. */
  kind: "tournament" | "registration" | "match" | "verification";
  status: string;
  /** Tournament date (YYYY-MM-DD) — required for `tournament` to derive "archived". */
  date?: string;
  /** Explicit lifecycle result for callers that already resolved the viewer date. */
  archived?: boolean;
  className?: string;
}

export function StatusBadge({
  kind,
  status,
  date,
  archived: archivedOverride,
  className,
}: StatusBadgeProps) {
  const archived =
    kind === "tournament"
      ? (archivedOverride ?? (date ? isTournamentArchived(date) : false))
      : false;

  let tone: Tone;
  let label: string;
  switch (kind) {
    case "tournament":
      tone = tournamentTone(status, archived);
      label = archived ? "Archived" : tournamentStatusLabel(status);
      break;
    case "registration":
      tone = registrationTone(status);
      label = formatRegistrationStatusLabel(status);
      break;
    case "match":
      tone = matchTone(status);
      label = formatMatchStatusLabel(status);
      break;
    case "verification":
      tone = verificationTone(status);
      label = VERIFICATION_LABELS[status] ?? status;
      break;
  }

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", TONE_CLASSES[tone], className)}
    >
      {tone === "live" && <LiveDot />}
      {kind === "verification" && status === "verified" && (
        <CheckCircle2 className="size-3" aria-hidden />
      )}
      {label}
    </Badge>
  );
}
