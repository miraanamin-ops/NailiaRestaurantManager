import "server-only";
import { billingStanding } from "@/lib/billing/access";
import { PRICE_GBP, FOUNDER } from "@/lib/billing/config";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import {
  firstPaidAt,
  funnel,
  healthOf,
  monthly,
  monthStarts,
  monthKey,
  mrr,
  PAYING,
  retention,
  timelineFor,
  type Health,
  type HistoryRow,
  type Point,
} from "./metrics";

// Everything the founder dashboard (/admin) shows, loaded with the secret key
// across every restaurant (the founder sees all; lib/founder/access.ts decides who
// that is). Real clients only unless `includeTest`: demo, test and Pilot Zero
// restaurants are left out of every number.

const DAY = 86_400_000;
const db = () => getSupabase();

// Pages through a query past Supabase's 1,000-row limit.
async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) {
      // A table that isn't there yet (a migration not run) reads as empty.
      if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42883" || error.code === "PGRST202") return out;
      throw new Error(error.message);
    }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const { data, error } = await db().rpc(name, args);
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") return [];
    throw new Error(`${name}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

const CLIENT_COLUMNS =
  "id, name, slug, created_at, active, paused, is_demo, is_test, pilot_zero, owner_name, owner_email, owner_whatsapp, phone, address, cuisine, billing_exempt, pilot_invite_code, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, payment_failed_at, stripe_customer_id, store_status, store_platform, store_period_end, store_cancel_at_period_end, app_since, referral_code, referred_by, referral_credited_at, google_location_id, google_linked_at, last_brief_on, brief_waiting_since";

export type ClientRow = Pick<
  Restaurant,
  | "id" | "name" | "slug" | "active" | "paused" | "owner_name" | "owner_email" | "owner_whatsapp" | "phone" | "address" | "cuisine"
  | "billing_exempt" | "pilot_invite_code" | "subscription_status" | "trial_ends_at" | "current_period_end" | "cancel_at_period_end"
  | "payment_failed_at" | "stripe_customer_id" | "store_status" | "store_platform" | "store_period_end" | "store_cancel_at_period_end"
  | "app_since" | "referral_code" | "referred_by" | "referral_credited_at" | "last_brief_on" | "brief_waiting_since" | "pilot_zero"
> & { created_at: string; is_demo: boolean | null; is_test: boolean | null; google_location_id: string | null; google_linked_at: string | null };

export const isTestSite = (r: { is_demo?: boolean | null; is_test?: boolean | null; pilot_zero?: boolean | null }) => Boolean(r.is_demo || r.is_test || r.pilot_zero);

export type Settings = { usdToGbp: number; whatsappPence: number; emailPence: number };
export const DEFAULT_SETTINGS: Settings = { usdToGbp: 0.79, whatsappPence: 1, emailPence: 0.1 };

export async function loadSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: unknown }>((a, b) => db().from("founder_settings").select("key, value").range(a, b));
  const get = (k: keyof Settings) => {
    const v = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SETTINGS[k];
  };
  return { usdToGbp: get("usdToGbp"), whatsappPence: get("whatsappPence"), emailPence: get("emailPence") };
}

export type FixedCost = { id: string; name: string; monthly_pence: number; starts_on: string; ends_on: string | null; note: string | null };
export async function loadFixedCosts() {
  return all<FixedCost>((a, b) => db().from("founder_costs").select("id, name, monthly_pence, starts_on, ends_on, note").order("name").range(a, b));
}
// The fixed bills that ran in a month (any day of it).
export function fixedForMonth(costs: FixedCost[], monthStart: Date) {
  const start = monthKey(monthStart) + "-01";
  const end = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return costs.filter((c) => c.starts_on <= end && (!c.ends_on || c.ends_on >= start)).reduce((n, c) => n + c.monthly_pence, 0);
}

// ---------- One client's state, for the list and the overview ----------

export type Client = {
  r: ClientRow;
  standing: string;
  timeline: Point[];
  payments: HistoryRow[];
  setupStarted: boolean;
  setupFinishedAt: string | null;
  menuDone: boolean;
  lastSeenAt: string | null;
  firstApprovalAt: string | null;
  approvals7d: number;
  monthsActive: number;
  monthsPaid: number;
  trialEndsAt: string | null;
  aiCostMonthUsd: number;
  aiCostAllUsd: number;
  referred: number;
  referredPaying: number;
  closing: boolean;
  health: Health;
};

type CostRow = { month: string; restaurant_id: string | null; purpose: string; calls: number; cost_usd: number };
type ActivityRow = { month: string; restaurant_id: string; metric: string; n: number };

export async function loadClients({ includeTest = false, now = new Date() }: { includeTest?: boolean; now?: Date } = {}) {
  const everyone = await all<ClientRow>((a, b) => db().from("restaurants").select(CLIENT_COLUMNS).order("created_at").range(a, b));
  const restaurants = everyone.filter((r) => includeTest || !isTestSite(r));
  const testIds = new Set(everyone.filter((r) => !restaurants.includes(r)).map((r) => r.id));
  const ids = restaurants.map((r) => r.id);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const monthStart = monthStarts(now, 1)[0];

  const none = ["00000000-0000-0000-0000-000000000000"];
  const scope = ids.length ? ids : none;
  const [history, sessions, steps, last, dead, retried, google, unanswered, bounces, gaps, closures, approvals, costs, allHistory] = await Promise.all([
    all<HistoryRow>((a, b) => db().from("billing_history").select("restaurant_id, at, kind, standing, amount_pence, store_fee_pence, tax_pence").in("restaurant_id", scope).order("at").range(a, b)),
    all<{ restaurant_id: string; started_at: string; completed_at: string | null }>((a, b) => db().from("onboarding_sessions").select("restaurant_id, started_at, completed_at").in("restaurant_id", scope).range(a, b)),
    all<{ restaurant_id: string; step_key: string; status: string }>((a, b) => db().from("onboarding_steps").select("restaurant_id, step_key, status").in("restaurant_id", scope).eq("step_key", "menu").range(a, b)),
    rpc<{ restaurant_id: string; last_in: string | null; last_approval: string | null; first_approval: string | null }>("founder_last_activity"),
    all<{ restaurant_id: string }>((a, b) => db().from("jobs").select("restaurant_id").in("restaurant_id", scope).eq("status", "dead").gte("created_at", since30).range(a, b)),
    all<{ restaurant_id: string }>((a, b) => db().from("jobs").select("restaurant_id").in("restaurant_id", scope).gt("attempts", 1).gte("created_at", since7).range(a, b)),
    all<{ restaurant_id: string; status: string }>((a, b) => db().from("google_connections").select("restaurant_id, status").in("restaurant_id", scope).range(a, b)),
    all<{ restaurant_id: string }>((a, b) => db().from("unanswered_questions").select("restaurant_id").in("restaurant_id", scope).gte("created_at", since7).range(a, b)),
    all<{ restaurant_id: string }>((a, b) => db().from("email_suppressions").select("restaurant_id").in("restaurant_id", scope).eq("reason", "hard_bounce").gte("created_at", since30).range(a, b)),
    all<{ restaurant_id: string }>((a, b) => db().from("setup_gaps").select("restaurant_id").in("restaurant_id", scope).is("resolved_at", null).eq("dismissed", false).range(a, b)),
    all<{ restaurant_id: string; status: string }>((a, b) => db().from("account_closures").select("restaurant_id, status").in("restaurant_id", scope).in("status", ["requested", "scheduled", "closing", "failed"]).range(a, b)),
    all<{ restaurant_id: string }>((a, b) => db().from("drafts").select("restaurant_id").in("restaurant_id", scope).gte("approved_at", since7).range(a, b)),
    rpc<CostRow>("founder_monthly_costs", { p_since: "2020-01-01T00:00:00Z" }),
    // Closed accounts have no restaurant row, but their history still counts.
    all<HistoryRow>((a, b) => db().from("billing_history").select("restaurant_id, at, kind, standing, amount_pence, store_fee_pence, tax_pence").eq("standing", "closed").range(a, b)),
  ]);

  const by = <T extends { restaurant_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const row of rows) if (row.restaurant_id) m.set(row.restaurant_id, [...(m.get(row.restaurant_id) ?? []), row]);
    return m;
  };
  const historyBy = by(history);
  const count = <T extends { restaurant_id: string | null }>(rows: T[]) => {
    const m = new Map<string, number>();
    for (const row of rows) if (row.restaurant_id) m.set(row.restaurant_id, (m.get(row.restaurant_id) ?? 0) + 1);
    return m;
  };
  const deadN = count(dead), retriedN = count(retried), unansweredN = count(unanswered), bouncesN = count(bounces), gapsN = count(gaps), approvalsN = count(approvals);
  const sessionOf = new Map(sessions.map((s) => [s.restaurant_id, s]));
  const menuDone = new Set(steps.filter((s) => s.status === "done" || s.status === "partial").map((s) => s.restaurant_id));
  const lastOf = new Map(last.map((l) => [l.restaurant_id, l]));
  const googleBroken = new Set(google.filter((g) => g.status === "needs_reconnect").map((g) => g.restaurant_id));
  const closing = new Set(closures.map((c) => c.restaurant_id));
  const thisMonth = monthKey(monthStart);
  const costAll = new Map<string, number>(), costMonth = new Map<string, number>();
  for (const c of costs) {
    if (!c.restaurant_id) continue;
    costAll.set(c.restaurant_id, (costAll.get(c.restaurant_id) ?? 0) + Number(c.cost_usd));
    if (c.month.slice(0, 7) === thisMonth) costMonth.set(c.restaurant_id, (costMonth.get(c.restaurant_id) ?? 0) + Number(c.cost_usd));
  }

  const clients: Client[] = restaurants.map((r) => {
    const standing = billingStanding(r).standing;
    const rows = historyBy.get(r.id) ?? [];
    const timeline = timelineFor(rows, standing, r.created_at, now);
    const session = sessionOf.get(r.id);
    const l = lastOf.get(r.id);
    const lastSeenAt = [l?.last_in, l?.last_approval].filter(Boolean).sort().pop() ?? null;
    const trialEndsAt = standing === "trialing" ? (r.subscription_status === "trialing" ? r.trial_ends_at : r.store_period_end) ?? null : null;
    const setupFinishedAt = session?.completed_at ?? (r.active ? r.created_at : null);
    const startedTs = timeline.find((p) => p.standing !== "none")?.at ?? Date.parse(r.created_at);
    const referredRows = restaurants.filter((x) => x.referred_by === r.id);
    const briefMissing = Boolean(r.active && !r.paused && !r.brief_waiting_since && r.last_brief_on && Date.parse(r.last_brief_on) < now.getTime() - 2 * DAY);
    const health = healthOf(
      {
        standing,
        active: Boolean(r.active),
        setupFinished: Boolean(setupFinishedAt),
        paymentFailed: Boolean(r.payment_failed_at) && standing === "past_due",
        googleBroken: googleBroken.has(r.id),
        deadJobs: deadN.get(r.id) ?? 0,
        failedJobs7d: retriedN.get(r.id) ?? 0,
        briefMissing,
        lastSeenAt,
        trialEndsAt,
        approvals7d: approvalsN.get(r.id) ?? 0,
        setupGaps: gapsN.get(r.id) ?? 0,
        unanswered7d: unansweredN.get(r.id) ?? 0,
        bounces30d: bouncesN.get(r.id) ?? 0,
        agentsShadow: 0,
        closing: closing.has(r.id),
      },
      now,
    );
    return {
      r,
      standing,
      timeline,
      payments: rows.filter((h) => h.kind === "payment"),
      setupStarted: Boolean(session) || Boolean(r.active),
      setupFinishedAt,
      menuDone: menuDone.has(r.id),
      lastSeenAt,
      firstApprovalAt: l?.first_approval ?? null,
      approvals7d: approvalsN.get(r.id) ?? 0,
      monthsActive: r.active || standing !== "none" ? Math.max(0, (now.getTime() - startedTs) / DAY / 30.4375) : 0,
      monthsPaid: timeline.some((p) => PAYING.has(p.standing)) ? paidMonths(timeline, now) : 0,
      trialEndsAt,
      aiCostMonthUsd: costMonth.get(r.id) ?? 0,
      aiCostAllUsd: costAll.get(r.id) ?? 0,
      referred: referredRows.length,
      referredPaying: referredRows.filter((x) => PAYING.has(billingStanding(x).standing)).length,
      closing: closing.has(r.id),
      health,
    };
  });

  // Closed accounts (no restaurant row any more) still count in churn and history.
  const known = new Set(restaurants.map((r) => r.id));
  const closedIds = [...new Set(allHistory.map((h) => h.restaurant_id))].filter((id) => !known.has(id));
  const closedRows = closedIds.length
    ? await all<HistoryRow>((a, b) => db().from("billing_history").select("restaurant_id, at, kind, standing, amount_pence, store_fee_pence, tax_pence").in("restaurant_id", closedIds).order("at").range(a, b))
    : [];
  const closedHistory = by(closedRows);
  const closed = closedIds.map((id) => {
    const rows = closedHistory.get(id) ?? [];
    return { id, timeline: timelineFor(rows, "closed", rows[0]?.at ?? now.toISOString(), now), payments: rows.filter((h) => h.kind === "payment") };
  });
  return { clients, closed, costs, testIds };
}

function paidMonths(t: Point[], now: Date) {
  let days = 0;
  t.forEach((p, i) => {
    if (!PAYING.has(p.standing)) return;
    days += Math.max(0, (t[i + 1]?.at ?? now.getTime()) - p.at) / DAY;
  });
  return days / 30.4375;
}

// ---------- The overview ----------

export async function loadOverview({ includeTest = false, now = new Date() }: { includeTest?: boolean; now?: Date } = {}) {
  const [{ clients, closed, costs, testIds }, settings, fixed, activity, founderUses, alerts7d] = await Promise.all([
    loadClients({ includeTest, now }),
    loadSettings(),
    loadFixedCosts(),
    rpc<ActivityRow>("founder_monthly_activity", { p_since: monthStarts(now, 12)[0].toISOString() }),
    db().from("founder_claims").select("restaurant_id", { count: "exact", head: true }).then((r) => r.count ?? 0),
    db().from("builder_alerts").select("id", { count: "exact", head: true }).gte("created_at", new Date(now.getTime() - 7 * DAY).toISOString()).then((r) => r.count ?? 0),
  ]);
  // Dead jobs this week: system jobs and real clients' (not test sites').
  const realList = clients.map((c) => c.r.id);
  const dead7d = (
    await db()
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .or(realList.length ? `restaurant_id.is.null,restaurant_id.in.(${realList.join(",")})` : "restaurant_id.is.null")
      .eq("status", "dead")
      .gte("created_at", new Date(now.getTime() - 7 * DAY).toISOString())
  ).count ?? 0;
  const realIds = new Set(clients.map((c) => c.r.id));
  const live = clients.filter((c) => !c.closing);
  const isActive = (c: Client) => Boolean(c.r.active) && billingStanding(c.r).ok;

  const counts = {
    active: live.filter(isActive).length,
    trialing: live.filter((c) => isActive(c) && c.standing === "trialing").length,
    paying: live.filter((c) => PAYING.has(c.standing)).length,
    pilot: live.filter((c) => isActive(c) && (c.standing === "pilot" || c.standing === "exempt")).length,
    inSetup: live.filter((c) => !c.r.active && !["ended", "closed"].includes(c.standing)).length,
    pastDue: live.filter((c) => c.standing === "past_due").length,
  };

  const series = [...clients.map((c) => ({ timeline: c.timeline, payments: c.payments })), ...closed];
  const months = monthly(series, now, 12);
  const ret = retention(series.map((s) => s.timeline), now);
  const money = mrr(live.map((c) => ({ standing: c.standing, payments: c.payments })), now, PRICE_GBP * 100);

  // Claude costs per month (all restaurants, or the real clients + unattributed).
  const starts = monthStarts(now, 12);
  // Test sites left out; unattributed calls and closed accounts stay in.
  const costRows = costs.filter((c) => !c.restaurant_id || !testIds.has(c.restaurant_id));
  const aiByMonth = starts.map((s) => costRows.filter((c) => c.month.slice(0, 7) === monthKey(s)).reduce((n, c) => n + Number(c.cost_usd), 0));
  const thisMonth = monthKey(starts[starts.length - 1]);
  const byPurpose = new Map<string, { usd: number; calls: number }>();
  for (const c of costRows) {
    if (c.month.slice(0, 7) !== thisMonth) continue;
    const k = purposeGroup(c.purpose);
    const v = byPurpose.get(k) ?? { usd: 0, calls: 0 };
    byPurpose.set(k, { usd: v.usd + Number(c.cost_usd), calls: v.calls + Number(c.calls) });
  }
  const unattributedUsd = costRows.filter((c) => c.month.slice(0, 7) === thisMonth && !c.restaurant_id).reduce((n, c) => n + Number(c.cost_usd), 0);

  // Messages and emails per month: estimated costs.
  const act = activity.filter((a) => includeTest || realIds.has(a.restaurant_id));
  const sumAct = (metric: string, key: string) => act.filter((a) => a.metric === metric && a.month.slice(0, 7) === key).reduce((n, a) => n + Number(a.n), 0);
  const costMonths = starts.map((s, i) => {
    const key = monthKey(s);
    const aiPence = aiByMonth[i] * settings.usdToGbp * 100;
    const whatsappPence = sumAct("whatsapp_out", key) * settings.whatsappPence;
    const emailPence = sumAct("emails", key) * settings.emailPence;
    const fixedPence = fixedForMonth(fixed, s);
    return { key, aiPence, whatsappPence, emailPence, fixedPence, totalPence: aiPence + whatsappPence + emailPence + fixedPence };
  });

  // Engagement: active clients who approved something this week.
  const activeClients = live.filter(isActive);
  const engaged = activeClients.filter((c) => c.approvals7d > 0).length;
  const ttv = clients
    .filter((c) => c.firstApprovalAt)
    .map((c) => (Date.parse(c.firstApprovalAt!) - Date.parse(c.r.created_at)) / DAY)
    .sort((a, b) => a - b);
  const median = ttv.length ? ttv[Math.floor(ttv.length / 2)] : null;

  const attention = clients
    .filter((c) => c.health.light !== "green" && (c.r.active || c.standing === "trialing" || c.standing === "past_due" || c.closing))
    .sort((a, b) => (a.health.light === b.health.light ? 0 : a.health.light === "red" ? -1 : 1));
  const trialsEnding = live
    .filter((c) => c.trialEndsAt && Date.parse(c.trialEndsAt) >= now.getTime() && Date.parse(c.trialEndsAt) <= now.getTime() + 14 * DAY)
    .sort((a, b) => Date.parse(a.trialEndsAt!) - Date.parse(b.trialEndsAt!));

  const referred = clients.filter((c) => c.r.referred_by);
  const thisMonthAct = (metric: string) => sumAct(metric, thisMonth);
  const lastMonthKey = monthKey(starts[starts.length - 2]);
  const lastMonthAct = (metric: string) => sumAct(metric, lastMonthKey);

  return {
    now,
    counts,
    months,
    retention: ret,
    mrr: money,
    costMonths,
    aiThisMonthUsd: aiByMonth[aiByMonth.length - 1],
    aiByMonthUsd: aiByMonth,
    byPurpose: [...byPurpose.entries()].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => b.usd - a.usd),
    unattributedUsd,
    settings,
    funnel: funnel(clients.map((c) => ({
      setupStarted: c.setupStarted,
      googleLinked: Boolean(c.r.google_linked_at || c.r.google_location_id),
      menuDone: c.menuDone,
      setupFinished: Boolean(c.setupFinishedAt),
      firstApproval: Boolean(c.firstApprovalAt),
      firstPaid: firstPaidAt(c.timeline) !== null,
    }))),
    engagement: { active: activeClients.length, engaged, approvalsThisMonth: thisMonthAct("approvals"), approvalsLastMonth: lastMonthAct("approvals"), ownerMessagesThisMonth: thisMonthAct("owner_in") },
    timeToValueDays: median,
    attention,
    trialsEnding,
    pastDuePence: live.filter((c) => c.standing === "past_due").length * PRICE_GBP * 100,
    referrals: { used: referred.length, stillPaying: referred.filter((c) => PAYING.has(c.standing)).length, credited: referred.filter((c) => c.r.referral_credited_at).length },
    founderCode: { used: founderUses, max: FOUNDER.maxUses },
    value: { emails: thisMonthAct("emails"), approvals: thisMonthAct("approvals"), minutesSaved: thisMonthAct("minutes_saved") },
    system: { alerts7d, dead7d },
    clients,
  };
}

// "agent:reputation" -> "Review replies" etc., for the cost breakdown.
const PURPOSES: [RegExp, string][] = [
  [/^agent:reputation/, "Review replies"],
  [/^agent:visibility/, "Google posts and photos"],
  [/^agent:growth/, "Offers and campaigns"],
  [/^agent:insights/, "Numbers and reports"],
  [/^agent:checker/, "Checking drafts"],
  [/^agent:gm/, "Understanding the owner (GM)"],
  [/^agent:/, "Other assistants"],
  [/^onboarding/, "Setup"],
  [/^assistant/, "Chat and drafts (older assistant)"],
  [/^checks/, "Safety checks"],
  [/^sales/, "Reading till reports and files"],
  [/^rota/, "Rotas"],
  [/^monthly-report/, "Monthly report"],
  [/^customer-import/, "Customer imports"],
  [/^feeds/, "Outside data"],
];
export function purposeGroup(purpose: string) {
  return PURPOSES.find(([re]) => re.test(purpose))?.[1] ?? "Other";
}

export function isPaying(c: Pick<Client, "standing">) {
  return PAYING.has(c.standing);
}
