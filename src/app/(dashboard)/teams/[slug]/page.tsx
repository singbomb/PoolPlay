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

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  schoolMembers,
  schools,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SmartBackLink } from "@/components/layout/smart-back-link";
import { PageHeader } from "@/components/layout/page-header";
import { TeamAttributesBadges } from "@/components/team-attributes-badges";
import { StatusBadge } from "@/components/ui/status-badge";
import { Building2, CheckCircle2 } from "lucide-react";
import { isStandaloneTeam } from "@/lib/teams/verification";
import { AddMemberForm } from "./add-member-form";
import { RosterRow } from "./roster-row";
import { TeamDeleteButton } from "./team-delete-button";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { canViewRosterEmail } from "@/lib/security/roster-email-visibility";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.slug, slug))
    .limit(1);

  return pageMetadata(team?.name ?? "Team");
}

export default async function TeamDetailPage({ params }: Props) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.slug, slug))
    .limit(1);
  if (!team) notFound();

  const id = team.id;

  const [members, schoolRow, mySchoolMembership] = await Promise.all([
    db
      .select({
        id: teamMembers.id,
        role: teamMembers.role,
        jerseyNumber: teamMembers.jerseyNumber,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, id)),
    team.schoolId
      ? db
          .select({
            id: schools.id,
            name: schools.name,
            slug: schools.slug,
            verificationStatus: schools.verificationStatus,
          })
          .from(schools)
          .where(eq(schools.id, team.schoolId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    team.schoolId
      ? db
          .select({ role: schoolMembers.role })
          .from(schoolMembers)
          .where(
            and(
              eq(schoolMembers.schoolId, team.schoolId),
              eq(schoolMembers.userId, user.id)
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const currentMembership = members.find((m) => m.userId === user.id);
  const isCaptain =
    currentMembership?.role === "captain" ||
    isAdmin(user) ||
    mySchoolMembership?.role === "president" ||
    mySchoolMembership?.role === "officer";

  const backFallback = schoolRow
    ? `/schools/${schoolRow.slug}`
    : "/teams";

  const standalone = isStandaloneTeam(team.schoolId);
  const showVerificationBanner =
    standalone && team.verificationStatus !== "verified";

  return (
    <div className="space-y-6">
      <SmartBackLink fallbackHref={backFallback}>Back</SmartBackLink>
      {showVerificationBanner && (
        <div
          className={
            team.verificationStatus === "rejected"
              ? "rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
              : "rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          }
        >
          <p className="font-medium">
            {team.verificationStatus === "pending"
              ? "Pending admin approval"
              : "Team not approved"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {team.verificationStatus === "pending"
              ? "Standalone teams must be verified before they can register for tournaments. An admin will review this team soon."
              : "This team was rejected and cannot register for tournaments. Contact an admin if you believe this was a mistake."}
          </p>
          <StatusBadge
            kind="verification"
            status={team.verificationStatus}
            className="mt-2"
          />
        </div>
      )}
      <PageHeader
        title={team.name}
        description={team.university}
        actions={
          isCaptain ? (
            <TeamDeleteButton teamId={id} teamName={team.name} />
          ) : undefined
        }
      >
        <div className="mt-1 flex flex-col gap-2">
          <TeamAttributesBadges gender={team.gender} region={team.region} />
          {schoolRow && (
            <Link
              href={`/schools/${schoolRow.slug}`}
              className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <Building2 className="h-3 w-3" />
              <span>Part of {schoolRow.name}</span>
              {schoolRow.verificationStatus === "verified" && (
                <CheckCircle2 className="h-3 w-3 text-success" />
              )}
            </Link>
          )}
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>
            Roster ({members.length} {members.length === 1 ? "player" : "players"})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members.map((member) => (
              <RosterRow
                key={member.id}
                member={{
                  ...member,
                  email: canViewRosterEmail({
                    viewerUserId: user.id,
                    memberUserId: member.userId,
                    canManageRoster: isCaptain,
                  })
                    ? member.email
                    : null,
                }}
                isCaptain={isCaptain}
                teamId={id}
              />
            ))}
          </div>

          {isCaptain && (
            <>
              <Separator className="my-6" />
              {schoolRow && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Teams under a school can only add players from the
                  school&apos;s roster. Add new members at{" "}
                  <Link
                    href={`/schools/${schoolRow.slug}`}
                    className="underline underline-offset-4"
                  >
                    {schoolRow.name}
                  </Link>{" "}
                  first.
                </p>
              )}
              <AddMemberForm teamId={id} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
