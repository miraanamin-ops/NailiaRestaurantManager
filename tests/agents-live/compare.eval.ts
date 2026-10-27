// The old assistant against the agents, live (real Claude): each case in
// agents/tests/compare/cases.json goes through the real WhatsApp handling
// (handleMessage) twice on Test Kitchen's data (the real seed, run on the full
// migration chain in PGlite, then copied into the in-memory database): once with
// every agent in shadow (the old assistant answers) and once with the restaurant
// on the agents. Both are scored by the same plain-code rules
// (tests/agents/support/compare-cases.ts). The agents must score at least as well.
// Also prints what each run cost, per agent, and saves it all to
// tests/agents-live/.results/compare.json (scripts/agent-costs.mjs reads it). Each
// case is saved as it finishes (.results/compare/<id>.json), so the cases can be
// run a few at a time (-t "finance") and the summary covers the latest of each.
// Run: npm run test:agents -- compare     (about $3 to $5 for both ways)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { agentModesFor, type AssistantMode } from "@/lib/agents/assistant-mode";
import { addUsage, totals, type Usage } from "@/lib/agents/usage";
import { judge, loadCompareCases, scoreLine, type CompareCase, type Facts } from "../agents/support/compare-cases";
import { newFullDb } from "../support/full-pg";
import { memoryDb } from "../support/memory-db";
import { hasKey } from "./support";
import { readLedger } from "./spend";

const TK = "7e57c0de-0000-4000-8000-000000000000";
const OWNER = "whatsapp:+447700900333";
const SANDBOX = "whatsapp:+14155238886";
const SEED = readFileSync(join("supabase", "seed", "test-kitchen.sql"), "utf8");
const TABLES = ["restaurants", "sales_days", "sales_hours", "staff", "staff_pay_rates", "staff_availability", "rota_rules", "rota_weeks", "rota_shifts", "reviews", "customers", "profile_versions", "local_calendar", "councils"];

const rows: Record<string, Record<string, unknown>[]> = {};
type CaseResult = { id: string; area: string; old: string[]; agents: string[]; cost: Record<AssistantMode, number>; agentUsage: Usage; replies: Record<AssistantMode, string[]>; jobs: string[]; run_at: string };
const RESULTS = join("tests", "agents-live", ".results");
const CASE_DIR = join(RESULTS, "compare");
let ranHere = 0;

// Test Kitchen's sample photos (public/samples/test-kitchen) are served from this
// checkout, so the previews show them before they're deployed.
const realFetch = globalThis.fetch;
const SAMPLES = "https://app.dinerai.co.uk/samples/";
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(SAMPLES)) return new Response(readFileSync(join("public", "samples", url.slice(SAMPLES.length))), { headers: { "Content-Type": "image/png" } });
  return realFetch(input, init);
}) as typeof fetch;

beforeAll(async () => {
  if (!hasKey) return;
  const pg = await newFullDb();
  await pg.exec(`do $$ begin execute format('comment on database %I is %s', current_database(), quote_literal('dinerai-dev: compare eval')); end $$;`);
  await pg.exec(SEED);
  for (const t of TABLES) rows[t] = (await pg.query<{ j: Record<string, unknown> }>(`select to_jsonb(t) as j from ${t} t`)).rows.map((r) => r.j);
  // Midday UK today, whenever it's run, so sends fall inside sending hours (the seed's sales end yesterday).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  // (The clock still moves, so durations and time-stamped job keys still work.)
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${today}T12:00:00Z`), shouldAdvanceTime: true });
}, 300_000);

afterAll(() => vi.useRealTimers());

// One case, one way, in a fresh copy of the data.
async function runCase(c: CompareCase, mode: AssistantMode) {
  vi.resetModules();
  const restaurants = rows.restaurants.map((r) => (r.id === TK ? { ...r, active: true, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, agent_modes: agentModesFor(mode, {}) } : r));
  const db = memoryDb({ ...structuredClone(rows), restaurants }, { unique: ["agent_jobs.job_key"] });
  const texts: string[] = [];
  const reply = async (_f: string, _t: string, body: string) => (texts.push(body), { sid: `SM${texts.length}`, body });
  vi.stubEnv("TEST_TOOLS", "true");
  vi.stubEnv("AGENTS_LIVE_ALLOWED", "true");
  vi.stubEnv("GOOGLE_MODE", "dummy");
  vi.stubEnv("EMAIL_REDIRECT", "true");
  vi.stubEnv("LINK_SECRET", "compare-eval");
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), sendText: reply, sendWithApprovalButtons: async (f: string, t: string, body: string) => ({ ...(await reply(f, t, body)), usedButtons: true }), sendImage: async () => ({ sid: "SMimg", body: "[image]" }) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));
  vi.doMock("@/lib/email", async (orig) => ({ ...(await orig<object>()), sendCampaignEmail: async () => ({ delivery: "simulated", id: null, to: null, redirectedFrom: null }), sendBuilderEmail: async () => {} }));
  // Test Kitchen is a demo restaurant with the test tools on.
  vi.doMock("@/lib/dummy-data", () => ({ dummyDataAllowed: async () => true }));
  vi.doMock("@/lib/feeds/location", () => ({ ensureLocated: async () => ({ lat: 51.52, lon: -0.07, cell: "x", councilCode: "E09000030" }) }));

  const { handleMessage } = await import("@/lib/bot");
  const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
  const say = async (body: string, buttonPayload?: string) => {
    db.tables.messages.push({ id: `in-${db.tables.messages?.length ?? 0}`, restaurant_id: TK, direction: "inbound", from_number: OWNER, to_number: SANDBOX, body, status: "received", created_at: new Date().toISOString() });
    await handleMessage({ restaurantId: TK, owner: OWNER, sandbox: SANDBOX, body, buttonPayload });
    // What runs straight after the reply (the webhook's worker): a Visibility post, a
    // live check of an edited draft. Shadow work isn't what the owner gets, so it's left.
    if (mode === "agents") await runQueuedAgentJobs(TK, 5);
  };
  db.tables.messages ??= [];
  for (const s of c.setup ?? []) await say(s);
  texts.length = 0;
  const spentBefore = readLedger().total;
  const before = structuredClone(db.tables);
  const jobsBefore = (db.tables.agent_jobs ?? []).length;
  await say(c.message);
  // An agent asked the owner something first (e.g. the kick-off time): the owner answers.
  const asked = db.tables.drafts?.some((d) => d.kind === "agent_question" && d.waiting_for === "decision");
  if (c.answer_if_asked && asked) await say(c.answer_if_asked);

  const facts = await factsFor(db);
  const outcome = (texts: string[]) => ({ texts, tables: db.tables, before, restaurantId: TK, capPercent: Number(restaurants.find((r) => r.id === TK)!.discount_cap_percent), nextMonday: facts.nextMonday });
  const problems = judge(c.expect, outcome([...texts]), facts);
  const replies = [...texts];
  if (c.then) {
    texts.length = 0;
    await say("Approve", "approve");
    replies.push("[Approve]", ...texts);
    problems.push(...judge(c.then.expect, outcome([...texts]), facts).map((p) => `after Approve: ${p}`));
  }
  const agentUsage = addUsage(...(db.tables.agent_jobs ?? []).slice(jobsBefore).map((j) => j.usage as Usage | null));
  // What each agent run concluded (for working out why a case failed).
  const jobs = (db.tables.agent_jobs ?? []).slice(jobsBefore).map((j) => `${String(j.kind)}: ${String(j.verdict ?? j.status)}${j.error ? ` (${String(j.error).slice(0, 200)})` : ""}`);
  return { problems, replies, cost: readLedger().total - spentBefore, agentUsage, jobs };
}

// The figures a right answer must contain, from the data and the app's own code.
async function factsFor(db: ReturnType<typeof memoryDb>): Promise<Facts & { nextMonday: string }> {
  const { londonYmd } = await import("@/lib/clock");
  const { labourForWeek } = await import("@/lib/finance/labour");
  const { getWeekAhead } = await import("@/lib/forecast/week-ahead");
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const today = londonYmd(new Date());
  const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = add(today, -wd);
  const nextMonday = add(thisMonday, 7);
  const sales = new Map(db.tables.sales_days.filter((d) => d.restaurant_id === TK).map((d) => [String(d.day), Number(d.net_sales)]));
  const lastSaturday = add(today, -(((wd - 5 + 7) % 7) || 7));
  const lastWeek = Array.from({ length: 7 }, (_, i) => sales.get(add(thisMonday, i - 7)) ?? 0).reduce((a, b) => a + b, 0);
  const labour = await labourForWeek(TK, nextMonday);
  const ahead = await getWeekAhead(TK, nextMonday).catch(() => null);
  const sum = (k: "sales_low" | "sales_mid" | "sales_high") => (ahead?.days ?? []).reduce((s, d) => s + (d[k] ?? 0), 0) / 100;
  return {
    nextMonday,
    next_week_labour: labour.status === "none" ? null : labour.costPence / 100,
    next_week_labour_pct: labour.status === "none" || !sum("sales_mid") ? null : (labour.costPence / 100 / sum("sales_mid")) * 100,
    last_saturday_net: sales.get(lastSaturday) ?? null,
    last_week_net: lastWeek || null,
    next_week_forecast: ahead && sum("sales_mid") ? { low: sum("sales_low"), high: sum("sales_high") } : null,
  };
}

describe.skipIf(!hasKey)("the old assistant against the agents (live)", () => {
  test.each(loadCompareCases())("$id", async (c) => {
    const old = await runCase(c, "old");
    const agents = await runCase(c, "agents");
    const result: CaseResult = { id: c.id, area: c.area, old: old.problems, agents: agents.problems, cost: { old: old.cost, agents: agents.cost }, agentUsage: agents.agentUsage, replies: { old: old.replies, agents: agents.replies }, jobs: agents.jobs, run_at: new Date().toISOString() };
    mkdirSync(CASE_DIR, { recursive: true });
    writeFileSync(join(CASE_DIR, `${c.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    ranHere++;
    const show = (p: string[]) => (p.length ? `✗ ${p.join("; ")}` : "✓");
    console.log(`${c.id}\n  old assistant ($${old.cost.toFixed(3)}): ${show(old.problems)}\n  agents ($${agents.cost.toFixed(3)}): ${show(agents.problems)}${process.env.SHOW_OUTPUT ? `\n  old said: ${old.replies.join(" | ").slice(0, 600)}\n  agents said: ${agents.replies.join(" | ").slice(0, 600)}` : ""}`);
    // A case the agents fail is a finding; the bar is the whole set (below).
    expect(agents.problems.length).toBeGreaterThanOrEqual(0);
  });

  afterAll(() => {
    if (!ranHere) return;
    const ids = new Set(loadCompareCases().map((c) => c.id));
    const results = readdirSync(CASE_DIR)
      .map((f) => JSON.parse(readFileSync(join(CASE_DIR, f), "utf8")) as CaseResult)
      .filter((r) => ids.has(r.id));
    const s = scoreLine(results);
    const byAgent = Object.fromEntries(Object.entries(addUsage(...results.map((r) => r.agentUsage))).map(([a, t]) => [a, Number(t.cost.toFixed(4))]));
    const summary = {
      run_at: new Date().toISOString(),
      score: { old_assistant: `${s.old} of ${s.total}`, agents: `${s.agents} of ${s.total}`, regressions: s.regressions },
      cost: { old_assistant: results.reduce((n, r) => n + r.cost.old, 0), agents: results.reduce((n, r) => n + r.cost.agents, 0), agents_by_agent: byAgent, agents_recorded_total: totals(addUsage(...results.map((r) => r.agentUsage))).cost },
      cases: results,
    };
    writeFileSync(join(RESULTS, "compare.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\n${results.length} of ${ids.size} cases run so far. Score: old assistant ${s.old} of ${s.total}, agents ${s.agents} of ${s.total}${s.regressions.length ? `; the agents fail where the old assistant passed: ${s.regressions.join(", ")}` : ""}`);
    console.log(`Cost of these cases: old assistant $${summary.cost.old_assistant.toFixed(2)}, agents $${summary.cost.agents.toFixed(2)} (${Object.entries(byAgent).map(([a, c]) => `${a} $${c}`).join(", ")})`);
    if (results.length === ids.size) expect(s.agents).toBeGreaterThanOrEqual(s.old);
  });
});
