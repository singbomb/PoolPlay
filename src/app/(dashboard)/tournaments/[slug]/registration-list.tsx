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

import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Check,
  ClipboardList,
  Loader2,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  setRegistrationDivision,
  updateRegistrationStatus,
  confirmPendingRegistrations,
  bulkAssignRegistrationsToDivision,
  bulkRemoveRegistrations,
} from "../actions";
import { withdrawRegistration } from "./register/actions";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { groupPendingRegistrationsBySchool } from "@/lib/tournaments/group-pending-registrations";
import type { TeamWaiverCompliance } from "@/lib/tournaments/waiver-compliance";
import type { RegistrationPaymentRow } from "@/lib/tournaments/payment-compliance";
import {
  formatFeeCents,
  paymentStatusLabel,
} from "@/lib/tournaments/payment-settings";
import { tournamentTabUrl } from "./constants";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Registration {
  id: string;
  status: string;
  registeredAt: Date;
  teamId: string;
  teamName: string;
  teamUniversity: string;
  schoolId: string | null;
  schoolName: string | null;
  divisionId: string | null;
  divisionName: string | null;
}

type DivisionOption = { id: string; name: string };

type ListKind = "teams" | "pending";

type PendingChange = {
  regId: string;
  expectedDivisionId: string | null;
  expectedStatus: string | null;
};

function isPendingChangeComplete(
  pending: PendingChange,
  registrations: Registration[]
): boolean {
  const reg = registrations.find((r) => r.id === pending.regId);
  if (!reg) return true;
  const divMatch =
    pending.expectedDivisionId === undefined ||
    pending.expectedDivisionId === null
      ? true
      : reg.divisionId === pending.expectedDivisionId;
  const statusMatch =
    pending.expectedStatus === null || reg.status === pending.expectedStatus;
  return divMatch && statusMatch;
}

export function RegistrationList({
  tournamentId,
  tournamentSlug,
  registrations,
  divisions,
  listKind,
  applicantView = false,
  canManageRegistrations,
  canCheckIn,
  canWithdraw,
  captainTeamIds,
  waiverSummary = new Map(),
  showWaiverStatus = false,
  paymentSummary = new Map(),
  showPaymentStatus = false,
}: {
  tournamentId: string;
  tournamentSlug: string;
  registrations: Registration[];
  divisions: DivisionOption[];
  /** Confirmed roster vs awaiting approval. */
  listKind: ListKind;
  /** Applicant-facing layout: status box on the right, no organizer controls. */
  applicantView?: boolean;
  canManageRegistrations: boolean;
  canCheckIn: boolean;
  canWithdraw: boolean;
  captainTeamIds: Set<string>;
  waiverSummary?: Map<
    string,
    Pick<
      TeamWaiverCompliance,
      "required" | "complete" | "completedCount" | "totalCount"
    >
  >;
  showWaiverStatus?: boolean;
  paymentSummary?: Map<string, RegistrationPaymentRow>;
  showPaymentStatus?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [bulkPendingIds, setBulkPendingIds] = useState<string[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStatusOperations = useRef(new Map<string, string>());

  const showBulkSelect =
    listKind === "teams" && canManageRegistrations && !applicantView;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkPoolValue, setBulkPoolValue] = useState<string>("");

  const groupBySchool =
    listKind === "pending" && canManageRegistrations && !applicantView;

  const schoolGroups = useMemo(
    () =>
      groupBySchool
        ? groupPendingRegistrationsBySchool<Registration>(registrations)
        : [],
    [groupBySchool, registrations]
  );

  const activePending =
    pending && !isPendingChangeComplete(pending, registrations)
      ? pending
      : null;

  const anyBusy = activePending !== null || bulkPendingIds !== null;

  useEffect(() => {
    return () => {
      if (safetyRef.current) clearTimeout(safetyRef.current);
    };
  }, []);

  const isRegBusy = useCallback(
    (regId: string) =>
      bulkPendingIds?.includes(regId) === true || activePending?.regId === regId,
    [bulkPendingIds, activePending]
  );

  const allRegIds = useMemo(
    () => registrations.map((r) => r.id),
    [registrations]
  );

  // Selections may include rows that no longer exist (e.g. after a refresh).
  // Derive the live set instead of mutating state from an effect.
  const liveSelectedIds = useMemo(() => {
    if (!showBulkSelect || selectedIds.size === 0) return [] as string[];
    return allRegIds.filter((id) => selectedIds.has(id));
  }, [allRegIds, selectedIds, showBulkSelect]);

  const selectedCount = liveSelectedIds.length;
  const allSelected = selectedCount > 0 && selectedCount === allRegIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleRowSelected = useCallback(
    (regId: string) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(regId)) next.delete(regId);
        else next.add(regId);
        return next;
      });
    },
    []
  );

  const toggleAllSelected = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(allRegIds) : new Set());
    },
    [allRegIds]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkPoolValue("");
  }, []);

  const handleBulkAssignPool = useCallback(
    async (value: string) => {
      const ids = liveSelectedIds;
      if (ids.length === 0) return;
      const divisionId = value === "__unassigned__" ? null : value;
      setBulkError(null);
      setBulkPendingIds(ids);
      try {
        const result = await bulkAssignRegistrationsToDivision(
          tournamentId,
          ids,
          divisionId
        );
        if (result?.error) {
          setBulkError(result.error);
          setBulkPendingIds(null);
          return;
        }
        await router.refresh();
        setBulkPendingIds(null);
        setBulkPoolValue("");
      } catch {
        setBulkPendingIds(null);
      }
    },
    [router, liveSelectedIds, tournamentId]
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = liveSelectedIds;
    if (ids.length === 0) return;
    setBulkError(null);
    setBulkPendingIds(ids);
    try {
      const result = await bulkRemoveRegistrations(tournamentId, ids);
      if (result?.error) {
        setBulkError(result.error);
        setBulkPendingIds(null);
        return;
      }
      setSelectedIds(new Set());
      setConfirmDelete(false);
      await router.refresh();
      setBulkPendingIds(null);
    } catch {
      setBulkPendingIds(null);
    }
  }, [router, liveSelectedIds, tournamentId]);

  const handleDivisionChange = useCallback(
    async (regId: string, value: string) => {
      setErrorMap((m) => {
        const next = { ...m };
        delete next[regId];
        return next;
      });
      const nextId = value === "__unassigned__" ? null : value;
      setPending({ regId, expectedDivisionId: nextId, expectedStatus: null });
      if (safetyRef.current) clearTimeout(safetyRef.current);
      try {
        const result = await setRegistrationDivision(regId, nextId);
        if (result?.error) {
          setErrorMap((m) => ({ ...m, [regId]: result.error! }));
          setPending(null);
          return;
        }
        await router.refresh();
        safetyRef.current = setTimeout(() => {
          safetyRef.current = null;
          setPending((cur) => (cur?.regId === regId ? null : cur));
        }, 8_000);
      } catch {
        setPending(null);
      }
    },
    [router]
  );

  const handleStatusChange = useCallback(
    async (
      regId: string,
      status: "confirmed" | "pending" | "checked_in"
    ) => {
      setPending({ regId, expectedDivisionId: null, expectedStatus: status });
      if (safetyRef.current) clearTimeout(safetyRef.current);
      const payloadKey = JSON.stringify({
        tournamentId,
        registrationIds: [regId],
        toStatus: status,
      });
      const operationId =
        pendingStatusOperations.current.get(payloadKey) ?? crypto.randomUUID();
      pendingStatusOperations.current.set(payloadKey, operationId);
      try {
        const result = await updateRegistrationStatus(
          regId,
          status,
          operationId
        );
        if (result?.error) {
          setErrorMap((m) => ({ ...m, [regId]: result.error! }));
          setPending(null);
          return;
        }
        pendingStatusOperations.current.delete(payloadKey);
        await router.refresh();
        safetyRef.current = setTimeout(() => {
          safetyRef.current = null;
          setPending((cur) => (cur?.regId === regId ? null : cur));
        }, 8_000);
      } catch {
        setErrorMap((m) => ({
          ...m,
          [regId]:
            "The status update could not be confirmed. Try again to safely retry it.",
        }));
        setPending(null);
      }
    },
    [router, tournamentId]
  );

  const handleConfirmAll = useCallback(
    async (registrationIds: string[]) => {
      const pendingIds = registrationIds.filter((id) => {
        const reg = registrations.find((r) => r.id === id);
        return reg?.status === "pending";
      });
      if (pendingIds.length === 0) return;

      const operationRegistrationIds = [...pendingIds].sort();
      const payloadKey = JSON.stringify({
        tournamentId,
        registrationIds: operationRegistrationIds,
        toStatus: "confirmed",
      });
      const operationId =
        pendingStatusOperations.current.get(payloadKey) ?? crypto.randomUUID();
      pendingStatusOperations.current.set(payloadKey, operationId);

      setBulkError(null);
      setBulkPendingIds(operationRegistrationIds);
      if (safetyRef.current) clearTimeout(safetyRef.current);
      try {
        const result = await confirmPendingRegistrations(
          tournamentId,
          operationRegistrationIds,
          operationId
        );
        if (result?.error) {
          setBulkError(result.error);
          setBulkPendingIds(null);
          return;
        }
        pendingStatusOperations.current.delete(payloadKey);
        await router.refresh();
        safetyRef.current = setTimeout(() => {
          safetyRef.current = null;
          setBulkPendingIds(null);
        }, 8_000);
      } catch {
        setBulkError(
          "The confirmation could not be verified. Try again to safely retry it."
        );
        setBulkPendingIds(null);
      }
    },
    [router, tournamentId, registrations]
  );

  const handleWithdraw = useCallback(
    async (teamId: string) => {
      setErrorMap((m) => {
        const next = { ...m };
        delete next[teamId];
        return next;
      });
      try {
        const result = await withdrawRegistration(tournamentId, teamId);
        if (result?.error) {
          setErrorMap((m) => ({ ...m, [teamId]: result.error! }));
          return;
        }
        await router.refresh();
      } catch {
        /* ignore */
      }
    },
    [router, tournamentId]
  );

  const renderRegistrationRow = (reg: Registration) => {
    const isBusy = isRegBusy(reg.id);
    const rowError = errorMap[reg.id] ?? errorMap[reg.teamId] ?? null;
    const canWithdrawRow =
      canWithdraw &&
      (canManageRegistrations || captainTeamIds.has(reg.teamId));
    const showDivisionAssignment =
      listKind === "teams" && canManageRegistrations && divisions.length > 0;

    const showUniversity =
      !groupBySchool || (groupBySchool && !reg.schoolId);
    const isSelected = showBulkSelect && selectedIds.has(reg.id);
    const waiver = waiverSummary.get(reg.teamId);
    const canManageWaiverRow =
      showWaiverStatus &&
      waiver?.required &&
      (canManageRegistrations || captainTeamIds.has(reg.teamId));
    const payment = paymentSummary.get(reg.id);
    const canManagePaymentRow =
      showPaymentStatus &&
      payment &&
      payment.status !== "confirmed" &&
      payment.status !== "waived" &&
      (canManageRegistrations || captainTeamIds.has(reg.teamId));

    return (
      <div
        key={reg.id}
        className={cn(
          "relative flex flex-col gap-2 px-1 py-3 transition-[opacity,background-color] duration-150 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
          isBusy && "opacity-60",
          isSelected && "border-primary/60 bg-primary/[0.04]"
        )}
      >
        {isBusy && (
          <div
            className="pointer-events-auto absolute inset-0 z-10 flex cursor-wait items-center justify-center rounded-md bg-background/60 backdrop-blur-[1px]"
            aria-hidden
          >
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {showBulkSelect && (
          <Checkbox
            checked={isSelected}
            disabled={anyBusy}
            onCheckedChange={() => toggleRowSelected(reg.id)}
            aria-label={`Select ${reg.teamName}`}
            className="shrink-0 self-start sm:self-center"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{reg.teamName}</p>
          {showUniversity && (
            <p className="truncate text-xs text-muted-foreground">
              {reg.teamUniversity}
            </p>
          )}
          {listKind === "teams" && !showDivisionAssignment && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="text-muted-foreground/80">Pool · </span>
              {reg.divisionName ?? (
                <span className="italic">Not assigned</span>
              )}
            </p>
          )}
          {showWaiverStatus && waiver?.required ? (
            <p
              className={cn(
                "mt-0.5 text-xs",
                waiver.complete
                  ? "text-muted-foreground"
                  : "text-amber-700 dark:text-amber-400"
              )}
            >
              Waiver · {waiver.completedCount}/{waiver.totalCount} complete
            </p>
          ) : null}
          {showPaymentStatus && payment ? (
            <p
              className={cn(
                "mt-0.5 text-xs",
                payment.status === "confirmed" || payment.status === "waived"
                  ? "text-muted-foreground"
                  : "text-amber-700 dark:text-amber-400"
              )}
            >
              Payment · {formatFeeCents(payment.amountCents)} ·{" "}
              {paymentStatusLabel(payment.status)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2">
          {canManageWaiverRow && !waiver?.complete ? (
            <Link
              href={tournamentTabUrl(tournamentSlug, "waiver")}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Complete waivers
            </Link>
          ) : null}
          {canManagePaymentRow ? (
            <Link
              href={tournamentTabUrl(tournamentSlug, "payment")}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {payment?.status === "unpaid" ? "Submit payment" : "View payment"}
            </Link>
          ) : null}
          {showDivisionAssignment && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`division-${reg.id}`}
                className="shrink-0 text-xs text-muted-foreground"
              >
                Pool
              </Label>
              <Select
                disabled={anyBusy}
                value={reg.divisionId ?? "__unassigned__"}
                onValueChange={(v) => {
                  if (typeof v === "string")
                    void handleDivisionChange(reg.id, v);
                }}
              >
                <SelectTrigger
                  id={`division-${reg.id}`}
                  className="h-8 w-[10.5rem] min-w-0"
                >
                  <SelectValue placeholder="Assign pool">
                    {(v) => {
                      if (v === "__unassigned__" || v == null)
                        return "Unassigned";
                      const d = divisions.find((x) => x.id === v);
                      return d?.name ?? String(v);
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {divisions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <StatusBadge
            kind="registration"
            status={reg.status}
            className="h-7 shrink-0 self-center px-2.5"
          />
          {listKind === "pending" &&
            canManageRegistrations &&
            reg.status === "pending" && (
              <Button
                variant="outline"
                size="sm"
                disabled={anyBusy}
                onClick={() => handleStatusChange(reg.id, "confirmed")}
              >
                <Check className="mr-1 h-3 w-3" />
                Confirm
              </Button>
            )}
          {listKind === "teams" &&
            canCheckIn &&
            reg.status === "confirmed" && (
              <Button
                variant="outline"
                size="sm"
                disabled={anyBusy}
                onClick={() => handleStatusChange(reg.id, "checked_in")}
              >
                <UserCheck className="mr-1 h-3 w-3" />
                Check in
              </Button>
            )}
          {canWithdrawRow && (
            <Button
              variant="outline"
              size="sm"
              disabled={anyBusy}
              onClick={() => handleWithdraw(reg.teamId)}
            >
              <X className="mr-1 h-3 w-3" />
              {canManageRegistrations ? "Delete" : "Withdraw"}
            </Button>
          )}
          {rowError && applicantView && (
            <p className="w-full text-right text-xs text-destructive">
              {rowError}
            </p>
          )}
          {showDivisionAssignment && rowError && (
            <p className="w-full basis-full text-right text-xs text-destructive">
              {rowError}
            </p>
          )}
        </div>
      </div>
    );
  };

  if (registrations.length === 0) {
    return (
      <EmptyState
        icon={listKind === "pending" ? ClipboardList : Users}
        title={
          listKind === "pending"
            ? applicantView
              ? "No pending application"
              : "No teams awaiting approval"
            : "No confirmed teams yet"
        }
        description={
          listKind === "pending"
            ? applicantView
              ? "Your team doesn't have a pending application for this tournament."
              : "New registrations will appear here for you to review and confirm."
            : "Once you confirm registrations, teams will show up here."
        }
      />
    );
  }

  if (groupBySchool) {
    return (
      <div className="space-y-4">
        {bulkError && (
          <p className="text-sm text-destructive" role="alert">
            {bulkError}
          </p>
        )}
        {schoolGroups.map((group) => {
          const pendingInGroup = group.registrations.filter(
            (r) => r.status === "pending"
          );
          const pendingIds = pendingInGroup.map((r) => r.id);
          const groupBusy =
            bulkPendingIds !== null &&
            pendingIds.some((id) => bulkPendingIds.includes(id));

          return (
            <section
              key={group.key}
              className={cn(
                "overflow-hidden rounded-md border border-border/80",
                groupBusy && "opacity-80"
              )}
            >
              <div className="flex flex-col gap-2 border-b border-border/70 bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {group.registrations[0]?.schoolId ? (
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : null}
                    <p className="font-medium leading-tight">{group.label}</p>
                  </div>
                  {group.subtitle ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {group.subtitle}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pendingInGroup.length === group.registrations.length
                      ? `${pendingInGroup.length} team${pendingInGroup.length === 1 ? "" : "s"} pending`
                      : `${pendingInGroup.length} of ${group.registrations.length} teams pending`}
                  </p>
                </div>
                {pendingInGroup.length > 0 && (
                  <Button
                    size="sm"
                    disabled={anyBusy}
                    className="shrink-0"
                    onClick={() => void handleConfirmAll(pendingIds)}
                  >
                    {groupBusy ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-3 w-3" />
                    )}
                    Confirm all ({pendingInGroup.length})
                  </Button>
                )}
              </div>
              <div className="list-stack px-2">
                {group.registrations.map((reg) => renderRegistrationRow(reg))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  const bulkBusy = bulkPendingIds !== null;

  return (
    <div className="space-y-3">
      {showBulkSelect && (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2 sm:flex-row sm:items-center sm:gap-3",
            selectedCount > 0 && "border-primary/40 bg-primary/[0.04]"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              disabled={anyBusy || registrations.length === 0}
              onCheckedChange={() => toggleAllSelected(!allSelected)}
              aria-label={allSelected ? "Deselect all teams" : "Select all teams"}
            />
            <span className="text-sm font-medium">
              {selectedCount === 0
                ? `Select teams (${registrations.length})`
                : `${selectedCount} selected`}
            </span>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {divisions.length > 0 && (
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="bulk-pool"
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  Assign pool
                </Label>
                <Select
                  disabled={selectedCount === 0 || bulkBusy}
                  value={bulkPoolValue || undefined}
                  onValueChange={(v) => {
                    if (typeof v !== "string") return;
                    setBulkPoolValue(v);
                    void handleBulkAssignPool(v);
                  }}
                >
                  <SelectTrigger id="bulk-pool" className="h-8 w-[10.5rem]">
                    <SelectValue placeholder="Choose pool…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {divisions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCount === 0 || bulkBusy}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
            {selectedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkBusy}
                onClick={clearSelection}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
      {bulkError && (
        <p className="text-sm text-destructive" role="alert">
          {bulkError}
        </p>
      )}
      <div className="list-stack border-y border-border/70">
        {registrations.map((reg) => renderRegistrationRow(reg))}
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove selected teams?</DialogTitle>
            <DialogDescription>
              {selectedCount === 1
                ? "This team will be removed from the tournament."
                : `${selectedCount} teams will be removed from the tournament.`}{" "}
              They&apos;ll need to re-register to participate again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={bulkBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleBulkDelete()}
              disabled={bulkBusy || selectedCount === 0}
            >
              {bulkBusy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3 w-3" />
              )}
              Remove {selectedCount > 0 ? `(${selectedCount})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
