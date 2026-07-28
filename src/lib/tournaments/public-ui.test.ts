import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PublicMatchTime,
  PublicScoreRows,
} from "@/components/public-match-score";
import { PublicTournamentDetail } from "@/components/public-tournament-detail";
import {
  PublicTournamentAction,
  PublicTournamentPlay,
} from "@/components/public-tournament-play";
import type { PublicTournamentProjection } from "./public-projection";

const publicView: PublicTournamentProjection = {
  tournament: {
    slug: "summer-classic",
    name: "Summer Classic",
    description: null,
    date: "2026-07-27",
    location: "Main Gym",
    address: null,
    status: "in_progress",
    gender: "mens",
    region: "west",
    matchFormat: "best_of_2",
    setTargetScore: 25,
    tiebreakTargetScore: 15,
    hostSchool: null,
  },
  summary: {
    releasedDivisions: 1,
    pools: 0,
    brackets: 0,
    matches: 1,
    liveMatches: 1,
  },
  schedule: [
    {
      key: "match-1",
      kind: "pool",
      context: "Pool A",
      teamAName: "Red",
      teamBName: "Blue",
      winner: null,
      status: "in_progress",
      scheduledTime: "2026-07-27T01:15:00.000Z",
      courtName: "Court 1",
      sets: [],
    },
  ],
  divisions: [],
};

describe("public tournament UI", () => {
  it("formats match timestamps identically in different process timezones", () => {
    const previousTimezone = process.env.TZ;

    try {
      process.env.TZ = "UTC";
      const fromUtc = renderToStaticMarkup(
        createElement(PublicMatchTime, {
          value: "2026-07-27T01:15:00.000Z",
        })
      );

      process.env.TZ = "America/Los_Angeles";
      const fromPacific = renderToStaticMarkup(
        createElement(PublicMatchTime, {
          value: "2026-07-27T01:15:00.000Z",
        })
      );

      assert.equal(fromUtc, fromPacific);
      assert.match(
        fromUtc,
        /<time datetime="2026-07-27T01:15:00.000Z">Mon, 1:15 AM UTC<\/time>/i
      );
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("uses valid, resolvable ARIA heading references for schedule sections", () => {
    const html = renderToStaticMarkup(
      createElement(PublicTournamentPlay, { view: publicView })
    );
    const ids = new Set(
      [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    );
    const labelledBy = [...html.matchAll(/\saria-labelledby="([^"]+)"/g)].map(
      (match) => match[1]
    );

    assert.ok(labelledBy.length > 0);
    for (const reference of labelledBy) {
      assert.doesNotMatch(reference, /\s/);
      assert.ok(ids.has(reference), `Missing heading id for ${reference}`);
    }
    assert.match(
      html,
      /<time[^>]+datetime="2026-07-27T01:15:00.000Z"[^>]*>Mon, 1:15 AM UTC<\/time>/i
    );
  });

  it("renders score sets with table semantics and announces the winner", () => {
    const html = renderToStaticMarkup(
      createElement(PublicScoreRows, {
        teamAName: "Red",
        teamBName: "Blue",
        winner: "a",
        sets: [
          { teamAScore: 25, teamBScore: 20 },
          { teamAScore: 25, teamBScore: 18 },
        ],
      })
    );

    assert.match(html, /<table/);
    assert.match(html, /<th[^>]+scope="col"[^>]*>Set 1<\/th>/);
    assert.match(html, /<th[^>]+scope="row"/);
    assert.match(html, /Winner/);
  });

  it("offers registration only when the resolved lifecycle allows it", () => {
    const openHtml = renderToStaticMarkup(
      createElement(PublicTournamentAction, {
        authenticated: false,
        canRegister: true,
        slug: "summer-classic",
      })
    );
    assert.match(openHtml, />Sign in to register</);
    assert.match(
      openHtml,
      /href="\/login\?next=%2Ftournaments%2Fsummer-classic%2Fregister"/
    );

    assert.equal(
      renderToStaticMarkup(
        createElement(PublicTournamentAction, {
          authenticated: false,
          canRegister: false,
          slug: "summer-classic",
        })
      ),
      ""
    );
    assert.match(
      renderToStaticMarkup(
        createElement(PublicTournamentAction, {
          authenticated: true,
          canRegister: false,
          slug: "summer-classic",
        })
      ),
      />Open in dashboard</
    );
  });

  it("keeps date-sensitive claims out of unresolved server markup", () => {
    const view = {
      ...publicView,
      tournament: {
        ...publicView.tournament,
        date: "2020-07-27",
        status: "registration_open",
      },
      summary: {
        ...publicView.summary,
        liveMatches: 0,
      },
    };
    const html = renderToStaticMarkup(
      createElement(PublicTournamentDetail, {
        authProfile: null,
        view,
      })
    );

    assert.match(html, /Summer Classic/);
    assert.match(html, /July 27, 2020/);
    assert.doesNotMatch(html, /Registration open/);
    assert.doesNotMatch(html, /Sign in to register/);
    assert.doesNotMatch(html, /Checks for updates/);
  });
});
