// The founder dashboard's sums, as plain code with no imports from the app
// (tests/founder-metrics.test.ts). lib/founder/data.ts loads the rows; this file
// turns them into the numbers on /admin. Definitions are on the page (the (i) by
// each tile) and in the plan (Claude Doc "DinerAI founder dashboard plan").
//
// A client's billing over time is a timeline of standings (billing_history), e.g.
//   trialing (1 Nov) -> active (1 Dec) -> ended (3 Mar)
// Standings: exempt | pilot | trialing | active | past_due | none | ended | closed.

export type Standing = "exempt" | "pilot" | "trialing" | "active" | "past_due" | "none" | "ended" | "closed";
export const PAYING: ReadonlySet<string> = new Set(["active", "past_due"]);
const STARTED: ReadonlySet<string> = new Set(["trialing", "active", "past_due", "pilot"]);
const GONE: ReadonlySet<string> = new Set(["ended", "closed", "none"]);

export type HistoryRow = {
  restaurant_id: string;
  at: string;
  kind: "standing" | "payment";
  standing: string | null;
  amount_pence: number | null;
  store_fee_pence: number | null;
  tax_pence?: number | null;
};

export type Point = { at: number; standing: string };

const DAY = 86_400_000;
export const MONTH_DAYS = 30.4375;

// The client's standings in time order. With no history (signed up before 070 or
// by a route the webhooks don't see), today's standing counts from the start; if
// the last recorded standing isn't today's (a missed event), today's is added now.
export function timelineFor(rows: HistoryRow[], current: string, createdAt: string, now: Date): Point[] {
  const points = rows
    .filter((r) => r.kind === "standing" && r.standing)
    .map((r) => ({ at: Date.parse(r.at), standing: r.standing! }))
    .sort((a, b) => a.at - b.at);
  const out: Point[] = [];
  for (const p of points) if (!out.length || out[out.length - 1].standing !== p.standing) out.push(p);
  if (!out.length) return [{ at: Date.parse(createdAt), standing: current }];
  // A closed account has no restaurant row any more, so no "current": keep the history.
  if (current !== "closed" && out[out.length - 1].standing !== current && !(current === "none" && out[out.length - 1].standing === "closed")) {
    out.push({ at: Math.max(now.getTime(), out[out.length - 1].at), standing: current });
  }
  return out;
}

export function standingAt(t: Point[], when: number): string {
  let s = "none";
  for (const p of t) {
    if (p.at > when) break;
    s = p.standing;
  }
  return s;
}

// Calendar months (UTC), oldest first, the last one being this month.
export function monthStarts(now: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  return out;
}
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
export const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

// When the client first started (a trial, paid month or pilot), or null.
export function startedAt(t: Point[]): number | null {
  return t.find((p) => STARTED.has(p.standing))?.at ?? null;
}
export function firstPaidAt(t: Point[]): number | null {
  return t.find((p) => PAYING.has(p.standing))?.at ?? null;
}

// Days spent paying, up to `until`.
export function paidDays(t: Point[], until: number): number {
  let days = 0;
  t.forEach((p, i) => {
    if (!PAYING.has(p.standing) || p.at >= until) return;
    const end = Math.min(t[i + 1]?.at ?? until, until);
    days += Math.max(0, end - p.at) / DAY;
  });
  return days;
}

export type MonthRow = {
  key: string;
  label: string;
  newClients: number;
  payingAtStart: number;
  payingAtEnd: number;
  churned: number; // paying at the start, not paying (ended or closed) by the end
  churnRate: number | null; // churned / paying at the start
  trialsEnded: number;
  converted: number;
  conversionRate: number | null; // converted / trials ended
  revenuePence: number; // what customers paid (VAT included)
  revenueAfterFeesPence: number; // less Apple's / Google's cut
  vatPence: number;
};

// The overview's monthly charts, over the last `count` months.
export function monthly(clients: { timeline: Point[]; payments: HistoryRow[] }[], now: Date, count = 12): MonthRow[] {
  return monthStarts(now, count).map((start) => {
    const s = start.getTime();
    const e = Math.min(nextMonth(start).getTime(), now.getTime());
    let newClients = 0, payingAtStart = 0, payingAtEnd = 0, churned = 0, trialsEnded = 0, converted = 0, revenue = 0, fees = 0, vat = 0;
    for (const c of clients) {
      const t = c.timeline;
      const started = startedAt(t);
      if (started !== null && started >= s && started < e) newClients++;
      const wasPaying = PAYING.has(standingAt(t, s - 1));
      const endStanding = standingAt(t, e - 1);
      if (wasPaying) payingAtStart++;
      if (PAYING.has(endStanding)) payingAtEnd++;
      if (wasPaying && GONE.has(endStanding)) churned++;
      // Each trial that ended this month: did the next standing pay?
      t.forEach((p, i) => {
        const next = t[i + 1];
        if (p.standing !== "trialing" || !next || next.at < s || next.at >= e) return;
        trialsEnded++;
        if (PAYING.has(next.standing)) converted++;
      });
      for (const p of c.payments) {
        const at = Date.parse(p.at);
        if (at < s || at >= e) continue;
        revenue += p.amount_pence ?? 0;
        fees += p.store_fee_pence ?? 0;
        vat += p.tax_pence ?? 0;
      }
    }
    return {
      key: monthKey(start),
      label: monthLabel(start),
      newClients,
      payingAtStart,
      payingAtEnd,
      churned,
      churnRate: payingAtStart ? churned / payingAtStart : null,
      trialsEnded,
      converted,
      conversionRate: trialsEnded ? converted / trialsEnded : null,
      revenuePence: revenue,
      revenueAfterFeesPence: revenue - fees,
      vatPence: vat,
    };
  });
}

// Average months paid per client who ever paid (those still paying count up to
// today), and the share still paying 1, 3 and 6 months after their first payment
// (only clients whose first payment is at least that long ago).
export function retention(timelines: Point[][], now: Date) {
  const payers = timelines.filter((t) => firstPaidAt(t) !== null);
  const avgMonths = payers.length ? payers.reduce((n, t) => n + paidDays(t, now.getTime()), 0) / payers.length / MONTH_DAYS : null;
  const after = (months: number) => {
    const span = months * MONTH_DAYS * DAY;
    const eligible = payers.filter((t) => firstPaidAt(t)! + span <= now.getTime());
    if (!eligible.length) return { months, eligible: 0, rate: null as number | null };
    const kept = eligible.filter((t) => PAYING.has(standingAt(t, firstPaidAt(t)! + span))).length;
    return { months, eligible: eligible.length, rate: kept / eligible.length };
  };
  return { payers: payers.length, avgMonths, still: [after(1), after(3), after(6)] };
}

// Monthly recurring revenue today: each paying client's last payment in the last
// 40 days (what they really pay: FOUNDER, full price, store), else the list price.
export function mrr(clients: { standing: string; payments: HistoryRow[] }[], now: Date, listPricePence: number) {
  let pence = 0, afterFees = 0, estimated = 0;
  const since = now.getTime() - 40 * DAY;
  for (const c of clients) {
    if (!PAYING.has(c.standing)) continue;
    const last = c.payments.filter((p) => Date.parse(p.at) >= since && (p.amount_pence ?? 0) > 0).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (last) {
      pence += last.amount_pence ?? 0;
      afterFees += (last.amount_pence ?? 0) - (last.store_fee_pence ?? 0);
    } else {
      estimated++;
      pence += listPricePence;
      afterFees += listPricePence;
    }
  }
  // £99 includes 20% VAT: a sixth of it is VAT.
  return { pence, afterFeesPence: afterFees, vatPence: Math.round(pence / 6), estimated };
}

// ---------- Health of one client ----------

export type HealthSignals = {
  standing: string;
  active: boolean;
  setupFinished: boolean;
  paymentFailed: boolean;
  googleBroken: boolean;
  deadJobs: number; // last 30 days
  failedJobs7d: number; // retries in the last 7 days
  briefMissing: boolean; // an active restaurant with no brief for 2 days (and none waiting)
  lastSeenAt: string | null; // the owner's last message, tap or approval
  trialEndsAt: string | null;
  approvals7d: number;
  setupGaps: number;
  unanswered7d: number;
  bounces30d: number;
  agentsShadow: number; // agents set live but held back in shadow
  closing: boolean;
};

export type Health = { light: "green" | "amber" | "red"; reasons: { tone: "red" | "amber"; text: string }[] };

export function healthOf(s: HealthSignals, now: Date): Health {
  const reasons: Health["reasons"] = [];
  const red = (text: string) => reasons.push({ tone: "red", text });
  const amber = (text: string) => reasons.push({ tone: "amber", text });
  if (s.closing) red("Account closing in progress");
  if (s.paymentFailed || s.standing === "past_due") red("Payment failed");
  if (s.googleBroken) red("Google login broken (needs reconnecting)");
  if (s.deadJobs) red(`${s.deadJobs} failed job${s.deadJobs === 1 ? "" : "s"} gave up (last 30 days)`);
  if (s.briefMissing) red("No morning brief for 2 days");
  const silentDays = s.lastSeenAt ? Math.floor((now.getTime() - Date.parse(s.lastSeenAt)) / DAY) : null;
  if (s.active && (silentDays === null || silentDays >= 7)) amber(silentDays === null ? "Never used it yet" : `Quiet for ${silentDays} days`);
  if (s.trialEndsAt && s.standing === "trialing") {
    const left = Math.ceil((Date.parse(s.trialEndsAt) - now.getTime()) / DAY);
    if (left >= 0 && left <= 3 && s.approvals7d < 3) amber(`Trial ends in ${left} day${left === 1 ? "" : "s"} with little use`);
  }
  if (!s.setupFinished && STARTED.has(s.standing)) amber("Setup not finished");
  if (s.failedJobs7d >= 3) amber(`${s.failedJobs7d} jobs retried this week`);
  if (s.unanswered7d) amber(`${s.unanswered7d} question${s.unanswered7d === 1 ? "" : "s"} DinerAI couldn't answer (7 days)`);
  if (s.bounces30d) amber(`${s.bounces30d} email${s.bounces30d === 1 ? "" : "s"} bounced (30 days)`);
  if (s.agentsShadow) amber(`${s.agentsShadow} assistant${s.agentsShadow === 1 ? "" : "s"} held back (setup details missing)`);
  if (s.setupGaps) amber(`${s.setupGaps} setup gap${s.setupGaps === 1 ? "" : "s"}`);
  const light = reasons.some((r) => r.tone === "red") ? "red" : reasons.length ? "amber" : "green";
  return { light, reasons };
}

// What the overview and the list call each standing.
export const STANDING_LABEL: Record<string, string> = {
  exempt: "Free (exempt)",
  pilot: "Pilot",
  trialing: "Free trial",
  active: "Paying",
  past_due: "Payment failed",
  none: "In setup",
  ended: "Cancelled",
  closed: "Closed",
};

// "£1,234" / "£12.50"
export function pounds(pence: number, { exact = false }: { exact?: boolean } = {}) {
  const v = pence / 100;
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 })}`;
}
export const pct = (x: number | null, digits = 0) => (x === null ? "–" : `${(x * 100).toFixed(digits)}%`);

// Change against the month before, for a tile: "+3" / "−1" / "+12%".
export function delta(now: number, before: number, kind: "count" | "pence" | "rate" = "count") {
  const d = now - before;
  if (!d) return null;
  const sign = d > 0 ? "+" : "−";
  const abs = Math.abs(d);
  const text = kind === "pence" ? pounds(abs) : kind === "rate" ? `${(abs * 100).toFixed(0)} pts` : String(abs);
  return { dir: (d > 0 ? "up" : "down") as "up" | "down", text: `${sign}${text}` };
}

// The setup funnel: how many got at least as far as each stage, of all real
// sign-ups. A client counts for every stage up to the furthest one it reached (older
// restaurants finished a setup without some of today's steps), so it never widens.
export type FunnelFlags = { setupStarted: boolean; googleLinked: boolean; menuDone: boolean; setupFinished: boolean; firstApproval: boolean; firstPaid: boolean };
const STAGES: [string, keyof FunnelFlags | null][] = [
  ["Signed up", null],
  ["Setup started", "setupStarted"],
  ["Google linked", "googleLinked"],
  ["Menu done", "menuDone"],
  ["Setup finished", "setupFinished"],
  ["First approval", "firstApproval"],
  ["First paid month", "firstPaid"],
];
export function funnel(clients: FunnelFlags[]) {
  const furthest = clients.map((c) => STAGES.reduce((best, [, k], i) => (k && c[k] ? i : best), 0));
  return STAGES.map(([label], i) => ({ label, count: furthest.filter((f) => f >= i).length }));
}
