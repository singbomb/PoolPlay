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

import type { ReactNode } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { PacketData } from "@/lib/tournaments/packet-data";
import {
  formatPacketGeneratedAt,
  formatPacketTime,
} from "@/lib/tournaments/packet-data";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    lineHeight: 1.45,
    color: "#1a1a1a",
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#444",
    marginBottom: 2,
  },
  meta: {
    fontSize: 9,
    color: "#666",
    marginBottom: 16,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  paragraph: {
    marginBottom: 4,
  },
  bullet: {
    marginLeft: 10,
    marginBottom: 2,
  },
  teamRow: {
    marginBottom: 2,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    paddingBottom: 4,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
    fontSize: 9,
  },
  colTime: { width: "18%" },
  colCourt: { width: "12%" },
  colRound: { width: "22%" },
  colMatch: { width: "48%" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#888",
    borderTopWidth: 0.5,
    borderTopColor: "#ddd",
    paddingTop: 8,
  },
  notes: {
    fontSize: 9,
    whiteSpace: "pre-wrap",
  },
});

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

export function TournamentPacketDocument({ data }: { data: PacketData }) {
  return (
    <Document title={`${data.name} — Tournament Packet`}>
      <Page size="LETTER" style={styles.page} wrap>
        <Text style={styles.title}>{data.name}</Text>
        <Text style={styles.subtitle}>
          {data.dateDisplay} · {data.location}
        </Text>
        {data.address ? (
          <Text style={styles.subtitle}>{data.address}</Text>
        ) : null}
        <Text style={styles.meta}>
          {data.genderLabel} · {data.regionLabel}
          {data.hostSchoolName ? ` · Hosted by ${data.hostSchoolName}` : ""}
        </Text>
        <Text style={styles.meta}>
          Organizer: {data.organizerName} · Live event: {data.liveUrl}
        </Text>

        {data.description ? (
          <Section title="Event overview">
            <Text style={styles.notes}>{data.description}</Text>
          </Section>
        ) : null}

        {data.registeredTeams.length > 0 ? (
          <Section title="Registered teams">
            {data.registeredTeams.map((team) => (
              <Text key={team.name} style={styles.teamRow}>
                {team.name}
              </Text>
            ))}
          </Section>
        ) : null}

        {data.packetNotes ? (
          <Section title="Logistics & day-of information">
            <Text style={styles.notes}>{data.packetNotes}</Text>
          </Section>
        ) : null}

        {data.paymentInstructions ? (
          <Section title="Entry fees & payment">
            <Text style={styles.notes}>{data.paymentInstructions}</Text>
          </Section>
        ) : null}

        {data.hasPoolPlay ? (
          <Section title="Competition rules — pool play">
            <Bullet>Format: {data.playFormatLabel}</Bullet>
            <Bullet>Match format: {data.poolRules.matchFormatLabel}</Bullet>
            <Bullet>
              Pool sets start at {data.poolRules.setStartingScore}–
              {data.poolRules.setStartingScore}, play to{" "}
              {data.poolRules.setTargetScore}
              {data.poolRules.matchFormat === "two_with_tiebreak"
                ? ` (tiebreak to ${data.poolRules.tiebreakTargetScore})`
                : ""}
            </Bullet>
            <Bullet>Warmup: {data.poolRules.warmupFormatLabel}</Bullet>
            {data.poolRules.tiebreakCriteria.length > 0 ? (
              <Text style={styles.paragraph}>
                Pool standings tiebreaks (in order):{" "}
                {data.poolRules.tiebreakCriteria.join(" → ")}
              </Text>
            ) : null}
          </Section>
        ) : null}

        {data.bracketRules ? (
          <Section title="Competition rules — bracket play">
            <Text style={styles.paragraph}>{data.bracketRules.summary}</Text>
            <Bullet>
              Match format: {data.bracketRules.matchFormatLabel}
            </Bullet>
            <Bullet>
              Bracket sets start at {data.bracketRules.setStartingScore}–
              {data.bracketRules.setStartingScore}, play to{" "}
              {data.bracketRules.setTargetScore}
              {data.bracketRules.matchFormat === "two_with_tiebreak"
                ? ` (deciding set to ${data.bracketRules.tiebreakTargetScore})`
                : ""}
            </Bullet>
            <Bullet>Warmup: {data.poolRules.warmupFormatLabel}</Bullet>
          </Section>
        ) : null}

        <Section title="Match schedule">
          {data.schedule.length === 0 ? (
            <Text style={styles.paragraph}>
              Schedule will be published on PoolPlay — check the live event page
              for updates.
            </Text>
          ) : (
            <>
              <View style={styles.tableHeader}>
                <Text style={styles.colTime}>Time</Text>
                <Text style={styles.colCourt}>Court</Text>
                <Text style={styles.colRound}>Round</Text>
                <Text style={styles.colMatch}>Matchup</Text>
              </View>
              {data.schedule.map((row, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={styles.colTime}>
                    {row.warmupTime
                      ? `${formatPacketTime(row.warmupTime)} W / `
                      : ""}
                    {formatPacketTime(row.scheduledTime)}
                  </Text>
                  <Text style={styles.colCourt}>{row.courtName ?? "—"}</Text>
                  <Text style={styles.colRound}>{row.roundLabel}</Text>
                  <Text style={styles.colMatch}>
                    {row.teamAName} vs {row.teamBName}
                  </Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <View style={styles.footer} fixed>
          <Text>
            Generated {formatPacketGeneratedAt(data.generatedAt)}. Rules and
            schedule reflect settings at generation time.
          </Text>
          <Text>{data.liveUrl}</Text>
        </View>
      </Page>
    </Document>
  );
}
