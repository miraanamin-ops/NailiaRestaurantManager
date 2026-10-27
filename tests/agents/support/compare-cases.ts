// The old assistant against the agents (agents/tests/compare/cases.json): the
// same owner messages, scored by the same plain-code rules on what the owner got
// (the WhatsApp messages, the drafts on screen) and what changed (a reply on
// Google, a published rota, a sent campaign). The figures a right answer must
// contain are worked out by code from the case's data (Facts), never written in
// the cases. No imports from the app beyond pure rules, so it's unit-tested
// (tests/agents/compare-cases.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overCap } from "@/lib/discounts";

type Row = Record<string, unknown>;

export type CompareExpect = {
  answer_has_money?: "next_week_labour" | "last_saturday_net" | "last_week_net";
  answer_money_in_range?: "next_week_forecast";
  answer_has_percent_near?: "next_week_labour_pct";
  answer_mentions_all?: string[];
  answer_mentions_any?: string[];
  draft_on_screen?: { kind: string; review_author?: string; content_mentions?: string[]; within_cap?: boolean };
  no_google_write?: boolean;
  review_replied?: string;
  post_published?: boolean;
  campaign_sent?: boolean;
  rota_edit?: { staff: string; off_weekday?: number };
  rota_published?: boolean;
  staff_added?: string;
  menu_price_or_card?: { item: string; price: number };
  short_reply?: boolean;
};

export type CompareCase = {
  id: string;
  area: "finance" | "google" | "calendar" | "rota" | "chat";
  setup?: string[];
  message: string;
  // If an agent asks the owner a question first, the owner's answer (then the case is scored).
  answer_if_asked?: string;
  expect: CompareExpect;
  then?: { tap: "approve"; expect: CompareExpect };
};

export function loadCompareCases(): CompareCase[] {
  return (JSON.parse(readFileSync(join("agents", "tests", "compare", "cases.json"), "utf8")) as { cases: CompareCase[] }).cases;
}

// Worked out by code from the data, after the run (pounds, before VAT).
export type Facts = {
  next_week_labour: number | null;
  next_week_labour_pct: number | null;
  last_saturday_net: number | null;
  last_week_net: number | null;
  next_week_forecast: { low: number; high: number } | null;
};

// What the owner got and what the run changed.
export type Outcome = {
  texts: string[];
  tables: Record<string, Row[]>;
  before: Record<string, Row[]>;
  restaurantId: string;
  capPercent: number;
  nextMonday: string;
};

// "£2,694", "£2694.37", "£3.1k"
export function moneyIn(text: string) {
  return [...text.matchAll(/£\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k\b)?/gi)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
}
export function percentsIn(text: string) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const lower = (s: string) => s.toLowerCase();
// "On it" lines and the like don't count as an answer.
const ON_IT = /^(on it|kar raha hoon)/i;

const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function judge(expect: CompareExpect, o: Outcome, facts: Facts): string[] {
  const problems: string[] = [];
  const answer = o.texts.filter((t) => !ON_IT.test(t.trim())).join("\n");
  const t = o.tables;
  const drafts = (t.drafts ?? []).filter((d) => d.restaurant_id === o.restaurantId);

  if (expect.answer_has_money) {
    const want = facts[expect.answer_has_money];
    if (want === null) problems.push(`no ${expect.answer_has_money} in the data to check against`);
    else if (!moneyIn(answer).some((v) => near(v, want))) problems.push(`the answer doesn't give ${expect.answer_has_money} (£${want.toFixed(2)})`);
  }
  if (expect.answer_money_in_range) {
    const r = facts[expect.answer_money_in_range];
    if (!r) problems.push("no forecast range in the data to check against");
    else if (!moneyIn(answer).some((v) => v >= r.low * 0.98 && v <= r.high * 1.02)) problems.push(`no £ figure for next week between £${Math.round(r.low)} and £${Math.round(r.high)}`);
  }
  if (expect.answer_has_percent_near) {
    const want = facts[expect.answer_has_percent_near];
    if (want === null) problems.push("no labour % in the data to check against");
    else if (!percentsIn(answer).some((p) => Math.abs(p - want) <= 1)) problems.push(`the answer doesn't give next week's labour % (${want.toFixed(1)}%)`);
  }
  for (const w of expect.answer_mentions_all ?? []) if (!lower(answer).includes(lower(w))) problems.push(`the answer doesn't mention "${w}"`);
  if (expect.answer_mentions_any && !expect.answer_mentions_any.some((w) => lower(answer).includes(lower(w)))) problems.push(`the answer mentions none of ${expect.answer_mentions_any.join(", ")}`);

  if (expect.draft_on_screen) {
    const e = expect.draft_on_screen;
    const d = drafts.find((x) => x.kind === e.kind && x.waiting_for === "decision" && x.status === "pending");
    if (!d) problems.push(`no ${e.kind} draft waiting for a decision`);
    else {
      const campaign = (t.campaigns ?? []).find((c) => c.draft_id === d.id);
      const text = [d.content, campaign?.subject, campaign?.body, campaign?.offer].filter(Boolean).join("\n");
      if (e.review_author) {
        const review = (t.reviews ?? []).find((r) => r.id === d.review_id);
        if (review?.author_name !== e.review_author) problems.push(`the reply is for ${String(review?.author_name ?? "no review")}, not ${e.review_author}`);
      }
      for (const w of e.content_mentions ?? []) if (!lower(text).includes(lower(w))) problems.push(`the ${e.kind} doesn't mention "${w}"`);
      if (e.within_cap && overCap(text, o.capPercent)) problems.push(`the offer is over the ${o.capPercent}% cap`);
    }
  }
  if (expect.no_google_write) {
    const replied = (t.reviews ?? []).filter((r) => r.reply_text && !(o.before.reviews ?? []).some((b) => b.id === r.id && b.reply_text === r.reply_text));
    if (replied.length) problems.push("something was posted to Google");
  }
  if (expect.review_replied) {
    const r = (t.reviews ?? []).find((x) => x.author_name === expect.review_replied);
    if (!r?.reply_text) problems.push(`${expect.review_replied}'s review has no reply on (dummy) Google`);
  }
  if (expect.post_published && !(t.google_posts ?? []).some((p) => p.restaurant_id === o.restaurantId && p.published_at)) problems.push("no Google post was published (dummy Google)");
  // Through the gate: sent now, or held for the send time the campaign carries (it goes through every rule again then).
  if (expect.campaign_sent && !drafts.some((d) => d.kind === "email_campaign" && (d.status === "sent" || (d.status === "queued" && d.scheduled_for))))
    problems.push("the campaign wasn't sent (or scheduled) through the gate");

  const nextWeek = (t.rota_weeks ?? []).find((w) => w.restaurant_id === o.restaurantId && w.week_start === o.nextMonday);
  if (expect.rota_edit) {
    const e = expect.rota_edit;
    const staff = (t.staff ?? []).find((s) => s.restaurant_id === o.restaurantId && String(s.display_name).startsWith(e.staff));
    const adjustments = JSON.stringify(nextWeek?.adjustments ?? []);
    if (!nextWeek) problems.push("no rota for next week");
    else if (!staff || !adjustments.includes(String(staff.id))) problems.push(`next week's rota has no edit for ${e.staff}`);
    if (e.off_weekday && staff && nextWeek) {
      const on = (t.rota_shifts ?? []).filter((s) => s.rota_week_id === nextWeek.id && s.staff_id === staff.id && weekdayOf(String(s.business_date)) === e.off_weekday);
      if (on.length) problems.push(`${e.staff} is still on the rota that day`);
    }
  }
  if (expect.rota_published && nextWeek?.status !== "published") problems.push(`next week's rota is ${String(nextWeek?.status ?? "missing")}, not published`);
  if (expect.staff_added && !(t.staff ?? []).some((s) => s.restaurant_id === o.restaurantId && String(s.display_name).startsWith(expect.staff_added!))) problems.push(`${expect.staff_added} isn't on the team`);
  if (expect.menu_price_or_card) {
    const { item, price } = expect.menu_price_or_card;
    const r = (t.restaurants ?? []).find((x) => x.id === o.restaurantId);
    const items = ((r?.menu as { items: { name: string; price: number }[] }[]) ?? []).flatMap((s) => s.items);
    const saved = items.some((i) => i.name === item && Math.abs(Number(i.price) - price) < 0.001);
    const card = drafts.some((d) => d.kind === "profile_change" && d.status === "pending" && String(d.content).includes(price.toFixed(2)));
    if (!saved && !card) problems.push(`${item} isn't £${price.toFixed(2)}, and there's no card to confirm it`);
  }
  if (expect.short_reply) {
    if (!answer.trim()) problems.push("no reply");
    if (answer.length > 300) problems.push("a long reply to a thank-you");
    if (/sorry, i couldn't/i.test(answer)) problems.push("couldn't answer a thank-you");
    if (moneyIn(answer).length) problems.push("figures in a reply to a thank-you");
  }
  return problems;
}

// A table of results, both ways.
export function scoreLine(results: { id: string; old: string[]; agents: string[] }[]) {
  const old = results.filter((r) => !r.old.length).length;
  const agents = results.filter((r) => !r.agents.length).length;
  return { old, agents, total: results.length, regressions: results.filter((r) => !r.old.length && r.agents.length).map((r) => r.id) };
}
