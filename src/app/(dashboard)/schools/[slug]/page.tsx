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
import { asc, count, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  schoolMembers,
  schools,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BackLink } from "@/components/layout/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { TeamAttributesBadges } from "@/components/team-attributes-badges";
import { Building2, ExternalLink, Globe, Plus } from "lucide-react";
import { formatTeamGender, formatTeamRegion } from "@/lib/labels/team";
import {
  canManageSchool,
  canManageSchoolRoster,
  canSubmitForVerification,
  canTransferPresidency,
  emailMatchesDomain,
  getVerificationEligibility,
  isSchoolMember,
  isSchoolPresident,
} from "@/lib/schools/permissions";
import { SchoolHeaderActions } from "./school-header-actions";
import { SchoolRoster } from "./school-roster";
import { VerificationControls } from "./verification-controls";
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
  const [school] = await db
    .select({ name: schools.name })
    .from(schools)
    .where(eq(schools.slug, slug))
    .limit(1);

  return pageMetadata(school?.name ?? "School");
}

export const dynamic = "force-dynamic";

export default async function SchoolDetailPage({ params }: Props) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.slug, slug))
    .limit(1);
  if (!school) notFound();

  const [memberRows, teamRows, [{ value: memberCount }]] = await Promise.all([
    db
      .select({
        membershipId: schoolMembers.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        role: schoolMembers.role,
        title: schoolMembers.title,
        joinedAt: schoolMembers.joinedAt,
      })
      .from(schoolMembers)
      .innerJoin(users, eq(schoolMembers.userId, users.id))
      .where(eq(schoolMembers.schoolId, school.id))
      .orderBy(asc(users.fullName)),
    db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        gender: teams.gender,
        region: teams.region,
        memberCount: count(teamMembers.id),
      })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(eq(teams.schoolId, school.id))
      .groupBy(teams.id)
      .orderBy(asc(teams.name)),
    db
      .select({ value: count() })
      .from(schoolMembers)
      .where(eq(schoolMembers.schoolId, school.id)),
  ]);

  const myMembership =
    memberRows.find((m) => m.userId === user.id) ?? null;
  const membershipForPermissions = myMembership
    ? {
        schoolId: school.id,
        userId: user.id,
        role: myMembership.role,
      }
    : null;

  const officerCount = memberRows.filter((m) => m.role === "officer").length;
  const president = memberRows.find((m) => m.role === "president");

  const eligibility = getVerificationEligibility({
    status: school.verificationStatus,
    hasPresident: !!president,
    officerCount,
  });

  const canManage = canManageSchool(membershipForPermissions, user);
  const canRosterManage = canManageSchoolRoster(membershipForPermissions, user);
  const canTransfer = canTransferPresidency(membershipForPermissions, user);
  const canSubmit = canSubmitForVerification(
    membershipForPermissions,
    user,
    eligibility
  );

  // Members can browse other schools via /schools; back link always points there.
  const isMyOwnSchool = isSchoolMember(membershipForPermissions);
  const canDeleteFromMenu = canManage;
  const canLeaveFromMenu =
    isMyOwnSchool && !isSchoolPresident(membershipForPermissions);

  // The president-or-officer can also see the precomputed domain match,
  // useful before submitting.
  const myDomainMatches = emailMatchesDomain(user.email, school.domainHint);

  return (
    <div className="space-y-6">
      <BackLink href="/schools">
        {isMyOwnSchool ? "Find schools" : "All schools"}
      </BackLink>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {school.name}
            </h1>
            <StatusBadge
              kind="verification"
              status={school.verificationStatus}
            />
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end sm:pt-1">
            <div className="flex h-8 items-center justify-end gap-2 sm:h-9">
              {school.verificationStatus !== "verified" &&
                (canManage || canSubmit) && (
                  <VerificationControls
                    schoolId={school.id}
                    canSubmit={canSubmit}
                    blockedReason={eligibility.reason}
                    status={school.verificationStatus}
                  />
                )}
              <SchoolHeaderActions
                schoolId={school.id}
                schoolName={school.name}
                canManage={canManage}
                canDelete={canDeleteFromMenu}
                canLeave={canLeaveFromMenu}
                settingsDefaults={{
                  name: school.name,
                  university: school.university,
                  gender: school.gender,
                  region: school.region,
                  description: school.description,
                  websiteUrl: school.websiteUrl,
                  domainHint: school.domainHint,
                }}
              />
            </div>
            {myDomainMatches && school.domainHint && (canManage || canSubmit) && (
              <p className="text-xs text-success">
                Your email matches @{school.domainHint}
              </p>
            )}
          </div>
        </div>

        <p className="text-muted-foreground">{school.university}</p>
        <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {formatTeamGender(school.gender)}
            </Badge>
            <Badge variant="outline">
              {formatTeamRegion(school.region)}
            </Badge>
            {school.domainHint && (
              <Badge variant="outline" className="font-mono text-xs">
                @{school.domainHint}
              </Badge>
            )}
            {school.websiteUrl && (
              <a
                href={school.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Globe className="h-3 w-3" />
                Website
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        {school.description && (
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
            {school.description}
          </p>
        )}
      </div>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">
            Roster ({memberCount})
          </TabsTrigger>
          <TabsTrigger value="teams">
            Teams ({teamRows.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <SchoolRoster
            schoolId={school.id}
            members={memberRows.map((m) => ({
              membershipId: m.membershipId,
              userId: m.userId,
              fullName: m.fullName,
              email: canViewRosterEmail({
                viewerUserId: user.id,
                memberUserId: m.userId,
                canManageRoster: canRosterManage,
              })
                ? m.email
                : null,
              role: m.role,
              title: m.title,
            }))}
            canManage={canRosterManage}
            canTransferPresidencyAction={canTransfer}
          />
        </TabsContent>

        <TabsContent value="teams" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Teams listed here pull their roster from the school&apos;s
              master roster.
            </p>
            {canRosterManage && (
              <Link
                href={`/teams/new?schoolId=${school.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                <Plus className="mr-1 h-4 w-4" />
                New team in this school
              </Link>
            )}
          </div>

          {teamRows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No teams under this school yet"
              description={
                canRosterManage
                  ? "Create a team to pull players from the school's master roster."
                  : "Teams created under this school will appear here."
              }
              action={
                canRosterManage ? (
                  <Link
                    href={`/teams/new?schoolId=${school.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    New team in this school
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {teamRows.map((team) => (
                <Link key={team.id} href={`/teams/${team.slug}`}>
                  <Card className="h-full cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{team.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <TeamAttributesBadges
                        gender={team.gender}
                        region={team.region}
                      />
                      <p className="text-xs text-muted-foreground">
                        {team.memberCount} player
                        {team.memberCount === 1 ? "" : "s"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
