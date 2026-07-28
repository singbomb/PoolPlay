"use client";

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
import { AlertTriangle } from "lucide-react";
import { PoolPlayMark } from "@/components/layout/poolplay-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function PublicTournamentError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-5 text-center">
        <PoolPlayMark href="/" wordmarkClassName="text-xl" />
        <Card>
          <CardContent className="space-y-4 py-8">
            <AlertTriangle
              className="mx-auto size-9 text-destructive"
              aria-hidden
            />
            <div>
              <h1 className="font-heading text-xl font-bold">
                The tournament could not load
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                The scores may be updating. Try again, or return to all
                tournaments.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <Button onClick={reset}>Try again</Button>
              <Link
                href="/explore"
                className={buttonVariants({ variant: "outline" })}
              >
                All tournaments
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
