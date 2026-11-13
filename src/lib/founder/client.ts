import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { loadClients, purposeGroup, type Client } from "./data";
import { monthKey, monthStarts } from "./metrics";

// One client's page on /admin/clients/<id>: everything from the client list plus
// its problems, usage, costs, setup, recent conversation and activity. Every
// query names this restaurant.

const DAY = 86_400_000;
const db = () => getSupabase();

export type Problem = { at: string; kind: string; text: string; tone: "red" | "amber" | "info"; jobId?: string };

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") return [];
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

export async function loadClient(id: string, now = new Date()) {
  const { clients } = await loadClients({ includeTest: true, now });
  const client: Client | undefined = clients.find((c) => c.r.id === id);
  if (!client) return null;
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const restaurant = check(await db().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
  if (!restaurant) return null;

  const [history, alerts, jobs, blocked, unanswered, gWrites, imports, failedMsgs, conversation, audit, steps, gaps, salesLast, staff, closures, costs, activity] = await Promise.all([
    rows<{ at: string; kind: string; standing: string | null; amount_pence: number | null; source: string; detail: string | null; cancel_reason: string | null }>(
      db().from("billing_history").select("at, kind, standing, amount_pence, source, detail, cancel_reason").eq("restaurant_id", id).order("at", { ascending: false }).limit(50),
    ),
    rows<{ created_at: string; message: string }>(db().from("builder_alerts").select("created_at, message").eq("restaurant_id", id).gte("created_at", since30).order("created_at", { ascending: false }).limit(50)),
    rows<{ id: string; type: string; status: string; attempts: number; last_error: string | null; created_at: string; finished_at: string | null }>(
      db().from("jobs").select("id, type, status, attempts, last_error, created_at, finished_at").eq("restaurant_id", id).gte("created_at", since30).or("status.eq.dead,attempts.gt.1").order("created_at", { ascending: false }).limit(50),
    ),
    rows<{ created_at: string; reason: string; detail: string | null }>(db().from("blocked_sends").select("created_at, reason, detail").eq("restaurant_id", id).gte("created_at", since30).order("created_at", { ascending: false }).limit(30)),
    rows<{ created_at: string; message: string; reason: string; detail: string | null }>(db().from("unanswered_questions").select("created_at, message, reason, detail").eq("restaurant_id", id).gte("created_at", since30).order("created_at", { ascending: false }).limit(30)),
    rows<{ created_at: string; action: string; error: string | null }>(db().from("google_writes").select("created_at, action, error").eq("restaurant_id", id).eq("status", "failed").gte("created_at", since30).limit(30)),
    rows<{ created_at: string; status: string }>(db().from("customer_imports").select("created_at, status").eq("restaurant_id", id).eq("status", "paused").limit(10)),
    rows<{ created_at: string; error: string | null }>(db().from("messages").select("created_at, error").eq("restaurant_id", id).eq("status", "failed").gte("created_at", since30).limit(30)),
    rows<{ created_at: string; direction: string; body: string; app: unknown }>(db().from("messages").select("created_at, direction, body, app").eq("restaurant_id", id).order("created_at", { ascending: false }).limit(20)),
    rows<{ created_at: string; actor: string; action: string; detail: string | null }>(db().from("audit_log").select("created_at, actor, action, detail").eq("restaurant_id", id).neq("action", "founder_viewed").order("created_at", { ascending: false }).limit(25)),
    rows<{ step_key: string; status: string; completed_at: string | null }>(db().from("onboarding_steps").select("step_key, status, completed_at").eq("restaurant_id", id)),
    rows<{ step_key: string; unlock_text: string }>(db().from("setup_gaps").select("step_key, unlock_text").eq("restaurant_id", id).is("resolved_at", null).eq("dismissed", false)),
    rows<{ day: string }>(db().from("sales_days").select("day").eq("restaurant_id", id).order("day", { ascending: false }).limit(1)),
    rows<{ id: string }>(db().from("staff").select("id").eq("restaurant_id", id).is("employment_end", null)),
    rows<{ id: string; ref: string; status: string; closes_at: string | null; requested_at: string }>(
      db().from("account_closures").select("id, ref, status, closes_at, requested_at").eq("restaurant_id", id).in("status", ["requested", "scheduled", "closing", "failed"]),
    ),
    db().rpc("founder_monthly_costs", { p_since: "2020-01-01T00:00:00Z" }).then((r) => ((r.data ?? []) as { month: string; restaurant_id: string | null; purpose: string; calls: number; cost_usd: number }[]).filter((c) => c.restaurant_id === id)),
    db().rpc("founder_monthly_activity", { p_since: monthStarts(now, 2)[0].toISOString() }).then((r) => ((r.data ?? []) as { month: string; restaurant_id: string; metric: string; n: number }[]).filter((a) => a.restaurant_id === id)),
  ]);

  const problems: Problem[] = [
    ...alerts.map((a) => ({ at: a.created_at, kind: "Alert", text: a.message, tone: "amber" as const })),
    ...jobs.map((j) => ({
      at: j.finished_at ?? j.created_at,
      kind: j.status === "dead" ? "Job gave up" : "Job retried",
      text: `${j.type.replaceAll("_", " ")}${j.attempts > 1 ? ` (${j.attempts} tries)` : ""}${j.last_error ? `: ${j.last_error}` : ""}`,
      tone: j.status === "dead" ? ("red" as const) : ("amber" as const),
      jobId: j.status === "dead" ? j.id : undefined,
    })),
    ...blocked.map((b) => ({ at: b.created_at, kind: "Send blocked", text: `${b.reason.replaceAll("_", " ")}${b.detail ? `: ${b.detail}` : ""}`, tone: "info" as const })),
    ...unanswered.map((u) => ({ at: u.created_at, kind: "Couldn't answer", text: `"${u.message.slice(0, 160)}" (${u.reason.replaceAll("_", " ")})${u.detail ? `: ${u.detail.slice(0, 160)}` : ""}`, tone: "amber" as const })),
    ...gWrites.map((g) => ({ at: g.created_at, kind: "Google refused", text: `${g.action}${g.error ? `: ${g.error}` : ""}`, tone: "red" as const })),
    ...imports.map((i) => ({ at: i.created_at, kind: "Import paused", text: "A customer import was paused (too many bounces)", tone: "amber" as const })),
    ...failedMsgs.map((m) => ({ at: m.created_at, kind: "Message failed", text: m.error ?? "A message to the owner didn't send", tone: "amber" as const })),
    ...history.filter((h) => h.kind === "standing" && h.at >= since30 && ["past_due", "ended", "closed"].includes(h.standing ?? "")).map((h) => ({
      at: h.at,
      kind: "Billing",
      text: `${h.detail ?? h.standing}${h.cancel_reason ? ` (reason: ${h.cancel_reason})` : ""}`,
      tone: h.standing === "past_due" ? ("red" as const) : ("amber" as const),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const { agentStatus } = await import("@/lib/agents/go-live");
  const agents = await agentStatus(restaurant).catch(() => ({}));
  const agentRows = Object.entries(agents).map(([agent, s]) => ({ agent, ...(s as { set: string; running: string; reason: string | null }) }));

  // Assistants set live but held back in shadow (their go-live details are missing).
  const heldBack = agentRows.filter((a) => a.set === "live" && a.running !== "live").length;
  if (heldBack) {
    client.health.reasons.push({ tone: "amber", text: `${heldBack} assistant${heldBack === 1 ? "" : "s"} held back (setup details missing)` });
    if (client.health.light === "green") client.health.light = "amber";
  }

  const thisMonth = monthKey(monthStarts(now, 1)[0]);
  const lastMonth = monthKey(monthStarts(now, 2)[0]);
  const act = (metric: string, key: string) => activity.filter((a) => a.metric === metric && a.month.slice(0, 7) === key).reduce((n, a) => n + Number(a.n), 0);
  const usage = ["owner_in", "approvals", "edits", "skips", "emails", "whatsapp_out", "app_out", "minutes_saved"].map((metric) => ({ metric, thisMonth: act(metric, thisMonth), lastMonth: act(metric, lastMonth) }));
  const costByPurpose = new Map<string, { month: number; all: number }>();
  for (const c of costs) {
    const k = purposeGroup(c.purpose);
    const v = costByPurpose.get(k) ?? { month: 0, all: 0 };
    costByPurpose.set(k, { month: v.month + (c.month.slice(0, 7) === thisMonth ? Number(c.cost_usd) : 0), all: v.all + Number(c.cost_usd) });
  }

  const referrer = client.r.referred_by ? clients.find((c) => c.r.id === client.r.referred_by)?.r.name ?? "a closed account" : null;
  const referredList = clients.filter((c) => c.r.referred_by === id).map((c) => ({ id: c.r.id, name: c.r.name, standing: c.standing }));

  return {
    client,
    restaurant,
    history,
    problems,
    agents: agentRows,
    usage,
    costs: [...costByPurpose.entries()].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => b.all - a.all),
    conversation: conversation.reverse(),
    audit,
    steps,
    gaps,
    salesThrough: salesLast[0]?.day ?? null,
    staffCount: staff.length,
    closure: closures[0] ?? null,
    referrer,
    referredList,
  };
}
