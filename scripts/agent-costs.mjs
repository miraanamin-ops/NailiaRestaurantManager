// What the agents cost, per agent, per restaurant, per month. Read-only.
//   node --env-file=.env.local scripts/agent-costs.mjs            the last 3 months, every restaurant
//   node --env-file=.env.local scripts/agent-costs.mjs <slug> 6   one restaurant, the last 6 months
// From agent_jobs (each job's usage, priced by the model that answered: lib/agents/usage.ts).
// Shadow runs count too: they're the same agents on the restaurant's real messages,
// so a restaurant in shadow shows what it would cost live. The old assistant's own
// calls aren't recorded per call, so they aren't in here.
// A month with only part of it gone is also shown scaled up to a full month ("full month at this rate").
// Runs against the dev project; add --live (with the live settings file) to read live.
import { createClient } from "@supabase/supabase-js";
import { guardLive, withoutLiveFlag } from "./lib/live-guard.mjs";

guardLive(process.env, "agent-costs");
const [slug, monthsArg] = withoutLiveFlag(process.argv.slice(2));
const months = Math.max(1, Math.min(12, Number(monthsArg ?? 3) || 3));
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

let rq = s.from("restaurants").select("id, name, slug, is_demo, agent_modes");
if (slug) rq = rq.eq("slug", slug);
const { data: restaurants, error } = await rq;
if (error) throw new Error(error.message);
if (!restaurants.length) {
  console.error(`No restaurant${slug ? ` with slug "${slug}"` : "s"}.`);
  process.exit(1);
}

const now = new Date();
const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString();
const londonMonth = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).format(new Date(iso));
const thisMonth = londonMonth(now.toISOString());
// How much of this month has gone, to scale it to a full month.
const daysIn = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
const fraction = Math.max(1 / daysIn, (now.getUTCDate() - 1 + now.getUTCHours() / 24) / daysIn);
const $ = (n) => `$${n.toFixed(n >= 1 ? 2 : 3)}`;

for (const r of restaurants) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await s
      .from("agent_jobs")
      .select("created_at, agent, kind, usage, cost_usd")
      .eq("restaurant_id", r.id)
      .gte("created_at", since)
      .order("created_at")
      .range(from, from + 999);
    if (e) throw new Error(e.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // Per month, per agent (a job's usage is split by agent: a maker's loop includes the checker).
  const byMonth = new Map();
  for (const j of rows) {
    const m = byMonth.get(londonMonth(j.created_at)) ?? { jobs: 0, agents: {} };
    m.jobs++;
    const parts = j.usage && Object.keys(j.usage).length ? Object.entries(j.usage).map(([a, t]) => [a, Number(t.cost ?? 0)]) : [[j.agent, Number(j.cost_usd ?? 0)]];
    for (const [a, c] of parts) m.agents[a] = (m.agents[a] ?? 0) + c;
    byMonth.set(londonMonth(j.created_at), m);
  }
  const modes = Object.entries(r.agent_modes ?? {}).map(([a, m]) => `${a} ${m}`).join(", ") || "all defaults (shadow)";
  console.log(`\n${r.name} (${r.slug}${r.is_demo ? ", demo" : ""}) · ${modes}`);
  if (!byMonth.size) {
    console.log("  no agent runs in this period");
    continue;
  }
  for (const [month, m] of [...byMonth.entries()].sort()) {
    const total = Object.values(m.agents).reduce((a, b) => a + b, 0);
    const scaled = month === thisMonth ? ` · full month at this rate ${$(total / fraction)}` : "";
    const parts = Object.entries(m.agents).sort((a, b) => b[1] - a[1]).map(([a, c]) => `${a} ${$(c)}`).join(", ");
    console.log(`  ${month}: ${$(total)} over ${m.jobs} runs (${parts})${scaled}`);
  }
}
