// The Google step with "Connect Google" switched on, with the REAL Claude on the
// in-memory database: Dina offers Connect Google first, always with "Add as
// Manager instead"; picking the Manager route goes on to the usual questions
// and the laptop steps. Costs about $0.03 to $0.05. Run on its own:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-google-connect.e2e.ts
import { beforeAll, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000e9";
let db: ReturnType<typeof memoryDb>;
let n = 0;

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  process.env.GOOGLE_MANAGER_EMAIL = "manager@dinerai.co.uk";
  process.env.ONBOARDING_GOOGLE_CONNECT = "true";
  process.env.GOOGLE_CLIENT_ID = "e2e-client";
  process.env.GOOGLE_CLIENT_SECRET = "e2e-secret";
  process.env.GOOGLE_TOKEN_KEY ||= Buffer.alloc(32, 7).toString("base64");
  delete process.env.GOOGLE_MODE; // dummy
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Ember & Spice Grill", slug: "ember-e2e-connect", owner_name: "Amina Khan", owner_email: "amina@example.org", is_demo: true, active: false, address: "12 High Street, London E1 6AN", cuisine: "Halal grill", menu: [], profile_version: 0, brand_voice: null, profile_examples: null }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "google", channel_last_used: "web", started_at: new Date().toISOString(), completed_at: null }],
      onboarding_steps: [{ restaurant_id: R, step_key: "hello", status: "done", data: { role: "owner" }, completed_at: new Date().toISOString() }],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      reviews: [
        { id: "rv1", restaurant_id: R, author_name: "Priya", rating: 5, text: "x", review_date: "2026-10-01" },
        { id: "rv2", restaurant_id: R, author_name: "Tom", rating: 4, text: "y", review_date: "2026-10-02" },
      ],
      messages: [],
      google_connections: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, fields),
  }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async () => ({ delivery: "email", id: "e", to: "amina@example.org", redirectedFrom: null }) }));
});

const pause = () => new Promise((r) => setTimeout(r, 5));

async function say(text: string, tap?: { messageId: string; choiceId: string }) {
  const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
  const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
  const { dinaReplyProblems } = await import("@/lib/onboarding/dina/reply");
  const note = tap ? await handleAnswer({ restaurantId: R, ...tap, channel: "web" }) : null;
  const out = await dinaTurn({
    restaurantId: R,
    channel: "web",
    event: text ? "message" : "resume",
    text: text || null,
    externalId: `e2e-${++n}`,
    ownerParts: tap ? [{ type: "answer", to: tap.messageId, choice: tap.choiceId }] : undefined,
    note,
  });
  if (out.duplicate) throw new Error("duplicate");
  console.log(`\n--- ${text ? `owner: "${text}"` : "owner comes back"}${note ? `  [code: ${note.slice(0, 90)}…]` : ""}  ($${out.costUsd.toFixed(4)})`);
  for (const m of out.messages) console.log(`Dina: ${m.text}${m.component ? `  [${JSON.stringify(m.component)}]` : ""}`);
  console.log(`   step now: ${out.step}`);
  expect(out.fallback).toBe(false);
  expect(dinaReplyProblems(out.reply)).toEqual([]);
  await pause();
  return out;
}
const withCard = (out: Awaited<ReturnType<typeof say>>, type: string) => out.messages.find((m) => m.component?.type === type);

describe("Google with Connect Google switched on, for real", () => {
  test("Connect Google first, the Manager route always offered, and it works", async () => {
    await say("");
    const offered = await say("Yes we do");
    expect(withCard(offered, "google_connect")).toBeTruthy();
    const alt = offered.messages.find((m) => m.component?.type === "quick_replies" && m.component.options.some((o) => /manager/i.test(o.label)));
    expect(alt).toBeTruthy();
    const option = (alt!.component as { options: { id: string; label: string }[] }).options.find((o) => /manager/i.test(o.label))!;

    await say(option.label, { messageId: alt!.id, choiceId: option.id });
    await say("Yes, I'm the owner");
    const steps = await say("I'm on my laptop");
    expect(withCard(steps, "google_steps")?.component).toEqual({ type: "google_steps", device: "laptop" });

    const cost = db.tables.onboarding_ai_usage.reduce((s, u) => s + Number(u.cost_usd), 0);
    console.log(`
Total for this run: $${cost.toFixed(4)}`);
  });
});
