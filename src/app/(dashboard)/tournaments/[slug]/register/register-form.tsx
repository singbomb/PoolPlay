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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getAddableTeamsForSchool, registerTeams } from "./actions";

type RegisterTeam = {
  id: string;
  name: string;
  university: string;
  schoolId: string | null;
  schoolName: string | null;
};

type SchoolOption = {
  id: string;
  name: string;
  university: string;
};

type TeamGroup = {
  key: string;
  label: string;
  teams: RegisterTeam[];
};

type RegistrationOperation = {
  selectionKey: string;
  operationId: string;
};

interface Props {
  tournamentId: string;
  tournamentSlug: string;
  teams: RegisterTeam[];
  asHost?: boolean;
  hostSchool?: { id: string; name: string } | null;
  schools?: SchoolOption[];
}

function teamLabel(team: { name: string; university: string }) {
  return `${team.name} (${team.university})`;
}

function groupTeamsBySchool(teams: RegisterTeam[]): TeamGroup[] {
  const bySchool = new Map<string, TeamGroup>();
  const independent: RegisterTeam[] = [];

  for (const team of teams) {
    if (team.schoolId && team.schoolName) {
      let group = bySchool.get(team.schoolId);
      if (!group) {
        group = { key: team.schoolId, label: team.schoolName, teams: [] };
        bySchool.set(team.schoolId, group);
      }
      group.teams.push(team);
    } else {
      independent.push(team);
    }
  }

  const groups = [...bySchool.values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
  for (const group of groups) {
    group.teams.sort((a, b) => a.name.localeCompare(b.name));
  }
  independent.sort((a, b) => a.name.localeCompare(b.name));
  if (independent.length > 0) {
    groups.push({
      key: "__independent__",
      label: "Independent teams",
      teams: independent,
    });
  }
  return groups;
}

function registrationOperationForSelection(
  current: RegistrationOperation | null,
  teamIds: Iterable<string>
): RegistrationOperation {
  const selectionKey = [...teamIds].sort().join(",");
  if (current?.selectionKey === selectionKey) return current;
  return { selectionKey, operationId: crypto.randomUUID() };
}

function useDismissOnOutsideClick(
  containerRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, open, onClose]);
}

function HostRegisterForm({
  tournamentId,
  tournamentSlug,
  schools,
  hostSchool,
  initialTeams,
}: {
  tournamentId: string;
  tournamentSlug: string;
  schools: SchoolOption[];
  hostSchool: { id: string; name: string } | null;
  initialTeams: RegisterTeam[];
}) {
  const router = useRouter();
  const schoolContainerRef = useRef<HTMLDivElement>(null);
  const schoolListRef = useRef<HTMLDivElement>(null);
  const teamsContainerRef = useRef<HTMLDivElement>(null);

  const defaultSchoolId = hostSchool?.id ?? schools[0]?.id ?? null;

  const [schoolOpen, setSchoolOpen] = useState(false);
  const [schoolFilter, setSchoolFilter] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(
    defaultSchoolId
  );
  const [schoolTeams, setSchoolTeams] = useState<RegisterTeam[]>(initialTeams);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const registrationOperationRef = useRef<RegistrationOperation | null>(null);

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId) ?? null;

  const jumpIndex = useMemo(() => {
    const q = schoolFilter.trim().toLowerCase();
    if (!q) return -1;
    const idx = schools.findIndex((s) => s.name.toLowerCase().startsWith(q));
    return idx;
  }, [schoolFilter, schools]);

  const scrollSchoolToTop = (index: number) => {
    const container = schoolListRef.current;
    const el = container?.children[index] as HTMLElement | undefined;
    if (!container || !el) return;
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    container.scrollTo({ top, behavior: "smooth" });
  };

  useDismissOnOutsideClick(schoolContainerRef, schoolOpen, () => {
    setSchoolOpen(false);
    setSchoolFilter("");
  });
  useDismissOnOutsideClick(teamsContainerRef, teamsOpen, () =>
    setTeamsOpen(false)
  );

  useEffect(() => {
    if (!schoolOpen) return;

    const q = schoolFilter.trim();
    if (q.length > 0) {
      if (jumpIndex >= 0) scrollSchoolToTop(jumpIndex);
      return;
    }

    const selectedIndex = schools.findIndex((s) => s.id === selectedSchoolId);
    if (selectedIndex >= 0) scrollSchoolToTop(selectedIndex);
  }, [jumpIndex, schoolFilter, schoolOpen, selectedSchoolId, schools]);

  useEffect(() => {
    if (!selectedSchoolId) {
      queueMicrotask(() => {
        setSchoolTeams([]);
        setTeamsLoading(false);
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setTeamsLoading(true);
      setTeamsError(null);
    });

    void getAddableTeamsForSchool(tournamentId, selectedSchoolId).then(
      (result) => {
        if (cancelled) return;
        setTeamsLoading(false);
        if ("error" in result) {
          setTeamsError(result.error);
          setSchoolTeams([]);
        } else {
          setSchoolTeams(result.teams);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [selectedSchoolId, tournamentId]);

  const selectedCount = selectedIds.size;

  const triggerLabel = useMemo(() => {
    if (selectedCount === 0) return "Select teams";
    if (selectedCount === 1) {
      const id = [...selectedIds][0]!;
      const t = schoolTeams.find((team) => team.id === id);
      return t ? teamLabel(t) : "1 team selected";
    }
    return `${selectedCount} teams selected`;
  }, [selectedCount, selectedIds, schoolTeams]);

  function selectSchool(school: SchoolOption) {
    setSelectedSchoolId(school.id);
    setSchoolFilter("");
    setSchoolOpen(false);
    setTeamsOpen(false);
  }

  function toggleTeam(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedCount === 0) {
      setSubmitError("Select at least one team");
      return;
    }

    setLoading(true);
    setSubmitError(null);
    const operation = registrationOperationForSelection(
      registrationOperationRef.current,
      selectedIds
    );
    registrationOperationRef.current = operation;

    try {
      const result = await registerTeams(
        tournamentId,
        [...selectedIds],
        operation.operationId
      );
      if (result?.error) {
        setSubmitError(result.error);
        setLoading(false);
      } else {
        registrationOperationRef.current = null;
        router.push(`/tournaments/${tournamentSlug}`);
      }
    } catch {
      setSubmitError(
        "Could not confirm whether registration completed. Try again to safely retry."
      );
      setLoading(false);
    }
  }

  const submitLabel =
    loading
      ? "Adding…"
      : selectedCount === 0
        ? "Add teams"
        : selectedCount === 1
          ? "Add 1 team"
          : `Add ${selectedCount} teams`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="host-school-filter">School</Label>
        <div ref={schoolContainerRef} className="relative">
          <Button
            type="button"
            id="host-school-filter"
            variant="outline"
            disabled={loading}
            aria-expanded={schoolOpen}
            aria-haspopup="listbox"
            className={cn(
              "h-8 w-full justify-between px-2.5 font-normal",
              !selectedSchool && "text-muted-foreground"
            )}
            onClick={() => {
              setSchoolOpen((prev) => {
                const next = !prev;
                if (!next) setSchoolFilter("");
                return next;
              });
            }}
          >
            <span className="truncate text-left">
              {selectedSchool?.name ?? "Select a school"}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                schoolOpen && "rotate-180"
              )}
            />
          </Button>

          {schoolOpen && (
            <div
              className="absolute top-[calc(100%+4px)] left-0 z-50 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
              role="listbox"
              aria-label="Schools"
            >
              <div className="border-b p-2">
                <Input
                  type="text"
                  placeholder="Type to jump to a school…"
                  value={schoolFilter}
                  onChange={(e) => setSchoolFilter(e.target.value)}
                  disabled={loading}
                  autoComplete="off"
                  autoFocus
                  aria-controls="host-school-list"
                  className="h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const school =
                        jumpIndex >= 0 ? schools[jumpIndex] : undefined;
                      if (school) selectSchool(school);
                    }
                  }}
                />
              </div>
              <div
                id="host-school-list"
                ref={schoolListRef}
                className="h-48 overflow-y-auto overscroll-contain p-1"
              >
                {schools.map((school, index) => {
                  const isSelected = school.id === selectedSchoolId;
                  const isJumpTarget =
                    schoolFilter.trim().length > 0 && index === jumpIndex;
                  return (
                    <button
                      key={school.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        "flex w-full flex-col rounded-md border-l-2 px-3 py-2.5 text-left text-sm transition-[background-color,box-shadow,border-color]",
                        isSelected
                          ? "border-l-primary bg-primary/12 font-medium shadow-sm ring-1 ring-primary/25"
                          : "border-l-transparent hover:bg-muted/60",
                        isJumpTarget &&
                          !isSelected &&
                          "bg-muted/50 ring-1 ring-inset ring-primary/20"
                      )}
                      onClick={() => selectSchool(school)}
                    >
                      <span className="leading-tight">{school.name}</span>
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {school.university}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Teams</Label>
        <div ref={teamsContainerRef} className="relative">
          <Button
            type="button"
            variant="outline"
            disabled={
              loading || !selectedSchoolId || teamsLoading || schoolTeams.length === 0
            }
            aria-expanded={teamsOpen}
            aria-haspopup="listbox"
            className={cn(
              "h-8 w-full justify-between px-2.5 font-normal",
              selectedCount === 0 && "text-muted-foreground"
            )}
            onClick={() => setTeamsOpen((prev) => !prev)}
          >
            <span className="truncate">
              {teamsLoading ? "Loading teams…" : triggerLabel}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                teamsOpen && "rotate-180"
              )}
            />
          </Button>

          {teamsOpen && selectedSchoolId && !teamsLoading && (
            <div
              className="absolute top-[calc(100%+4px)] left-0 z-50 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
              role="listbox"
              aria-multiselectable
              aria-label="Teams"
            >
              <div className="h-64 overflow-y-auto overscroll-contain p-1">
                {schoolTeams.length === 0 ? (
                  <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                    {selectedSchool
                      ? `No ${selectedSchool.name} teams left to add for this event.`
                      : "No teams available."}
                  </p>
                ) : (
                  <>
                    <p className="px-2 pb-1 text-xs text-muted-foreground">
                      Tap a team to add or remove it from your selection.
                    </p>
                    {schoolTeams.map((team) => {
                      const isPicked = selectedIds.has(team.id);
                      return (
                        <button
                          key={team.id}
                          type="button"
                          role="option"
                          aria-selected={isPicked}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-[background-color,box-shadow]",
                            isPicked
                              ? "bg-primary/12 shadow-sm ring-1 ring-primary/30"
                              : "hover:bg-muted/60"
                          )}
                          onClick={() => toggleTeam(team.id)}
                        >
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block leading-tight",
                                isPicked && "font-semibold text-foreground"
                              )}
                            >
                              {team.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {team.university}
                            </span>
                          </span>
                          {isPicked ? (
                            <span className="shrink-0 text-xs font-medium text-primary">
                              Added
                            </span>
                          ) : (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Add
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {teamsError && (
          <p className="text-xs text-destructive">{teamsError}</p>
        )}
        {!teamsLoading &&
          selectedSchool &&
          schoolTeams.length === 0 &&
          !teamsError && (
            <p className="text-xs text-muted-foreground">
              Pick another school above to add more teams.
            </p>
          )}
      </div>

      <p className="text-xs text-muted-foreground">
        Assign pools and groups later from the tournament dashboard. You can add
        teams from multiple schools before submitting.
      </p>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={loading || selectedCount === 0}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

function CaptainRegisterForm({
  tournamentId,
  tournamentSlug,
  teams,
}: {
  tournamentId: string;
  tournamentSlug: string;
  teams: RegisterTeam[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const registrationOperationRef = useRef<RegistrationOperation | null>(null);

  const allSelected =
    teams.length > 0 && teams.every((t) => selectedIds.has(t.id));
  const selectedCount = selectedIds.size;
  const selectedTeams = teams.filter((t) => selectedIds.has(t.id));
  const teamGroups = useMemo(() => groupTeamsBySchool(teams), [teams]);

  const triggerLabel = useMemo(() => {
    if (selectedCount === 0) return "Select teams";
    if (selectedCount === 1) return teamLabel(selectedTeams[0]!);
    return `${selectedCount} teams selected`;
  }, [selectedCount, selectedTeams]);

  const submitLabel = useMemo(() => {
    if (loading) return "Registering…";
    if (selectedCount === 0) return "Register teams";
    if (selectedCount === 1) return "Register 1 team";
    return `Register ${selectedCount} teams`;
  }, [loading, selectedCount]);

  useDismissOnOutsideClick(containerRef, open, () => setOpen(false));

  function toggleTeam(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(teams.map((t) => t.id)));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedCount === 0) {
      setError("Select at least one team");
      return;
    }

    setLoading(true);
    setError(null);
    const operation = registrationOperationForSelection(
      registrationOperationRef.current,
      selectedIds
    );
    registrationOperationRef.current = operation;

    try {
      const result = await registerTeams(
        tournamentId,
        [...selectedIds],
        operation.operationId
      );
      if (result?.error) {
        setError(result.error);
        setLoading(false);
      } else {
        registrationOperationRef.current = null;
        router.push(`/tournaments/${tournamentSlug}`);
      }
    } catch {
      setError(
        "Could not confirm whether registration completed. Try again to safely retry."
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Teams</Label>
        <div ref={containerRef} className="relative">
          <Button
            type="button"
            variant="outline"
            disabled={loading || teams.length === 0}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              "h-8 w-full justify-between px-2.5 font-normal",
              selectedCount === 0 && "text-muted-foreground"
            )}
            onClick={() => setOpen((prev) => !prev)}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          </Button>

          {open && (
            <div
              className="absolute top-[calc(100%+4px)] left-0 z-50 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
              role="listbox"
              aria-multiselectable
              aria-label="Teams"
            >
              {teams.length > 1 && (
                <div className="flex justify-end border-b px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={toggleAll}
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </Button>
                </div>
              )}
              <div className="max-h-64 overflow-y-auto p-1">
                {teamGroups.map((group, groupIndex) => (
                  <div
                    key={group.key}
                    className={cn(groupIndex > 0 && "mt-1 border-t pt-1")}
                  >
                    <p className="sticky top-0 z-10 bg-popover px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </p>
                    {group.teams.map((team) => {
                      const checked = selectedIds.has(team.id);
                      return (
                        <button
                          key={team.id}
                          type="button"
                          role="option"
                          aria-selected={checked}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50",
                            checked && "bg-muted/40"
                          )}
                          onClick={() => toggleTeam(team.id)}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                              checked &&
                                "border-primary bg-primary text-primary-foreground"
                            )}
                          >
                            {checked ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium leading-tight">
                              {team.name}
                            </span>
                            <span className="block text-muted-foreground">
                              {team.university}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Pool and group placement is set by the tournament organizer after you
        register.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={loading || selectedCount === 0}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

export function RegisterForm({
  tournamentId,
  tournamentSlug,
  teams,
  asHost = false,
  hostSchool = null,
  schools,
}: Props) {
  if (asHost && schools && schools.length > 0) {
    return (
      <HostRegisterForm
        tournamentId={tournamentId}
        tournamentSlug={tournamentSlug}
        schools={schools}
        hostSchool={hostSchool}
        initialTeams={teams}
      />
    );
  }

  return (
    <CaptainRegisterForm
      tournamentId={tournamentId}
      tournamentSlug={tournamentSlug}
      teams={teams}
    />
  );
}
