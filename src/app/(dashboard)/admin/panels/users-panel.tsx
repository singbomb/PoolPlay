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

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { asc, count } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRow } from "../users/user-row";
import { AdminTablePagination } from "../admin-table-pagination";
import { ADMIN_TABLE_PAGE_SIZE } from "../constants";

export async function AdminUsersPanel({ page }: { page: number }) {
  const currentUser = await getCurrentUser();
  const requestedPage = page;

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(users);

  const totalPages = Math.max(1, Math.ceil(total / ADMIN_TABLE_PAGE_SIZE));
  const safePage = Math.min(requestedPage, totalPages);

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      university: users.university,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.fullName))
    .limit(ADMIN_TABLE_PAGE_SIZE)
    .offset((safePage - 1) * ADMIN_TABLE_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <p className="text-sm text-muted-foreground">
          Change roles or disable account access. You are the current admin and
          can&apos;t demote yourself if you&apos;re the only one.{" "}
          <span className="text-muted-foreground/90">
            ({ADMIN_TABLE_PAGE_SIZE} users per page.)
          </span>
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border/80">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>University</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <UserRow
                key={u.id}
                user={{
                  ...u,
                  disabledAt: u.disabledAt?.toISOString() ?? null,
                  createdAt: u.createdAt.toISOString(),
                }}
                isSelf={u.id === currentUser?.id}
              />
            ))}
          </TableBody>
        </Table>
        <AdminTablePagination
          tab="users"
          page={safePage}
          pageSize={ADMIN_TABLE_PAGE_SIZE}
          total={total}
        />
      </div>
    </div>
  );
}
