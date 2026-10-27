import "server-only";
import { reputationMode, weeklyThemesFor } from "@/lib/agents/reputation";
import { londonYmd } from "@/lib/clock";
import { dummyDataAllowed } from "@/lib/dummy-data";
import { google, googleFor } from "@/lib/google";
import type { Period } from "@/lib/report/build";
import type { Restaurant } from "@/lib/supabase";
import { agentThemes, dummyInsights, insightsLine, keywordThemes, themeText, type Insights, type Theme } from "./google-rules";
import type { ReportSectionDef } from "./types";

// The Monday report's Google section (docs/pilot-sprint.md, "Weekly report"):
// one card in place of the built-in Reputation, What customers said and Google
// visibility cards. Calls, direction requests and views come from live Google;
// a demo restaurant in test mode gets dummy ones, labelled.

const inRange = (t: string | null | undefined, from: Date, to: Date) => Boolean(t) && new Date(t!).getTime() >= from.getTime() && new Date(t!).getTime() < to.getTime();
const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

async function themesFor(restaurant: Restaurant, p: Period, week: { id: string; rating: number; text: string | null }[]): Promise<Theme[]> {
  if (!week.some((r) => r.text)) return [];
  if (reputationMode(restaurant) !== "off") {
    // The same saved themes as the built-in card (review_themes): no second AI call.
    const t = await weeklyThemesFor(restaurant.id, londonYmd(p.start), `the week starting ${londonYmd(p.start)}`, week.filter((r) => r.text)).catch(() => null);
    if (t && (t.praise.length || t.complaints.length)) return agentThemes(t);
  }
  return keywordThemes(week);
}

async function insightsFor(restaurant: Restaurant, p: Period): Promise<{ now: Insights; before: Insights; dummy: boolean } | null> {
  const g = await googleFor(restaurant.id);
  if (g.mode === "live" && g.getInsights) {
    try {
      const [now, before] = await Promise.all([g.getInsights(restaurant.id, p.start, p.end), g.getInsights(restaurant.id, p.prevStart, p.start)]);
      return { now, before, dummy: false };
    } catch (err) {
      console.error("Google insights failed; leaving them out of the report", err);
      return null;
    }
  }
  if (!(await dummyDataAllowed(restaurant.id))) return null;
  return { now: dummyInsights(restaurant.id, londonYmd(p.start)), before: dummyInsights(restaurant.id, londonYmd(p.prevStart)), dummy: true };
}

export const googleReportSection: ReportSectionDef = {
  id: "google_week",
  order: 20,
  replaces: ["reputation", "themes", "google"],
  async build({ restaurant, period: p }) {
    const reviews = await google().listReviews(restaurant.id);
    const ratingAt = (t: Date) => average(reviews.filter((r) => new Date(r.review_date) < t).map((r) => r.rating));
    const week = reviews.filter((r) => inRange(r.review_date, p.start, p.end));
    const before = reviews.filter((r) => inRange(r.review_date, p.prevStart, p.start));
    const replies = (from: Date, to: Date) => reviews.filter((r) => inRange(r.reply_posted_at, from, to)).length;
    const open = reviews.filter((r) => !r.replied && !r.reply_posted_at && new Date(r.review_date) < p.end).length;
    const [themes, insights] = await Promise.all([themesFor(restaurant, p, week), insightsFor(restaurant, p)]);

    const lines: string[] = [];
    if (insights) lines.push(`${insightsLine(insights.now, insights.before)}${insights.dummy ? " (dummy)" : ""}`);
    else lines.push("Calls, direction requests and views show here once Google is connected.");
    if (themes.length) lines.push(`Themes: ${themes.map(themeText).join("; ")}`);
    else lines.push("Themes: no written reviews last week.");
    if (open) lines.push(`${open} review${open === 1 ? "" : "s"} still waiting for a reply.`);
    return {
      title: "Google",
      stats: [
        { label: "Google rating", value: { now: ratingAt(p.end), before: ratingAt(p.start) }, format: "rating" },
        { label: "New reviews", value: { now: week.length, before: before.length }, format: "count" },
        { label: "Replies sent", value: { now: replies(p.start, p.end), before: replies(p.prevStart, p.start) }, format: "count" },
      ],
      lines,
      footnote: insights?.dummy ? "Calls, directions and views are dummy numbers: this demo restaurant isn't connected to Google." : null,
    };
  },
  facts: (s) => `Google: ${s.stats.map((x) => `${x.label} ${x.value.now} (before ${x.value.before})`).join(", ")}. ${s.lines.join(" ")}`,
  actions(s) {
    const open = s.lines.find((l) => /still waiting for a reply/.test(l));
    return open ? [{ title: "Reply to your open reviews", why: open, message: "Which reviews still need a reply?" }] : [];
  },
};
