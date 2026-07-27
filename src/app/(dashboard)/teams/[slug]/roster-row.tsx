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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { removeTeamMember } from "../actions";
import { useState } from "react";

interface Member {
  id: string;
  role: "captain" | "player";
  jerseyNumber: number | null;
  userId: string;
  fullName: string;
  email: string | null;
}

export function RosterRow({
  member,
  isCaptain,
  teamId,
}: {
  member: Member;
  isCaptain: boolean;
  teamId: string;
}) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    await removeTeamMember(teamId, member.id);
    setRemoving(false);
  }

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex items-center gap-3">
        {member.jerseyNumber !== null && (
          <span className="text-lg font-bold text-muted-foreground w-8 text-center">
            {member.jerseyNumber}
          </span>
        )}
        <div>
          <p className="font-medium">{member.fullName}</p>
          {member.email && (
            <p className="text-sm text-muted-foreground">{member.email}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={member.role === "captain" ? "default" : "secondary"}>
          {member.role}
        </Badge>
        {isCaptain && member.role !== "captain" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleRemove}
            disabled={removing}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
