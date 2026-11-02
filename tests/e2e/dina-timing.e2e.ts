// Where the time goes in a Dina turn, with the REAL Claude, on the in-memory
// database: every Claude call (model, seconds, tokens, why it stopped), the
// database calls a turn makes (counted, then priced at the dev project's real
// round trip), and the pauses between WhatsApp messages. The same three turns as
// the slow run of 30 Oct: web start, then two WhatsApp replies.
// Costs about $0.03. Run on its own:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-timing.e2e.ts
import { beforeAll, describe, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000e3";
const OWNER = "whatsapp:+447700900123";
let db: ReturnType<typeof memoryDb>;
type ClaudeCall = { model: string; ms: number; input: number; output: number; stop: string; turn: string };
const calls: ClaudeCall[] = [];
let dbCalls = 0;
let currentTurn = "";
const sends: number[] = [];

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Ember & Spice Grill", owner_name: "Amina Khan", owner_whatsapp: OWNER, active: false, address: "12 High Street, London E1 6AN", cuisine: null, menu: [], profile_version: 0 }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "hello", channel_last_used: "web", started_at: new Date().toISOString(), completed_at: null }],
      onboarding_steps: [],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      messages: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  // Count every database call (each is one round trip to Supabase in real life).
  const counted = new Proxy(db.client, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop === "from" || prop === "rpc") return (...args: unknown[]) => (dbCalls++, (v as (...a: unknown[]) => unknown).apply(target, args));
      return v;
    },
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => counted, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, fields),
  }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sends.push(Date.now()), { sid: "SM", body }),
    sendDinaChoices: async (_f: string, _t: string, m: { body: string }) => (sends.push(Date.now()), { sid: "SM", body: m.body, usedButtons: true }),
  }));
  // Time every Claude call.
  vi.doMock("@/lib/claude", async (orig) => {
    const real = await orig<typeof import("@/lib/claude")>();
    return {
      ...real,
      claude: () => {
        const client = real.claude();
        const parse = client.beta.messages.parse.bind(client.beta.messages);
        client.beta.messages.parse = (async (params: { model: string }, ...rest: unknown[]) => {
          const t = Date.now();
          const res = await (parse as (...a: unknown[]) => Promise<{ usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }; stop_reason: string; model?: string }>)(params, ...rest);
          calls.push({ model: res.model ?? params.model, ms: Date.now() - t, input: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), output: res.usage.output_tokens, stop: res.stop_reason, turn: currentTurn });
          return res;
        }) as typeof client.beta.messages.parse;
        return client;
      },
    };
  });
});

async function supabaseRoundTripMs() {
  const url = process.env.SUPABASE_URL!;
  if (!url.includes("nfphswknczyovnmnxjfa")) return null; // dev only
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    await fetch(`${url}/rest/v1/onboarding_sessions?select=restaurant_id&limit=1`, { headers: { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` } });
    if (i) times.push(Date.now() - t); // the first opens the connection
  }
  return Math.round(times.sort((a, b) => a - b)[Math.floor(times.length / 2)]);
}

describe("timing", () => {
  test("three turns, timed", async () => {
    const rtt = await supabaseRoundTripMs();
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    const { handleDinaWhatsApp } = await import("@/lib/onboarding/dina/whatsapp-turn");
    const rows: { turn: string; totalMs: number; firstSendMs: number | null; db: number }[] = [];
    const run = async (turn: string, fn: () => Promise<unknown>) => {
      currentTurn = turn;
      dbCalls = 0;
      sends.length = 0;
      const t = Date.now();
      await fn();
      rows.push({ turn, totalMs: Date.now() - t, firstSendMs: sends.length ? sends[0] - t : null, db: dbCalls });
      await new Promise((r) => setTimeout(r, 5));
    };
    await run("web: start", () => dinaTurn({ restaurantId: R, channel: "web", event: "start" }));
    await run('WhatsApp: "I\'m the owner"', () => handleDinaWhatsApp({ restaurantId: R, owner: OWNER, sandbox: "whatsapp:+14155238886", body: "I'm the owner", media: [], messageSid: "SMt1" }));
    await run('WhatsApp: "We\'re a halal grill"', () => handleDinaWhatsApp({ restaurantId: R, owner: OWNER, sandbox: "whatsapp:+14155238886", body: "We're a halal grill", media: [], messageSid: "SMt2" }));

    console.log("\n=== Claude calls ===");
    for (const c of calls) console.log(`${c.turn.padEnd(30)} ${c.model.padEnd(18)} ${(c.ms / 1000).toFixed(1).padStart(5)}s  in ${String(c.input).padStart(5)}  out ${String(c.output).padStart(5)}  ${c.stop}`);
    console.log(`\n=== Turns (database: ${rtt ?? "?"} ms a round trip to dev, so the database column is an estimate) ===`);
    for (const r of rows) {
      const claudeMs = calls.filter((c) => c.turn === r.turn).reduce((s, c) => s + c.ms, 0);
      const dbMs = rtt ? r.db * rtt : 0;
      console.log(
        `${r.turn.padEnd(30)} total ${(r.totalMs / 1000).toFixed(1)}s  Claude ${(claudeMs / 1000).toFixed(1)}s  other ${((r.totalMs - claudeMs) / 1000).toFixed(1)}s` +
          `  | ${r.db} db calls ≈ ${(dbMs / 1000).toFixed(1)}s real  | first WhatsApp message after ${r.firstSendMs === null ? "-" : `${(r.firstSendMs / 1000).toFixed(1)}s`} (+db)`,
      );
    }
    const cost = db.tables.onboarding_ai_usage.reduce((s, u) => s + Number(u.cost_usd), 0);
    console.log(`\nCost: $${cost.toFixed(4)}`);
  });
});
