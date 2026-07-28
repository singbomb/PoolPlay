"use client";

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

import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { TeamAttributesBadges } from "@/components/team-attributes-badges";
import { TournamentHostSchoolLink } from "@/components/tournament-host-school-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatISODateLabel,
  formatTournamentDateDisplay,
  parseISODate,
  toISODate,
} from "@/lib/date-iso";
import {
  TournamentListFilters,
  countActiveTournamentFilters,
} from "@/components/tournament-list-filters";
import { Calendar, MapPin, Search, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTournamentArchived, todayISO } from "@/lib/tournament-status";
import type { TeamGender, TeamRegion } from "@/types";
import type { TournamentHostSchool } from "@/lib/tournaments/host-school";

const DateScrollWheel = dynamic(
  () =>
    import("@/components/date-scroll-wheel").then((mod) => ({
      default: mod.DateScrollWheel,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-[180px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
        aria-hidden
      >
        Loading schedule…
      </div>
    ),
  }
);

const DatePickerCalendar = dynamic(
  () =>
    import("@/components/date-picker").then((mod) => ({
      default: mod.DatePickerCalendar,
    })),
  {
    loading: () => <div className="h-[280px] w-[280px]" aria-hidden />,
  }
);

/**
 * Distance from the top of the schedule container to the active date
 * heading. Leaves room for the previous day's heading to peek above
 * without crowding the top edge.
 */
const SCHEDULE_TOP_INSET = 96;

/** Min height for the selected-day panel so empty and tournament days match. */
const SELECTED_PANEL_MIN_H =
  "min-h-[5.5rem] min-w-0 w-full max-w-full";

/**
 * Accumulated wheel deltaY (px) required before moving to the next/previous
 * date. Higher = more scrolling per date, easier to land on adjacent days.
 */
const WHEEL_DELTA_PER_DATE = 120;

/** Vertical pixels of touch movement before a swipe advances the date. */
const SWIPE_THRESHOLD_PX = 56;

interface Tournament {
  slug: string;
  name: string;
  description: string | null;
  location: string;
  date: string;
  status: string;
  gender: TeamGender;
  region: TeamRegion;
  hostSchool?: TournamentHostSchool | null;
}

function toggleSetValue<T extends string>(
  set: Set<T>,
  value: T
): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatDate(dateStr: string) {
  return formatTournamentDateDisplay(dateStr, { weekday: true });
}

interface DateGroup {
  date: string;
  tournaments: Tournament[];
}

function groupByDate(list: Tournament[]): DateGroup[] {
  const map = new Map<string, Tournament[]>();
  for (const t of list) {
    const existing = map.get(t.date);
    if (existing) {
      existing.push(t);
    } else {
      map.set(t.date, [t]);
    }
  }
  return Array.from(map.entries()).map(([date, tournaments]) => ({
    date,
    tournaments,
  }));
}

function TournamentRow({
  tournament: t,
  linkPrefix,
  linkHostSchools,
}: {
  tournament: Tournament;
  linkPrefix: string;
  linkHostSchools: boolean;
}) {
  return (
    <div className="min-w-0 max-w-full px-1 py-3.5 transition-colors duration-150 hover:bg-muted/40">
      <Link href={`${linkPrefix}/${t.slug}`} className="block min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate font-medium leading-tight">
            {t.name}
          </span>
          <StatusBadge
            kind="tournament"
            status={t.status}
            date={t.date}
            className="shrink-0"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            {t.location}
          </span>
        </div>
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <TeamAttributesBadges gender={t.gender} region={t.region} />
        <TournamentHostSchoolLink
          school={t.hostSchool}
          asLink={linkHostSchools}
        />
      </div>
    </div>
  );
}

/**
 * No-scroll date cycler. Today (or a synthesized empty today group) starts
 * pinned at the top of the container. Wheel, touch, and arrow Up/Down cycle
 * through dates one at a time — there is no actual scrollbar or free
 * scrolling. The selected day's heading scales up and its tournament cards
 * expand into view; non-selected days collapse to just their heading and
 * dim, so the eye is always on the current selection.
 */
function ChronologicalSchedule({
  tournaments,
  linkPrefix,
  linkHostSchools,
  selectedDate,
  onSelectedDateChange,
}: {
  tournaments: Tournament[];
  linkPrefix: string;
  linkHostSchools: boolean;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
}) {
  const today = todayISO();

  const groups = useMemo(() => {
    const sorted = [...tournaments].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const grouped = groupByDate(sorted);

    // Always materialize today plus the active selection so empty days can
    // still be focused (e.g. from the calendar or synthesized today).
    const required = new Set<string>([today, selectedDate]);
    for (const date of required) {
      if (grouped.some((g) => g.date === date)) continue;
      const insertAt = grouped.findIndex((g) => g.date > date);
      const empty: DateGroup = { date, tournaments: [] };
      if (insertAt === -1) grouped.push(empty);
      else grouped.splice(insertAt, 0, empty);
    }

    return grouped;
  }, [tournaments, today, selectedDate]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const layoutInitializedRef = useRef(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [wheelActivity, setWheelActivity] = useState(0);
  const registerWheelActivity = useCallback(() => {
    setWheelActivity((n) => n + 1);
  }, []);

  // If the selected date disappears (filter, day rollover) fall back to
  // today — which is always present because we synthesize it above.
  const effectiveSelectedDate = useMemo(() => {
    if (groups.some((g) => g.date === selectedDate)) return selectedDate;
    return today;
  }, [groups, selectedDate, today]);

  const selectedGroupTournamentCount =
    groups.find((g) => g.date === effectiveSelectedDate)?.tournaments.length ?? 0;

  /**
   * Moves the stack so the selected section's heading sits at the top
   * inset. First call sets the position without animation so today doesn't
   * "fly in" from the top on mount; subsequent calls animate smoothly.
   */
  useLayoutEffect(() => {
    const stack = stackRef.current;
    const el = sectionRefs.current.get(effectiveSelectedDate);
    if (!stack || !el) return;
    const offset = SCHEDULE_TOP_INSET - el.offsetTop;

    if (!layoutInitializedRef.current) {
      stack.style.transition = "none";
      stack.style.transform = `translateY(${offset}px)`;
      void stack.offsetHeight;
      stack.style.transition =
        "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";
      layoutInitializedRef.current = true;
      queueMicrotask(() => setLayoutReady(true));
    } else {
      stack.style.transform = `translateY(${offset}px)`;
    }
  }, [effectiveSelectedDate, groups, selectedGroupTournamentCount]);

  // Wheel + touch cycle through dates. The container does not scroll —
  // wheel events are intercepted and turned into one-step date advances.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function advance(delta: number) {
      registerWheelActivity();
      const i = groups.findIndex((g) => g.date === selectedDate);
      const safeI =
        i === -1 ? groups.findIndex((g) => g.date === today) : i;
      const next = Math.max(
        0,
        Math.min(groups.length - 1, safeI + delta)
      );
      const nextDate = groups[next]?.date;
      if (nextDate) onSelectedDateChange(nextDate);
    }

    let wheelAccumulator = 0;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 1) return;
      wheelAccumulator += e.deltaY;

      while (wheelAccumulator >= WHEEL_DELTA_PER_DATE) {
        advance(1);
        wheelAccumulator -= WHEEL_DELTA_PER_DATE;
      }
      while (wheelAccumulator <= -WHEEL_DELTA_PER_DATE) {
        advance(-1);
        wheelAccumulator += WHEEL_DELTA_PER_DATE;
      }
    }

    let touchY = 0;
    let touchAccumulator = 0;
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        touchY = e.touches[0].clientY;
        touchAccumulator = 0;
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      touchAccumulator += touchY - y;
      touchY = y;

      while (touchAccumulator >= SWIPE_THRESHOLD_PX) {
        e.preventDefault();
        advance(1);
        touchAccumulator -= SWIPE_THRESHOLD_PX;
      }
      while (touchAccumulator <= -SWIPE_THRESHOLD_PX) {
        e.preventDefault();
        advance(-1);
        touchAccumulator += SWIPE_THRESHOLD_PX;
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [groups, today, selectedDate, onSelectedDateChange, registerWheelActivity]);

  // Arrow Up/Down moves the selected date by one. Ignored while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      registerWheelActivity();
      // Drop focus so the calendar trigger (or other controls) don't keep
      // showing a focus ring while cycling dates with the keyboard.
      if (target && target !== document.body) {
        target.blur();
      }
      const i = groups.findIndex((g) => g.date === selectedDate);
      const safeI =
        i === -1 ? groups.findIndex((g) => g.date === today) : i;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(
        0,
        Math.min(groups.length - 1, safeI + delta)
      );
      const nextDate = groups[next]?.date;
      if (nextDate) onSelectedDateChange(nextDate);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, today, selectedDate, onSelectedDateChange, registerWheelActivity]);

  if (groups.length === 0) return null;

  const scheduleDates = groups.map((g) => g.date);

  return (
    <div
      className="flex min-h-0 w-full min-w-0 flex-1 gap-3 overflow-x-hidden sm:gap-4"
      style={{ visibility: layoutReady ? "visible" : "hidden" }}
    >
      <div
        ref={containerRef}
        className="relative min-h-0 min-w-0 flex-1 select-none overflow-hidden outline-none"
        aria-roledescription="date cycler"
      >
        <div ref={stackRef} className="will-change-transform">
          <div className="space-y-3 pb-12 pt-2">
          {groups.map((group) => {
            const isSelected = group.date === effectiveSelectedDate;
            const isCalendarToday = group.date === today;
            const isEmpty = group.tournaments.length === 0;
            return (
              <section
                key={group.date}
                ref={(el) => {
                  if (el) sectionRefs.current.set(group.date, el);
                  else sectionRefs.current.delete(group.date);
                }}
                className={cn(
                  "min-w-0 transition-opacity duration-300",
                  isSelected ? "opacity-100" : "opacity-40"
                )}
              >
                <h3
                  className={cn(
                    "flex min-h-9 min-w-0 items-center gap-2 truncate text-sm transition-colors duration-300",
                    isSelected
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground"
                  )}
                >
                  {isCalendarToday && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                        isSelected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      Today
                    </span>
                  )}
                  <span className="truncate">{formatDate(group.date)}</span>
                </h3>
                {isSelected && (
                  <div
                    className={cn(
                      "mt-2 w-full min-w-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200",
                      SELECTED_PANEL_MIN_H
                    )}
                  >
                    {isEmpty ? (
                      <p
                        className={cn(
                          "flex w-full items-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 text-sm text-muted-foreground",
                          SELECTED_PANEL_MIN_H
                        )}
                      >
                        No tournaments scheduled.
                      </p>
                    ) : (
                      <div className={cn("list-stack w-full border-t border-border/70", SELECTED_PANEL_MIN_H)}>
                        {group.tournaments.map((t) => (
                          <TournamentRow
                            key={t.slug}
                            tournament={t}
                            linkPrefix={linkPrefix}
                            linkHostSchools={linkHostSchools}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          </div>
        </div>
      </div>

      <aside
        aria-label="Date navigation"
        className="flex w-[9.5rem] shrink-0 flex-none flex-col justify-center self-stretch"
      >
        <DateScrollWheel
          className="w-full -translate-y-6"
          dates={scheduleDates}
          selectedDate={effectiveSelectedDate}
          onSelect={onSelectedDateChange}
          today={today}
          activityKey={wheelActivity}
        />
      </aside>
    </div>
  );
}

export function TournamentGrid({
  tournaments,
  linkPrefix = "/tournaments",
  linkHostSchools = true,
}: {
  tournaments: Tournament[];
  linkPrefix?: string;
  linkHostSchools?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState<Set<TeamGender>>(
    () => new Set()
  );
  const [regionFilter, setRegionFilter] = useState<Set<TeamRegion>>(
    () => new Set()
  );
  const [hideArchived, setHideArchived] = useState(false);
  const [registrationOpenOnly, setRegistrationOpenOnly] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const today = todayISO();

  useEffect(() => {
    setSelectedDate(today);
  }, [today]);

  const hasActiveFilters =
    countActiveTournamentFilters({
      genderFilter,
      regionFilter,
      hideArchived,
      registrationOpenOnly,
    }) > 0;

  const filtered = useMemo(() => {
    let list = tournaments;

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.location.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }

    if (hideArchived) {
      list = list.filter((t) => !isTournamentArchived(t.date, today));
    }

    if (registrationOpenOnly) {
      list = list.filter(
        (t) =>
          t.status === "registration_open" &&
          !isTournamentArchived(t.date, today)
      );
    }

    if (genderFilter.size > 0) {
      list = list.filter((t) => genderFilter.has(t.gender));
    }

    if (regionFilter.size > 0) {
      list = list.filter((t) => regionFilter.has(t.region));
    }

    return list;
  }, [
    tournaments,
    query,
    hideArchived,
    registrationOpenOnly,
    genderFilter,
    regionFilter,
    today,
  ]);

  /** Dates (YYYY-MM-DD) that actually have tournaments — used to dot the calendar. */
  const datesWithTournaments = useMemo(() => {
    const set = new Set<string>();
    for (const t of filtered) set.add(t.date);
    return set;
  }, [filtered]);

  const hasTournamentDates = useMemo(
    () =>
      Array.from(datesWithTournaments).map((iso) => parseISODate(iso)),
    [datesWithTournaments]
  );

  const tournamentDateIsos = useMemo(
    () => tournaments.map((t) => t.date),
    [tournaments]
  );

  useEffect(() => {
    if (!calendarOpen) return;
    setCalendarMonth(parseISODate(selectedDate));
  }, [calendarOpen, selectedDate]);

  function handleDateSelect(date: Date | undefined) {
    if (!date) return;
    const iso = toISODate(date);
    setSelectedDate(iso);
    setCalendarOpen(false);
    // Return focus to the page so the trigger doesn't keep a focus ring.
    requestAnimationFrame(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });

    if (!datesWithTournaments.has(iso)) {
      const label = date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      toast(`No tournaments on ${label}.`, {
        description: "Try another date from the calendar.",
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tournaments..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 rounded-md pl-9 shadow-sm"
          />
        </div>

        <TournamentListFilters
          genderFilter={genderFilter}
          regionFilter={regionFilter}
          hideArchived={hideArchived}
          registrationOpenOnly={registrationOpenOnly}
          onToggleGender={(value) =>
            setGenderFilter((prev) => toggleSetValue(prev, value))
          }
          onToggleRegion={(value) =>
            setRegionFilter((prev) => toggleSetValue(prev, value))
          }
          onHideArchivedChange={setHideArchived}
          onRegistrationOpenOnlyChange={setRegistrationOpenOnly}
          onClear={() => {
            setGenderFilter(new Set());
            setRegionFilter(new Set());
            setHideArchived(false);
            setRegistrationOpenOnly(false);
          }}
        />

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  "shrink-0",
                  selectedDate !== today && "bg-muted"
                )}
                aria-label={`Calendar, ${formatISODateLabel(selectedDate)} selected`}
              >
                <Calendar className="h-4 w-4" />
              </Button>
            }
          />
          <PopoverContent className="w-auto p-1.5" align="end">
            <DatePickerCalendar
              selected={parseISODate(selectedDate)}
              onSelect={handleDateSelect}
              rangeFromDates={tournamentDateIsos}
              markedDates={hasTournamentDates}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={
            tournaments.length === 0
              ? "No tournaments yet"
              : "No matches"
          }
          description={
            tournaments.length === 0
              ? "Check back soon for upcoming events."
              : query.trim() && hasActiveFilters
                ? `Nothing matches "${query}" with the selected filters.`
                : query.trim()
                  ? `Nothing matches "${query}". Try a different search.`
                  : hasActiveFilters
                    ? "No tournaments match your filters. Try clearing filters or showing past events."
                    : "Check back soon for upcoming events."
          }
        />
      ) : (
        <ChronologicalSchedule
          tournaments={filtered}
          linkPrefix={linkPrefix}
          linkHostSchools={linkHostSchools}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
        />
      )}
    </div>
  );
}
