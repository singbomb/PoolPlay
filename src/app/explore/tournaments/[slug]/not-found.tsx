/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Link from "next/link";
import { SearchX } from "lucide-react";
import { PoolPlayMark } from "@/components/layout/poolplay-mark";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function PublicTournamentNotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-5 text-center">
        <PoolPlayMark href="/" wordmarkClassName="text-xl" />
        <Card>
          <CardContent className="space-y-4 py-8">
            <SearchX className="mx-auto size-9 text-muted-foreground" aria-hidden />
            <div>
              <h1 className="font-heading text-xl font-bold">
                Tournament not found
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                It may not exist, or the host has not published it.
              </p>
            </div>
            <Link href="/explore" className={buttonVariants()}>
              Browse tournaments
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
