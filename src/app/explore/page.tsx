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
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";
import { desc, ne } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { HeaderNav } from "@/components/layout/header-nav";
import { PoolPlayMark } from "@/components/layout/poolplay-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentAuthProfile } from "@/lib/auth";
import { TournamentGrid } from "@/components/tournament-grid";
import { enrichTournamentsWithHostSchools } from "@/lib/tournaments/host-school";
import { PUBLIC_TOURNAMENTS_CACHE_TAG } from "@/lib/tournaments/public-cache";
import { buildPublicTournamentListProjection } from "@/lib/tournaments/public-projection";
import { pageMetadata } from "@/lib/metadata";
import { PublicSiteFooter } from "@/components/layout/public-site-footer";

export const metadata = pageMetadata("Explore tournaments");

export const dynamic = "force-dynamic";

const publicTournamentListColumns = {
  slug: tournaments.slug,
  name: tournaments.name,
  description: tournaments.description,
  location: tournaments.location,
  date: tournaments.date,
  status: tournaments.status,
  gender: tournaments.gender,
  region: tournaments.region,
  hostSchoolId: tournaments.hostSchoolId,
};

const getPublicTournaments = unstable_cache(
  async () =>
    buildPublicTournamentListProjection(
      await enrichTournamentsWithHostSchools(
        await db
          .select(publicTournamentListColumns)
          .from(tournaments)
          .where(ne(tournaments.status, "draft"))
          .orderBy(desc(tournaments.date))
      )
    ),
  ["public-tournaments"],
  { revalidate: 60, tags: [PUBLIC_TOURNAMENTS_CACHE_TAG] }
);

export default async function ExplorePage() {
  const [user, allTournaments] = await Promise.all([
    getCurrentAuthProfile(),
    getPublicTournaments(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm transition-[background-color,backdrop-filter] duration-300 ease-out motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
        <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4 transition-[padding,gap] duration-300 ease-out">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <PoolPlayMark href="/" wordmarkClassName="text-lg" />
            <HeaderNav />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            {user ? (
              <UserMenu fullName={user.fullName} email={user.email} />
            ) : (
              <>
                <Link
                  href="/login"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className={buttonVariants({ size: "sm" })}
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 text-foreground/[0.05] bg-dot-grid [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="container mx-auto space-y-8 px-4 py-10">
          <div className="max-w-2xl space-y-2">
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Tournaments
            </h1>
            <p className="text-pretty text-muted-foreground">
              Browse upcoming and ongoing collegiate club volleyball tournaments.
            </p>
          </div>

          <TournamentGrid
            tournaments={allTournaments}
            linkPrefix="/explore/tournaments"
            linkHostSchools={false}
          />
        </div>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
