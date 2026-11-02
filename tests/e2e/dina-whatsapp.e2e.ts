// Switching channels mid-step with the REAL Claude, on the in-memory database
// (no Supabase; WhatsApp sends are captured, nothing reaches a phone). The owner
// starts on the web, Dina asks a question; the owner answers it on WhatsApp by
// typing its number, then carries on there. Checks she picks up at the exact
// step without starting it again, and prints what each WhatsApp message would
// look like. Costs about $0.03 to $0.05. Run on its own:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-whatsapp.e2e.ts
import { beforeAll, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000e2";
const OWNER = "whatsapp:+447700900123";
let db: ReturnType<typeof memoryDb>;
const sent: { kind: string; body: string; options?: { title: string }[] }[] = [];

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  process.env.DINA_MESSAGE_GAP_MS = "0";
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
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, fields),
  }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sent.push({ kind: "text", body }), { sid: `SMout${sent.length}`, body }),
    sendDinaChoices: async (_f: string, _t: string, m: { kind: string; body: string; options: { title: string }[] }) => (
      sent.push({ kind: m.kind, body: m.body, options: m.options }), { sid: `SMout${sent.length}`, body: m.body, usedButtons: true }
    ),
  }));
});

const show = (label: string) => {
  console.log(`\n--- ${label}`);
  for (const s of sent.splice(0)) console.log(`[WhatsApp ${s.kind}] ${s.body}${s.options ? `\n  buttons: ${s.options.map((o) => o.title).join(" | ")}` : ""}`);
};
const pause = () => new Promise((r) => setTimeout(r, 5));

describe("web, then WhatsApp, mid-step, for real", () => {
  test("Dina asks on the web; the owner answers on WhatsApp; she carries on at the same step", async () => {
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    const { handleDinaWhatsApp } = await import("@/lib/onboarding/dina/whatsapp-turn");
    const web = await dinaTurn({ restaurantId: R, channel: "web", event: "start" });
    if (web.duplicate) throw new Error("duplicate");
    console.log("\n--- web: start");
    for (const m of web.reply.messages) console.log(`Dina: ${m.text}${m.component ? `  [${JSON.stringify(m.component)}]` : ""}`);
    expect(web.fallback).toBe(false);
    const asked = web.messages.find((m) => m.component?.type === "quick_replies");
    await pause();

    // On WhatsApp: the number of the first option, if she offered buttons; otherwise words.
    const typed = asked ? "1" : "I'm the owner";
    await handleDinaWhatsApp({ restaurantId: R, owner: OWNER, sandbox: "whatsapp:+14155238886", body: typed, media: [], messageSid: "SMe2e1" });
    show(`WhatsApp: owner typed "${typed}"`);
    const owner = db.tables.onboarding_messages.find((m) => m.role === "owner")!;
    if (asked) expect(owner.parts).toEqual([{ type: "answer", to: asked.id, choice: asked.component!.type === "quick_replies" ? asked.component!.options[0].id : "" }]);
    // Still Hello (or just past it if everything was confirmed): never back to the start.
    expect(["hello", "google"]).toContain(db.tables.onboarding_sessions[0].current_step);
    const wa = db.tables.onboarding_messages.filter((m) => m.role === "dina" && m.channel === "whatsapp");
    expect(wa.length).toBeGreaterThan(0);
    expect(wa.map((m) => m.body).join(" ")).not.toMatch(/I'm Dina, your DinerAI manager/); // no second introduction
    await pause();

    await handleDinaWhatsApp({ restaurantId: R, owner: OWNER, sandbox: "whatsapp:+14155238886", body: "We're a halal grill", media: [], messageSid: "SMe2e2" });
    show('WhatsApp: "We\'re a halal grill"');
    const cost = db.tables.onboarding_ai_usage.reduce((s, u) => s + Number(u.cost_usd), 0);
    console.log(`\nTotal for this run: $${cost.toFixed(4)}`);
  });
});
