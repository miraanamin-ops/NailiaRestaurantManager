// What each onboarding run with Dina cost in Claude calls (table onboarding_ai_usage,
// one row per call). A run is one onboarding from its start, so a reset test site
// counts again. Read only.
//
//   node --env-file=.env.local scripts/onboarding-costs.mjs [restaurant slug or id]
//
// Against live: node --env-file=.env.live.local scripts/onboarding-costs.mjs --live
import { createClient } from "@supabase/supabase-js";
import { guardLive, withoutLiveFlag } from "./lib/live-guard.mjs";

guardLive(process.env, "onboarding-costs");
const [who] = withoutLiveFlag(process.argv.slice(2));
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

let restaurants = (await s.from("restaurants").select("id, name, slug, is_test")).data ?? [];
if (who) restaurants = restaurants.filter((r) => r.id === who || r.slug === who);
const names = new Map(restaurants.map((r) => [r.id, `${r.name}${r.is_test ? " (test)" : ""}`]));

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await s
    .from("onboarding_ai_usage")
    .select("restaurant_id, run_started_at, step_key, purpose, cost_usd, input_tokens, output_tokens, cache_read")
    .in("restaurant_id", [...names.keys()])
    .order("created_at")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}
if (!rows.length) {
  console.log("No onboarding runs with Dina yet.");
  process.exit(0);
}

const runs = new Map();
for (const r of rows) {
  const key = `${r.restaurant_id}|${r.run_started_at}`;
  const run = runs.get(key) ?? { restaurant: names.get(r.restaurant_id), started: r.run_started_at, turns: 0, cost: 0, byStep: {} };
  if (r.purpose === "turn") run.turns++;
  run.cost += Number(r.cost_usd);
  run.byStep[r.step_key ?? "end"] = (run.byStep[r.step_key ?? "end"] ?? 0) + Number(r.cost_usd);
  runs.set(key, run);
}
const usd = (n) => `$${n.toFixed(3)}`;
for (const run of runs.values()) {
  console.log(`${run.restaurant}  started ${run.started.slice(0, 16).replace("T", " ")}  ${run.turns} Dina calls  ${usd(run.cost)}`);
  console.log(`  by step: ${Object.entries(run.byStep).map(([k, v]) => `${k} ${usd(v)}`).join(", ")}`);
}
const all = [...runs.values()];
console.log(`\n${all.length} run(s), average ${usd(all.reduce((a, r) => a + r.cost, 0) / all.length)} per run.`);
