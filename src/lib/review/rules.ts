// The business review's rules, as pure functions (no database, no AI), so
// tests can prove them: who gets it, when it's ready, what the message says,
// and that every number in the message matches the data.
import { londonParts, londonTime } from "@/lib/clock";
import { DEADLINE_MINUTES, EVENTS_IN_MESSAGE, GREAT_SCORE, MESSAGE_MAX, OPEN_TO_REAL_SITES, PART_AFTER, RECEIPT, SEND_CLAIM_STALE_MINUTES, type Part } from "./config";
import type { PartResults } from "./types";

const MINUTE = 60_000;

// ---------- Who gets it ----------

// Started automatically when onboarding finishes: test and demo sites now; real
// sites once OPEN_TO_REAL_SITES is on (the builder can run it for any site).
export function autoReviewAllowed(r: { is_demo?: boolean | null; is_test?: boolean | null }, open = OPEN_TO_REAL_SITES) {
  return open || Boolean(r.is_demo || r.is_test);
}

// ---------- When it's ready ----------

export type PartStatus = "queued" | "done" | "failed" | "skipped";
export type PartRow = { part: Part; status: PartStatus };

export const deadlineFrom = (startedAt: Date) => new Date(startedAt.getTime() + DEADLINE_MINUTES * MINUTE);

// Ready once every part has finished one way or another, or at the deadline.
export function readyToSend(parts: PartRow[], now: Date, deadline: Date | null) {
  if (deadline && now.getTime() >= deadline.getTime()) return true;
  return parts.length > 0 && parts.every((p) => p.status !== "queued");
}

// A send can be claimed while running, or again if a claim went stale (a crashed worker).
export function canClaimSend(r: { status: string; claimed_at: string | null }, now: Date) {
  if (r.status === "running") return true;
  return r.status === "sending" && (!r.claimed_at || now.getTime() - new Date(r.claimed_at).getTime() > SEND_CLAIM_STALE_MINUTES * MINUTE);
}

// Parts that follow one that just finished. If it failed, only those that can
// run without it still run; the rest are skipped (their sections drop out).
export function partsAfter(part: Part, outcome: "done" | "failed", registered: readonly Part[]) {
  const run: Part[] = [];
  const skip: Part[] = [];
  for (const p of registered) {
    const dep = PART_AFTER[p];
    if (dep?.after !== part) continue;
    if (outcome === "done" || !dep.needs) run.push(p);
    else skip.push(p);
  }
  return { run, skip };
}

// The parts to queue straight away (those not waiting on another).
export const firstParts = (registered: readonly Part[]) => registered.filter((p) => !PART_AFTER[p] || !registered.includes(PART_AFTER[p]!.after));

// ---------- What each part found ----------
// Every number here was counted by code. The message only shows these.

export type ReviewFacts = {
  firstName: string | null;
  restaurant: string;
  link: string;
  connected: boolean; // Google connected (if not: the "Connect Google" line)
  rating?: { rating: number; count: number; nearby?: { average: number; n: number } | null };
  backlog?: { unanswered: number; drafted: number };
  profile?: { score: number; fixes: number; examples: string[] };
  themes?: { praises: string[]; complaint: { label: string; count: number } | null };
  events?: { names: string[]; drafted: number; emailsHeld: boolean };
  poster?: boolean;
  minutesSaved?: number;
};

const one = (n: number) => n.toFixed(1);
export const firstNameOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || null;

// "about 3.5 hours" (to the nearest half hour), "about 45 minutes" under an hour.
export function aboutTime(minutes: number) {
  if (minutes < 60) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const halves = Math.round(minutes / 30) / 2;
  return `about ${halves % 1 === 0 ? halves.toFixed(0) : halves.toFixed(1)} ${halves === 1 ? "hour" : "hours"}`;
}

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// The lines, each written by code. The AI writer (message.ts) may reword them,
// but the numbers it may use are exactly the ones these lines contain.
export function sectionLines(f: ReviewFacts): string[] {
  const lines: string[] = [];
  if (f.rating) {
    const n = f.rating.nearby;
    lines.push(`⭐ ${one(f.rating.rating)} from ${f.rating.count} Google ${f.rating.count === 1 ? "review" : "reviews"}.${n && n.n > 0 ? ` Nearby average: ${one(n.average)} across ${n.n} local ${n.n === 1 ? "rival" : "rivals"}.` : ""}`);
  }
  if (f.backlog) {
    const { unanswered: u, drafted: d } = f.backlog;
    if (u === 0) lines.push("💬 You've replied to every review. Nice work.");
    else {
      const head = u === 1 ? "💬 1 review has no reply." : `💬 ${u} reviews have no reply.`;
      const tail = d >= u ? (u === 1 ? " I've drafted a reply." : " I've drafted replies to all of them.") : d > 0 ? ` I've drafted replies to ${d} so far.` : " I'll draft replies next.";
      lines.push(head + tail);
    }
  }
  if (f.profile) {
    const { score, fixes, examples } = f.profile;
    if (score >= 100) lines.push("📋 Your Google profile scores 100/100. Nothing to fix.");
    else if (score >= GREAT_SCORE) lines.push(`📋 Your Google profile scores ${score}/100, one of the best I've seen.${fixes > 0 ? ` ${fixes === 1 ? "1 small fix is" : `${fixes} small fixes are`} ready.` : ""}`);
    else lines.push(`📋 Your Google profile scores ${score}/100.${fixes > 0 ? ` ${fixes === 1 ? "1 fix is" : `${fixes} fixes are`} ready${examples.length ? `, e.g. ${list(examples.slice(0, 2).map(lowerFirst))}` : ""}.` : ""}`);
  }
  if (f.themes) {
    if (f.themes.praises.length) lines.push(`👍 Customers love: ${list(f.themes.praises.slice(0, 3).map(lowerFirst))}.`);
    const c = f.themes.complaint;
    if (c) lines.push(`👎 Most common complaint: ${lowerFirst(c.label)} (${c.count} ${c.count === 1 ? "review" : "reviews"}).`);
  }
  if (f.events) {
    const names = f.events.names.slice(0, EVENTS_IN_MESSAGE);
    if (!names.length) lines.push("📅 Nothing big in the next 30 days. I'll plan around your quiet days instead.");
    else lines.push(`📅 Coming up: ${list(names)}.${f.events.drafted > 0 ? (f.events.emailsHeld ? " Campaigns drafted (the emails wait until you have subscribers)." : " Campaigns drafted.") : ""}`);
  }
  if (f.poster) lines.push("🪧 Your table QR poster is ready to print.");
  return lines;
}

export const GO_LINE = "Tap Let's go or reply GO and I'll take you through it, one thing at a time.";
export const CONNECT_LINE = "Connect Google and I can reply to your reviews and fix your profile for you.";

export function openingLine(f: Pick<ReviewFacts, "firstName" | "restaurant">) {
  return `Thanks for finishing setup${f.firstName ? `, ${f.firstName}` : ""}. I've reviewed ${f.restaurant} and here's what I found:`;
}

export function closingLines(f: ReviewFacts) {
  const out: string[] = [];
  if (!f.connected) out.push(CONNECT_LINE);
  out.push(`${f.minutesSaved && f.minutesSaved > 0 ? `That's ${aboutTime(f.minutesSaved)} of work done. ` : ""}${GO_LINE} Full review: ${f.link}`);
  return out;
}

// The message written entirely by code: used when the AI writer's version fails a check.
export function fallbackMessage(f: ReviewFacts) {
  return [openingLine(f), "", ...sectionLines(f), "", ...closingLines(f)].join("\n");
}

// Does the review have anything worth sending?
export const hasContent = (f: ReviewFacts) => sectionLines(f).length > 0;

// From the parts' saved results to the message's facts. A part that failed,
// was skipped or hasn't finished gives nothing (its section drops out).
export function factsFromParts(
  parts: { part: Part; status: PartStatus; result: Record<string, unknown> | null }[],
  base: Pick<ReviewFacts, "firstName" | "restaurant" | "link" | "connected"> & { minutesSaved?: number },
): ReviewFacts {
  // Finished, or still going with what it has so far (the reply backlog in batches).
  const done = <P extends Part>(p: P) => {
    const row = parts.find((x) => x.part === p && (x.status === "done" || x.status === "queued"));
    return (row?.result ?? null) as PartResults[P] | null;
  };
  const f: ReviewFacts = { ...base };
  const sync = done("reviews_sync");
  const rivals = done("rivals");
  const ours = sync?.connected && sync.rating !== null && sync.total ? { rating: sync.rating, count: sync.total } : rivals?.ours ?? null;
  if (ours && ours.count > 0) f.rating = { ...ours, nearby: rivals?.nearby ?? null };
  const backlog = done("backlog");
  if (backlog && base.connected) f.backlog = { unanswered: backlog.unanswered, drafted: backlog.drafted };
  const profile = done("profile");
  if (profile && base.connected) f.profile = { score: profile.score, fixes: profile.fixes, examples: profile.examples };
  const themes = done("themes");
  if (themes && !themes.skipped && (themes.praises.length || themes.complaint)) f.themes = { praises: themes.praises, complaint: themes.complaint };
  const events = done("events");
  if (events) f.events = events;
  if (done("poster")?.ready) f.poster = true;
  return f;
}

// ---------- The number check ----------

// Numbers a message may contain: exactly those in the code-written lines (and
// any inside names: the restaurant, dishes, events).
export function allowedNumbers(f: ReviewFacts) {
  return new Set(numbersIn(fallbackMessage(f)));
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
export const numbersIn = (text: string) => (text.replace(/https?:\/\/\S+/g, " ").match(NUMBER) ?? []).map((n) => n.replace(",", "."));

// What's wrong with a message (empty = it can go). Every number must be one the
// data gave; it must fit WhatsApp; it must keep every section the data has, the
// link and the GO line, and add no section the data doesn't have.
export function messageProblems(text: string, f: ReviewFacts): string[] {
  const problems: string[] = [];
  if (text.length > MESSAGE_MAX) problems.push(`It's ${text.length} characters; the most is ${MESSAGE_MAX}.`);
  const allowed = allowedNumbers(f);
  const wrong = [...new Set(numbersIn(text).filter((n) => !allowed.has(n)))];
  if (wrong.length) problems.push(`These numbers aren't in the data: ${wrong.join(", ")}.`);
  // Each number from the data appears as often as the code-written lines use it (none dropped or changed).
  const need = countOf(numbersIn(fallbackMessage(f)));
  const have = countOf(numbersIn(text));
  for (const [n, k] of need) if ((have.get(n) ?? 0) < k) problems.push(`The number ${n} from the data is missing.`);
  if (!text.includes(f.link)) problems.push("The link to the full review is missing.");
  if (!/\bGO\b/.test(text)) problems.push("The GO line is missing.");
  const expected = new Set(sectionLines(f).map((l) => [...l][0]));
  for (const emoji of ["⭐", "💬", "📋", "👍", "👎", "📅", "🪧"]) {
    if (expected.has(emoji) && !text.includes(emoji)) problems.push(`The ${emoji} line is missing.`);
    if (!expected.has(emoji) && text.includes(emoji)) problems.push(`There's a ${emoji} line, but there's no data for it.`);
  }
  if (!f.connected && !text.includes("Connect Google")) problems.push("The Connect Google line is missing.");
  return problems;
}

function countOf(items: string[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

// ---------- Review replies ----------

type CheckedDraft = {
  kind: string;
  status: string;
  checks?: object | null;
  agent_check?: { verdict: string } | null;
};
const PASSING = new Set(["pass", "fixed"]);

// Passed every check it had: each of the four checks that ran passed (or fixed
// something), at least one ran, and the checker agent (if it looked) passed it.
export function passedEveryCheck(d: CheckedDraft) {
  const checks = (d.checks ?? {}) as Record<string, { status?: string } | undefined>;
  const results = ["tone", "facts", "compliance", "money"].map((n) => checks[n]).filter(Boolean) as { status: string }[];
  if (!results.length || !results.every((r) => PASSING.has(r.status))) return false;
  return !d.agent_check || d.agent_check.verdict === "pass";
}

// Approve all: only 4 to 5 star replies still waiting that passed every check.
// 1 to 3 star replies, questions, and anything a check flagged go one by one.
export function approveAllSet<D extends CheckedDraft & { rating: number | null }>(drafts: D[]) {
  return drafts.filter((d) => d.kind === "review_reply" && d.status === "pending" && (d.rating ?? 0) >= 4 && passedEveryCheck(d));
}

// ---------- The evening receipt ----------

// 8pm, or 2 hours after the review if that's later; never after 9pm (UK time).
// null: too late today, so it goes in the next morning brief instead.
export function receiptTime(sentAt: Date): Date | null {
  const p = londonParts(sentAt);
  const evening = londonTime(p.year, p.month, p.day, RECEIPT.hour, 0);
  const latest = londonTime(p.year, p.month, p.day, RECEIPT.latestHour, 0);
  const at = new Date(Math.max(evening.getTime(), sentAt.getTime() + RECEIPT.minHoursAfter * 3_600_000));
  return at.getTime() <= latest.getTime() ? at : null;
}

export type ReceiptCounts = {
  posted: { replies: number; profile: boolean; posts: number; campaigns: number };
  waiting: { replies: number; profile: number; posts: number; campaigns: number };
  minutes: number;
};

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export function receiptText(c: ReceiptCounts): string {
  const done = [
    ...(c.posted.replies ? [n(c.posted.replies, "review reply", "review replies")] : []),
    ...(c.posted.profile ? ["your Google profile fixes"] : []),
    ...(c.posted.posts ? [n(c.posted.posts, "Google post", "Google posts")] : []),
    ...(c.posted.campaigns ? [n(c.posted.campaigns, "email campaign", "email campaigns")] : []),
  ];
  const left = [
    ...(c.waiting.replies ? [n(c.waiting.replies, "review reply", "review replies")] : []),
    ...(c.waiting.profile ? ["your profile fixes"] : []),
    ...(c.waiting.posts ? [n(c.waiting.posts, "Google post", "Google posts")] : []),
    ...(c.waiting.campaigns ? [n(c.waiting.campaigns, "campaign", "campaigns")] : []),
  ];
  return [
    "🧾 *Your business review, so far*",
    "",
    done.length ? `✅ Approved and on their way: ${list(done)}.` : "✅ Nothing approved yet.",
    left.length ? `⏳ Still waiting for you: ${list(left)}. They're in tomorrow morning's brief.` : "⏳ Nothing left waiting. 🎉",
    ...(c.minutes > 0 ? [`⏱️ That's ${aboutTime(c.minutes)} of work saved.`] : []),
  ].join("\n");
}
