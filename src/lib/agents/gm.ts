import "server-only";
import type { ChatResult } from "@/lib/assistant";
import { check, type Draft } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { agentLiveAllowed, effectiveAgentMode } from "@/lib/switches";
import { runChecker } from "./checker-core";
import { londonToday } from "./checker-core";
import { confirmedFields, goLiveChecklist } from "./go-live";
import { runComposer, runRouter, type ComposerInput } from "./gm-core";
import { rankBriefItems, ROUTE_WORDS, type BriefItem, type Route, type RouterOutputType } from "./gm-rules";
import { enqueueAgentJob, type AgentJob, type JobOutcome } from "./jobs";
import { loadAgent } from "./loader";
import { agentMode } from "./modes";
import { callTool } from "./tools";
import { addUsage, type Usage } from "./usage";

// The GM with the database: its mode and go-live checklist, routing an owner's
// message (with a time limit), and shadow mode: on every owner message the router
// runs and its route is logged next to what today's code did; each morning brief
// gets a shadow version from the composer. Nothing changes for the owner in shadow.

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------- Mode and the go-live checklist ----------

// The specialists the GM can route to live (each by its own mode for this restaurant).
export async function liveSpecialists(r: Restaurant) {
  const [{ reputationMode }, { visibilityMode }, { insightsMode }, { growthMode }] = await Promise.all([import("./reputation"), import("./visibility"), import("./insights"), import("./growth")]);
  const live: string[] = [];
  if (reputationMode(r) === "live") live.push("Reputation");
  if ((await visibilityMode(r)) === "live") live.push("Visibility");
  if ((await insightsMode(r)) === "live") live.push("Insights");
  if ((await growthMode(r)) === "live") live.push("Growth");
  return live;
}

// Owner name, language, quiet hours (profile fields) and at least one specialist live.
export async function gmChecklist(r: Restaurant) {
  const fields = goLiveChecklist(r, "gm", await confirmedFields(r.id));
  const live = await liveSpecialists(r);
  const labels = [...fields.labels, ...(live.length ? [] : ["at least one specialist live"])];
  return { ready: fields.ready && live.length > 0, labels, live };
}

// Live only when AGENTS_LIVE_ALLOWED lets it (lib/switches.ts) and the checklist passes.
export async function gmMode(r: Restaurant) {
  const mode = agentMode(r, "gm");
  if (mode !== "live") return mode;
  const liveAllowed = agentLiveAllowed(process.env, "gm");
  return effectiveAgentMode(mode, { liveAllowed, ready: liveAllowed && (await gmChecklist(r)).ready });
}

// ---------- Routing ----------

export const ROUTER_TIMEOUT_MS = 10_000;

async function recentMessages(restaurantId: string, owner: string) {
  const rows =
    ok(
      await getSupabase()
        .from("messages")
        .select("direction, body")
        .eq("restaurant_id", restaurantId)
        .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
        .order("created_at", { ascending: false })
        .limit(7)
        .returns<{ direction: string; body: string }[]>(),
    ) ?? [];
  // The newest is the message being routed.
  return rows
    .slice(1)
    .reverse()
    .map((m) => ({ from: m.direction === "inbound" ? ("owner" as const) : ("naila" as const), text: m.body.slice(0, 300) }));
}

export type Routed = { output: RouterOutputType; ms: number; usage: Usage };

// The router's decision, or null if it failed or took longer than the limit (today's code answers).
export async function routeMessage(restaurantId: string, owner: string, body: string, onScreen: Draft | null): Promise<Routed | null> {
  const started = Date.now();
  try {
    const recent = await recentMessages(restaurantId, owner).catch(() => []);
    const run = runRouter({ message: body, recent, onScreen: onScreen ? `${onScreen.kind.replace(/_/g, " ")} for ${onScreen.audience ?? "the owner"}` : null }, "an owner message");
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ROUTER_TIMEOUT_MS));
    const r = await Promise.race([run, timeout]);
    return r ? { output: r.output, ms: Date.now() - started, usage: r.usage } : null;
  } catch (err) {
    console.error("The GM's router failed; today's code answers", err);
    return null;
  }
}

// What today's code did with a message, as a route (for the comparison).
export function legacyRoute(result: ChatResult | { type: "insights" }): Route {
  switch (result.type) {
    case "insights":
      return "insights";
    case "campaign":
      return "growth";
    case "pasted_review":
      return "reputation";
    case "profile_changes":
      return "profile_fact";
    case "revise":
      return "edit";
    case "team":
      return "team";
    case "draft":
      return result.kind === "review_reply" ? "reputation" : result.kind === "google_post" ? "visibility" : result.kind === "email_campaign" || result.kind === "promotion" ? "growth" : "one_off";
    default:
      return "chat";
  }
}

// ---------- Composing with facts, checked (decision 3) ----------

// The profile facts a simple question can be answered from (what the GM reads).
export async function gmProfile(restaurantId: string) {
  return callTool("gm", "get_profile", restaurantId, {});
}

// A reply with figures or facts goes through the checker (facts and C6) before it's sent.
export async function composeChecked(restaurantId: string, input: ComposerInput, label: string) {
  const composed = await runComposer(input, label);
  let usage = composed.usage;
  let verdict: string | null = null;
  const hasFacts = /\d/.test(composed.output.message) || Boolean(input.profile);
  if (hasFacts) {
    const checkerProfile = await callTool("checker", "get_profile", restaurantId, {});
    const checked = await runChecker(
      {
        draft: { type: "gm_reply", channel: "owner", audience: "the owner", content: { text: composed.output.message }, needs_owner_input: null, sources_used: ["profile:hours", "profile:signup_offer"] },
        text: composed.output.message,
        sources: [{ ref: "gm:data", found: true, data: { profile: input.profile ?? null, lookups: input.lookups ?? null, receipts: input.receipts ?? null, owner_message: input.owner_message ?? null } }],
        profile: checkerProfile,
        recent: [],
        maker: "gm",
        makerRules: loadAgent("gm").rules,
        preview: null,
        today: londonToday(),
      },
      `${label} (check)`,
    );
    usage = addUsage(usage, checked.usage);
    verdict = checked.output.verdict;
  }
  return { message: composed.output.message, verdict, usage };
}

// ---------- Shadow: every owner message ----------

export type GmMessageJob = {
  message: string;
  owner: string;
  legacy_route: Route;
  legacy_text: string | null;
  legacy_ms: number;
  on_screen: string | null;
};

// Queued after today's reply has gone. Never throws.
export async function queueGmShadow(r: Restaurant, job: GmMessageJob) {
  try {
    if ((await gmMode(r)) !== "shadow") return null;
    return await enqueueAgentJob({ restaurantId: r.id, key: `gm:message:${r.id}:${Date.now()}`, agent: "gm", kind: "gm_shadow", trigger: "owner_message", input: job as Record<string, unknown> });
  } catch (err) {
    console.error("Couldn't queue the GM in shadow mode", err);
    return null;
  }
}

export async function runGmShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as GmMessageJob;
  const r = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!r) throw new Error("Restaurant not found");
  const started = Date.now();
  const routed = await runRouter({ message: input.message, recent: [], onScreen: input.on_screen }, "an owner message (shadow)");
  const routerMs = Date.now() - started;
  let usage = routed.usage;
  let reply: string | null = null;
  let verdict: string | null = null;
  let composeMs: number | null = null;
  // A simple profile question: the composer would answer it (checked, as it has facts).
  if (routed.output.route === "profile_question") {
    const t = Date.now();
    const profile = await gmProfile(r.id);
    const composed = await composeChecked(r.id, { kind: "reply", owner: { owner_name: r.owner_name, language: r.owner_language, restaurant: r.name }, owner_message: input.message, profile: profile.fields }, "an owner question (shadow)");
    composeMs = Date.now() - t;
    reply = composed.message;
    verdict = composed.verdict;
    usage = addUsage(usage, composed.usage);
  }
  const out = routed.output;
  ok(
    await getSupabase().from("shadow_drafts").insert({
      restaurant_id: r.id,
      agent: "gm",
      agent_version: loadAgent("gm").version,
      checker_version: verdict ? loadAgent("checker").version : null,
      job_id: job.id,
      source: "owner_message",
      task: out.route,
      subject: { message: input.message, legacy_route: input.legacy_route, legacy_ms: input.legacy_ms, router_ms: routerMs, compose_ms: composeMs, language: out.language },
      legacy_draft_id: null,
      legacy_text: input.legacy_text,
      outcome: "reply",
      output: { route: out.route, request: out.request, question: out.question, options: out.options, reply },
      question: out.question,
      checker: verdict ? { verdict, checks: [], minor_fixes: [] } : null,
      revisions: 0,
      steps: [],
    }),
  );
  return {
    output: { route: out.route, legacy_route: input.legacy_route, router_ms: routerMs, compose_ms: composeMs },
    agentVersion: loadAgent("gm").version,
    verdict: out.route === input.legacy_route ? "same" : "different",
    usage,
    actor: "gm",
    action: "agent_drafted",
    detail: `GM (shadow) on "${input.message.slice(0, 60)}": would route to ${ROUTE_WORDS[out.route]}; today's code: ${ROUTE_WORDS[input.legacy_route]}`,
  };
}

// ---------- Shadow: the morning brief ----------

export type GmBriefJob = { legacy_text: string; draft_ids: string[]; receipts: string[]; extra: string[]; today: string };

export async function queueGmBriefShadow(r: Restaurant, job: GmBriefJob) {
  try {
    if ((await gmMode(r)) !== "shadow") return null;
    return await enqueueAgentJob({ restaurantId: r.id, key: `gm:brief:${r.id}:${job.today}:${Date.now()}`, agent: "gm", kind: "gm_brief_shadow", trigger: "morning_brief_9am", input: job as Record<string, unknown> });
  } catch (err) {
    console.error("Couldn't queue the GM's shadow brief", err);
    return null;
  }
}

// Each waiting draft as a brief item: urgent (a 1 to 3 star review, a question about
// one), its send date (a campaign with a send time), and when it was made.
export async function briefItems(restaurantId: string, drafts: Draft[]) {
  const campaigns = drafts.some((d) => d.kind === "email_campaign")
    ? (ok(
        await getSupabase()
          .from("campaigns")
          .select("draft_id, send_at, valid_from")
          .eq("restaurant_id", restaurantId)
          .in("draft_id", drafts.map((d) => d.id))
          .returns<{ draft_id: string; send_at: string | null; valid_from: string }[]>(),
      ) ?? [])
    : [];
  const byDraft = new Map(campaigns.map((c) => [c.draft_id, c]));
  return drafts.map((d): BriefItem & { draft: Draft } => ({
    id: d.id,
    draft: d,
    urgent: d.kind === "review_question" || (d.kind === "review_reply" && /low rating/i.test(d.request ?? "")),
    send_at: byDraft.get(d.id)?.send_at ?? (byDraft.get(d.id)?.valid_from ? `${byDraft.get(d.id)!.valid_from}T00:00` : null),
    created_at: d.created_at,
  }));
}

export async function composeBrief(r: Restaurant, drafts: Draft[], receipts: string[], label: string) {
  const ranked = rankBriefItems(await briefItems(r.id, drafts));
  const owner = { owner_name: r.owner_name, language: r.owner_language, restaurant: r.name };
  const cardsFor = ranked.today.map((i) => ({ what: `${i.draft.kind.replace(/_/g, " ")}${i.draft.audience ? ` for ${i.draft.audience}` : ""}`, audience: i.draft.audience ?? "" }));
  const summary = await runComposer({ kind: "brief", owner, receipts, cards: cardsFor }, `${label} (summary)`);
  let usage = summary.usage;
  const cards: { draft_id: string; card: string }[] = [];
  for (const i of ranked.today) {
    const card = await runComposer({ kind: "card", owner, draft: { kind: i.draft.kind, audience: i.draft.audience ?? "", content: i.draft.content, expected_outcome: null } }, `${label} (card)`);
    usage = addUsage(usage, card.usage);
    cards.push({ draft_id: i.id, card: card.output.message });
  }
  return { summary: summary.output.message, cards, rolled: ranked.tomorrow.map((i) => i.id), usage };
}

export async function runGmBriefShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as GmBriefJob;
  const r = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!r) throw new Error("Restaurant not found");
  const drafts = input.draft_ids.length ? (check(await getSupabase().from("drafts").select("*").eq("restaurant_id", r.id).in("id", input.draft_ids).returns<Draft[]>()) ?? []) : [];
  const started = Date.now();
  const brief = await composeBrief(r, drafts, [...input.receipts, ...input.extra], "the morning brief (shadow)");
  const ms = Date.now() - started;
  ok(
    await getSupabase().from("shadow_drafts").insert({
      restaurant_id: r.id,
      agent: "gm",
      agent_version: loadAgent("gm").version,
      checker_version: null,
      job_id: job.id,
      source: "brief",
      task: "brief",
      subject: { today: input.today, ms, items: drafts.length },
      legacy_draft_id: null,
      legacy_text: input.legacy_text,
      outcome: "reply",
      output: { summary: brief.summary, cards: brief.cards, rolled: brief.rolled },
      question: null,
      checker: null,
      revisions: 0,
      steps: [],
    }),
  );
  return {
    output: { cards: brief.cards.length, rolled: brief.rolled.length, ms },
    agentVersion: loadAgent("gm").version,
    verdict: "composed",
    usage: brief.usage,
    actor: "gm",
    action: "agent_drafted",
    detail: `GM (shadow) wrote the morning brief: a summary and ${brief.cards.length} card${brief.cards.length === 1 ? "" : "s"}${brief.rolled.length ? `, ${brief.rolled.length} rolled to tomorrow` : ""}`,
  };
}
