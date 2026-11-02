// Steps 4 to 6 with the REAL Claude, on the in-memory database (no Supabase;
// nothing is sent). Making it right, then a menu photo (drawn here, read by
// Claude's vision), its card confirmed, allergens suggested and checked dish by
// dish (code's own cards between), then hours and a few of the common questions.
// Prints the conversation and what was saved. Costs about $0.10 to $0.15. Run:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-facts.e2e.ts
import sharp from "sharp";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000e5";
let db: ReturnType<typeof memoryDb>;
let n = 0;

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Ember & Spice Grill", owner_name: "Amina Khan", is_demo: true, active: false, discount_cap_percent: 15, opening_hours: {}, menu: [], faqs: {}, profile_version: 0, address: "12 High Street, London E1 6AN", cuisine: "Halal grill" }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "make_it_right", channel_last_used: "web", started_at: new Date().toISOString(), completed_at: null }],
      onboarding_steps: ["hello", "google", "tone"].map((k) => ({ restaurant_id: R, step_key: k, status: "done", data: {}, completed_at: new Date().toISOString() })),
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      google_connections: [],
      reviews: [],
      rate_limits: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
});

const pause = () => new Promise((r) => setTimeout(r, 5));
const r = () => db.tables.restaurants[0];
const lastCard = (type: string) => [...db.tables.onboarding_messages].reverse().find((m) => m.role === "dina" && (m.parts as { type?: string }[])?.[0]?.type === type)!;

function print(label: string, out: { messages: { text: string; component: unknown }[]; step: string | null; costUsd: number }, note?: string | null) {
  console.log(`\n--- ${label}${note ? `  [code: ${note.slice(0, 100)}…]` : ""}  ($${out.costUsd.toFixed(4)})`);
  for (const m of out.messages) console.log(`Dina: ${m.text}${m.component ? `  [${JSON.stringify(m.component)}]` : ""}`);
  console.log(`   step now: ${out.step}`);
}

async function say(text: string, opts: { tap?: { messageId: string; choiceId: string }; note?: string | null } = {}) {
  const { dinaTurn, codeTurn } = await import("@/lib/onboarding/dina/turn");
  const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
  const { dinaReplyProblems } = await import("@/lib/onboarding/dina/reply");
  const outcome = opts.tap ? await handleAnswer({ restaurantId: R, ...opts.tap, channel: "web" }) : null;
  const ownerParts = opts.tap ? [{ type: "answer", to: opts.tap.messageId, choice: opts.tap.choiceId }] : undefined;
  if (outcome && typeof outcome === "object") {
    const out = await codeTurn({ restaurantId: R, channel: "web", text, externalId: `e2e-${++n}`, ownerParts, messages: outcome.reply });
    if (out.duplicate) throw new Error("duplicate");
    print(`owner taps "${text}" (code answers, no Claude)`, out);
    await pause();
    return out;
  }
  const note = [typeof outcome === "string" ? outcome : null, opts.note ?? null].filter(Boolean).join(" ") || null;
  const out = await dinaTurn({ restaurantId: R, channel: "web", event: text ? "message" : "resume", text: text || null, externalId: `e2e-${++n}`, ownerParts, note });
  if (out.duplicate) throw new Error("duplicate");
  print(text ? `owner: "${text}"` : "owner comes back", out, note);
  expect(out.fallback).toBe(false);
  expect(dinaReplyProblems(out.reply)).toEqual([]);
  await pause();
  return out;
}

async function menuPhoto() {
  const lines = ["EMBER & SPICE GRILL", "", "GRILLS", "Lamb Chops ........ £14.00", "Chicken Tikka ..... £11.50", "Mixed Grill ....... £18.00", "", "SIDES", "Garlic Naan ....... £3.00", "Chips ............. £3.50"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><rect width="100%" height="100%" fill="#fffaf0"/>${lines.map((l, i) => `<text x="80" y="${110 + i * 70}" font-family="Georgia, serif" font-size="${i === 0 ? 48 : 40}" font-weight="${/^[A-Z &]+$/.test(l) ? 700 : 400}" fill="#222">${l.replace(/&/g, "&amp;")}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

describe("steps 4 to 6, for real", () => {
  test("making it right, the menu with allergens dish by dish, hours and FAQs", async () => {
    await say("");
    await say("Invite them back for a free dessert, and give them our number to sort it out");
    await say("Me, Amina, the owner. They can call 020 7946 0000");
    expect(r().recovery_offers?.length).toBeGreaterThan(0);
    expect(r().complaint_contact).toMatch(/020 7946 0000/);
    expect(db.tables.onboarding_steps.find((s) => s.step_key === "make_it_right")?.status).toBe("done");

    // The menu: a photo arrives through the web chat's upload.
    await db.client.storage.from("onboarding-uploads").upload(`${R}/incoming/menu1.jpg`, await menuPhoto(), { contentType: "image/jpeg" });
    const { checkUploadedFiles } = await import("@/lib/onboarding/dina/uploads-store");
    const { noteForFiles } = await import("@/lib/onboarding/dina/whatsapp-turn");
    const files = await checkUploadedFiles(R, [`${R}/incoming/menu1.jpg`]);
    const read = await noteForFiles(R, "menu", files.saved, "in the chat");
    console.log(`\n[code read the menu] ${read}`);
    expect(read).toMatch(/Code read the menu: 5 dishes in 2 sections/);
    await say("📎 a photo", { note: read });

    const card = lastCard("editable_card");
    const allergens = await say("Looks right", { tap: { messageId: card.id, choiceId: "confirm" } });
    expect(r().menu.flatMap((c: { items: unknown[] }) => c.items)).toHaveLength(5);
    expect(r().menu.flatMap((c: { items: { allergens_confirmed: boolean }[] }) => c.items).every((i: { allergens_confirmed: boolean }) => !i.allergens_confirmed)).toBe(true);
    expect(allergens.messages.some((m) => m.component?.type === "allergen_check")).toBe(true);

    await say("That's right", { tap: { messageId: lastCard("allergen_check").id, choiceId: "allergen_ok" } });
    await say("Not sure", { tap: { messageId: lastCard("allergen_check").id, choiceId: "allergen_unsure" } });
    const hours = await say("Do the rest later", { tap: { messageId: lastCard("allergen_check").id, choiceId: "allergen_later" } });
    const menu = db.tables.onboarding_steps.find((s) => s.step_key === "menu");
    expect(menu?.status).toBe("partial");
    console.log("\n[menu saved]", JSON.stringify(r().menu));

    // Hours and the first common questions.
    if (!hours.messages.some((m) => m.component?.type === "editable_card")) await say("Sure, let's do hours");
    await say("Monday to Saturday 12 till 10pm, closed on Sundays");
    const hoursCard = lastCard("editable_card");
    await say("Looks right", { tap: { messageId: hoursCard.id, choiceId: "confirm" } });
    expect(r().opening_hours).toMatchObject({ Monday: "12:00 – 22:00", Sunday: "Closed" });
    await say("Yes, all our meat is HMC certified");
    await say("There's a free car park behind us");
    expect(r().faqs).toMatchObject({ halal: expect.stringMatching(/HMC/), parking: expect.stringMatching(/car park/i) });
    expect(r().halal_statement).toMatch(/HMC/);

    const cost = db.tables.onboarding_ai_usage.reduce((s, u) => s + Number(u.cost_usd), 0);
    console.log(`\nTotal for this run: $${cost.toFixed(4)} (plus the allergen suggestions, which aren't logged per run yet)`);
  });
});
