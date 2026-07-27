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
import { cn } from "@/lib/utils";

const TOP_LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/about", label: "About" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

/** Top bar links: no route-based highlight — same muted style for every item. */
export function HeaderNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Site"
      className={cn("flex items-center gap-1 sm:gap-4", className)}
    >
      {TOP_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-[color,background-color,transform] duration-200 ease-out hover:text-foreground motion-safe:hover:-translate-y-0.5 sm:px-3"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
