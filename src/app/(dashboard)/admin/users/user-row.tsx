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

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_SELECT_SIDE_OFFSET } from "../constants";
import { setUserRole, adminDisableUser } from "../actions";
import type { UserRole } from "@/types";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "captain", label: "Captain" },
  { value: "organizer", label: "Organizer" },
  { value: "admin", label: "Admin" },
];

interface Props {
  user: {
    id: string;
    fullName: string;
    email: string;
    university: string | null;
    role: UserRole;
    disabledAt: string | null;
    createdAt: string;
  };
  isSelf: boolean;
}

export function UserRow({ user, isSelf }: Props) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [savingRole, startRoleSave] = useTransition();
  const [disabling, startDisable] = useTransition();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [disabled, setDisabled] = useState(user.disabledAt !== null);

  function onRoleChange(next: string | null) {
    if (typeof next !== "string") return;
    if (!ROLE_OPTIONS.some((o) => o.value === next)) return;
    const previous = role;
    const nextRole = next as UserRole;
    setRole(nextRole);
    startRoleSave(async () => {
      const result = await setUserRole(user.id, nextRole);
      if ("error" in result && result.error) {
        toast.error(result.error);
        setRole(previous);
      } else {
        toast.success(`Role updated to ${nextRole}`);
      }
    });
  }

  function onDisable() {
    if (!disabled && !confirmDisable) {
      setConfirmDisable(true);
      window.setTimeout(() => setConfirmDisable(false), 4000);
      return;
    }
    startDisable(async () => {
      const result = await adminDisableUser(user.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        if ("authBanPending" in result && result.authBanPending) {
          toast.warning(
            `${user.fullName} is blocked in PoolPlay, but the login ban could not be confirmed.`
          );
        } else {
          toast.success(
            disabled
              ? `Login ban reapplied for ${user.fullName}`
              : `Disabled ${user.fullName}`
          );
        }
        setDisabled(true);
      }
      setConfirmDisable(false);
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {user.fullName}
        {isSelf && (
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
            you
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{user.email}</TableCell>
      <TableCell className="text-muted-foreground">
        {user.university ?? "—"}
      </TableCell>
      <TableCell>
        <div className="inline-flex items-center gap-2">
          <Select
            value={role}
            onValueChange={onRoleChange}
            disabled={savingRole || disabled}
          >
            <SelectTrigger size="sm" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent sideOffset={ADMIN_SELECT_SIDE_OFFSET}>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {savingRole && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant={confirmDisable && !disabled ? "destructive" : "outline"}
          size="sm"
          disabled={isSelf || disabling}
          onClick={onDisable}
        >
          {disabling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserX className="h-3.5 w-3.5" />
          )}
          {disabled
            ? "Reapply login ban"
            : confirmDisable
              ? "Confirm disable"
              : "Disable"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
