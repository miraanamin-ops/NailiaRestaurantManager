// One restaurant's assistant: the agents, or back to the old assistant.
//   node --env-file=.env.local scripts/assistant-mode.mjs <slug or id>            shows where it is
//   node --env-file=.env.local scripts/assistant-mode.mjs <slug or id> agents     the five agents and the checker live
//   node --env-file=.env.local scripts/assistant-mode.mjs <slug or id> old        every agent back in shadow: the old assistant answers
// Takes effect on the restaurant's next message (no deploy). Logged on /log as the builder.
// "agents" also needs AGENTS_LIVE_ALLOWED=true on Vercel, and each agent's readiness
// check (settings page, builder controls) to pass; until then that agent stays in shadow.
// Runs against the dev project; add --live (with the live settings file) to change live.
import { createClient } from "@supabase/supabase-js";
import { guardLive, withoutLiveFlag } from "./lib/live-guard.mjs";
import { agentModesFor, ASSISTANT_AGENTS, assistantModeOf } from "./lib/assistant-modes.mjs";

guardLive(process.env, "assistant-mode");
const [who, mode] = withoutLiveFlag(process.argv.slice(2));
if (!who || (mode && mode !== "agents" && mode !== "old")) {
  console.error("Usage: node --env-file=.env.local scripts/assistant-mode.mjs <restaurant slug or id> [agents|old]");
  process.exit(1);
}
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const isId = /^[0-9a-f-]{36}$/i.test(who);
const { data: r, error } = await s.from("restaurants").select("id, name, slug, agent_modes, is_demo").eq(isId ? "id" : "slug", who).maybeSingle();
if (error) throw new Error(error.message);
if (!r) {
  console.error(`No restaurant with ${isId ? "id" : "slug"} "${who}". Nothing changed.`);
  process.exit(1);
}
const show = (modes) => ASSISTANT_AGENTS.map((a) => `${a}: ${modes?.[a] ?? "default (shadow)"}`).join(", ");
console.log(`${r.name} (${r.slug}${r.is_demo ? ", demo" : ""}): ${assistantModeOf(r.agent_modes)}\n  ${show(r.agent_modes)}`);
if (!mode) process.exit(0);

const next = agentModesFor(mode, r.agent_modes);
const { error: upErr } = await s.from("restaurants").update({ agent_modes: next }).eq("id", r.id);
if (upErr) throw new Error(upErr.message);
const { error: logErr } = await s.from("audit_log").insert({
  restaurant_id: r.id,
  actor: "builder",
  action: "setting",
  detail: mode === "agents" ? "Switched to the agents: all five and the checker set live (scripts/assistant-mode.mjs)" : "Switched back to the old assistant: every agent in shadow (scripts/assistant-mode.mjs)",
  data: { field: "agent_modes", before: r.agent_modes, after: next },
});
if (logErr) console.error("Saved, but couldn't write the log line:", logErr.message);
console.log(`Now: ${assistantModeOf(next)}\n  ${show(next)}`);
if (mode === "agents") console.log("Each agent goes live only with AGENTS_LIVE_ALLOWED=true on Vercel and its readiness check passing (settings page > builder controls shows any that are still in shadow and why).");
