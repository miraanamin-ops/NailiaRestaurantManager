// One whole onboarding with the REAL Claude, on the in-memory database: the real
// sign-up (invite code, no paywall), then the real web chat endpoint, turn by turn,
// with a scripted owner answering whatever Dina asks (basics, Google, tone, making
// it right, a menu photo, allergens, hours and FAQs), then WhatsApp linked by the
// sign-up number, until setup finishes and the summary shows. Nothing is sent
// (WhatsApp and email are stand-ins). Prints the conversation, every stumble
// (the fallback line, a refused tool, a reply sent back, a step that took many
// turns) and the total cost. About $0.25 to $0.40. Run on its own:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-full.e2e.ts
import sharp from "sharp";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { fakeAfter, flushAfter } from "../support/after";
import { memoryDb } from "../support/memory-db";

let db: ReturnType<typeof memoryDb>;
let restaurantId = "";
const NUMBER = "whatsapp:+447700900123";
const stumbles: string[] = [];
const sentWhatsApp: string[] = [];

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  delete process.env.GOOGLE_MODE; // dummy Google: acceptance is simulated
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.ONBOARDING_REQUIRES_PAYMENT;
  process.env.GOOGLE_MANAGER_EMAIL = "dina@dinerai.co.uk";
  db = memoryDb(
    {
      restaurants: [],
      onboarding: [],
      onboarding_sessions: [],
      onboarding_steps: [],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      reviews: [],
      messages: [],
      google_connections: [],
      rate_limits: [],
      staff: [],
      jobs: [],
      pilot_invites: [{ code: "FULL-RUN", max_uses: 1, used_count: 0, active: true, expires_at: null, type: "pilot" }],
    },
    {
      unique: ["onboarding_messages.external_id"],
      rpc: {
        claim_pilot_invite: ({ p_code }, tables) => {
          const row = tables.pilot_invites.find((i) => i.code === String(p_code).trim().toUpperCase());
          if (!row || (row.used_count as number) >= (row.max_uses as number)) return false;
          row.used_count = (row.used_count as number) + 1;
          return true;
        },
      },
    },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    emailLoginLink: async () => null,
    startSignupSession: async () => ({ ok: true }),
    currentOwner: async () => ({ email: "amina@grill.test", isBuilder: false, restaurantIds: [restaurantId], allowed: true }),
  }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (stumbles.push(`builder alert: ${m.slice(0, 160)}`), "sent") }));
  vi.doMock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), overLimit: async () => false }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async () => ({ delivery: "simulated", id: null, to: null, redirectedFrom: null }) }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sentWhatsApp.push(body), { sid: "SM", body }),
    sendImage: async (_f: string, _t: string, _u: string, body: string) => (sentWhatsApp.push(body), { sid: "SM", body }),
    sendDinaChoices: async (_f: string, _t: string, m: { body: string }) => (sentWhatsApp.push(m.body), { sid: "SM", body: m.body, usedButtons: true }),
  }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
  vi.doMock("next/headers", () => ({ headers: async () => new Headers({ host: "app.test", "x-forwarded-for": "203.0.113.9" }) }));
  vi.doMock("next/navigation", () => ({
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  }));
});

type Msg = { id: string; role: string; text: string; component?: { type: string; [k: string]: unknown } | null };
const shown: Msg[] = [];
let turns = 0;

// One action through the real chat endpoint, as the browser sends it.
async function chat(action: Record<string, unknown>, label: string) {
  const { POST } = await import("@/app/api/onboarding/chat/route");
  const body = { r: restaurantId, action: action.kind === "start" ? action : { ...action, clientId: crypto.randomUUID() } };
  const res = await POST(new Request("https://app.test/api/onboarding/chat", { method: "POST", body: JSON.stringify(body) }));
  const text = await res.text();
  turns++;
  const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n--- owner: ${label}`);
  for (const e of events) {
    if (e.type === "message") {
      shown.push(e.message);
      console.log(`Dina: ${e.message.text}${e.message.component ? `  [${e.message.component.type}]` : ""}`);
      if (/^Sorry, I didn't quite manage that/.test(e.message.text)) stumbles.push(`fallback line after "${label}"`);
    }
    if (e.type === "error") stumbles.push(`chat error after "${label}": ${e.text}`);
  }
  await new Promise((r) => setTimeout(r, 5));
}

const step = () => db.tables.onboarding_sessions[0]?.current_step as string | null;
const lastDina = () => [...shown].reverse().find((m) => m.role === "dina")!;
const tapped = new Set<string>();

async function menuPhoto() {
  const lines = ["EMBER & SPICE GRILL", "", "GRILLS", "Lamb Chops ........ £14.00", "Chicken Tikka ..... £11.50", "Mixed Grill ....... £18.00", "", "SIDES", "Garlic Naan ....... £3.00", "Chips ............. £3.50"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><rect width="100%" height="100%" fill="#fffaf0"/>${lines.map((l, i) => `<text x="80" y="${110 + i * 70}" font-family="Georgia, serif" font-size="${i === 0 ? 48 : 40}" fill="#222">${l.replace(/&/g, "&amp;")}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

// What the owner does next, from the step and Dina's last message.
async function ownerMove() {
  const m = lastDina();
  const c = m.component;
  const t = m.text.toLowerCase();
  // The question being asked: the last sentence with a question mark (not what she just noted).
  const asked = (m.text.match(/[^.!?]*\?/g)?.at(-1) ?? m.text).toLowerCase();
  const answerTap = async (choiceId: string, label: string) => {
    tapped.add(m.id);
    await chat({ kind: "answer", messageId: m.id, choiceId, label }, `taps "${label}"`);
  };
  if (c?.type === "confirmation") return chat({ kind: "confirm", messageId: m.id, changes: {} }, 'taps "Looks right"');
  if (c?.type === "steps") return answerTap("invited", "Done, I've invited you");
  if (c?.type === "choice_cards") return tapped.size % 2 ? answerTap("short", "Short and simple") : answerTap("warm", "Warm and personal");
  if (c?.type === "dish_check") {
    const n = shown.filter((x) => x.component?.type === "dish_check").length;
    return n <= 2 ? answerTap("allergen_ok", "That's right") : answerTap("allergen_later", "Do the rest later");
  }
  if (c?.type === "upload") {
    await db.client.storage.from("onboarding-uploads").upload(`${restaurantId}/incoming/menu.jpg`, await menuPhoto(), { contentType: "image/jpeg" });
    return chat({ kind: "files", paths: [`${restaurantId}/incoming/menu.jpg`] }, "uploads a menu photo");
  }
  if (c?.type === "quick_replies") {
    const opts = (c.options as { id: string; label: string }[]) ?? [];
    const pick = (re: RegExp) => opts.find((o) => re.test(`${o.id} ${o.label}`.toLowerCase()));
    const choice =
      (/phone or a laptop/.test(t) && pick(/laptop/)) ||
      (/owner or (the |a )?manager/.test(t) && pick(/owner/)) ||
      (/queue/.test(t) && pick(/no/)) ||
      pick(/^yes|yes,|certified|both|free|step/) ||
      null;
    if (choice && step() !== "make_it_right" && step() !== "hours_faqs") return answerTap(choice.id, choice.label);
  }
  // Words, by what's being asked.
  if (step() === "hello") {
    // Google Maps matches: ours isn't among them (the name is made up), so the address.
    if (/google maps|which one|matches/.test(t)) return chat({ kind: "message", text: "None of those, we're at 12 High Street, London E1 6AN" }, "none of the matches, with the address");
    if (/cuisine|kind of food|type of food/.test(t)) return chat({ kind: "message", text: "We're a halal grill" }, '"We\'re a halal grill"');
    if (/address/.test(t)) return chat({ kind: "message", text: "12 High Street, London E1 6AN" }, "the address");
    if (/owner or|manager/.test(t)) return chat({ kind: "message", text: "I'm the owner" }, '"I\'m the owner"');
    return chat({ kind: "message", text: "Yes, that's right" }, '"Yes, that\'s right"');
  }
  if (step() === "make_it_right") {
    if (/who handles|who deals|name and role/.test(t)) return chat({ kind: "message", text: "Me, Amina, the owner. They can call 020 7946 0000" }, "who handles complaints");
    return chat({ kind: "message", text: "Invite them back for a free dessert, or ask them to call us. Complaints go to me, Amina, the owner, on 020 7946 0000" }, "the offers and handler");
  }
  if (step() === "hours_faqs") {
    const faq: [RegExp, string][] = [
      [/halal/, "Yes, all our meat is HMC certified"],
      [/park/, "There's a free car park behind us"],
      [/deliver|collection/, "Deliveroo and Uber Eats, and collection"],
      [/book/, "Yes, by phone or on our website"],
      [/wheelchair|access|step/, "Step-free entrance and an accessible toilet"],
      [/child|kids/, "Very welcome: high chairs and a kids' menu"],
      [/private|hire|event/, "Yes, the upstairs room seats 30"],
    ];
    const hit = faq.find(([re]) => re.test(asked));
    if (hit) return chat({ kind: "message", text: hit[1] }, `"${hit[1]}"`);
    if (/hour|open/.test(asked)) return chat({ kind: "message", text: "Monday to Saturday 12 till 10pm, closed on Sundays" }, "the hours");
  }
  return chat({ kind: "message", text: "Yes please, carry on" }, '"Yes please, carry on"');
}

describe("a whole onboarding, for real", () => {
  test("sign-up to the summary", async () => {
    const { startSignup } = await import("@/app/start/actions");
    const form = new FormData();
    for (const [k, v] of Object.entries({ owner_name: "Amina Khan", email: "amina@grill.test", restaurant_name: "Ember & Spice Grill", whatsapp: "07700 900123", terms: "yes", invite: "FULL-RUN" })) form.set(k, v);
    let to = "";
    try {
      await startSignup(form);
    } catch (e) {
      await flushAfter();
      if (!(e instanceof Redirect)) throw e;
      to = e.to;
    }
    restaurantId = db.tables.restaurants[0].id as string;
    console.log(`Sign-up -> ${to}`);
    expect(to).toBe(`/onboarding/chat?r=${restaurantId}`);

    await chat({ kind: "start" }, "opens the chat");
    const turnsAt: Record<string, number> = {};
    while (turns < 60 && step()) {
      const s = step()!;
      turnsAt[s] = (turnsAt[s] ?? 0) + 1;
      await ownerMove();
    }
    for (const [s, n] of Object.entries(turnsAt)) if (n > 8) stumbles.push(`${s} took ${n} turns`);
    console.log(`\nAll steps dealt with after ${turns} turns. Linking WhatsApp by the sign-up number...`);

    const { linkSignupNumber } = await import("@/lib/onboarding/entry");
    await linkSignupNumber(NUMBER, "whatsapp:+14155238886", [restaurantId]);
    console.log("\n[WhatsApp after linking]");
    for (const b of sentWhatsApp) console.log(`  > ${b.slice(0, 300).replace(/\n/g, " / ")}`);

    const r = db.tables.restaurants[0];
    const session = db.tables.onboarding_sessions[0];
    console.log("\n[Saved]", JSON.stringify({ name: r.name, address: r.address, cuisine: r.cuisine, brand_voice: r.brand_voice, recovery_offers: r.recovery_offers, complaint_contact: r.complaint_contact, opening_hours: r.opening_hours, faqs: r.faqs, halal: r.halal_statement, dishes: (r.menu as { items: unknown[] }[] | undefined)?.reduce((n, c) => n + c.items.length, 0), active: r.active }));
    console.log("[Steps]", db.tables.onboarding_steps.map((s) => `${s.step_key}: ${s.status}${s.waiting_on ? ` (waiting on ${s.waiting_on})` : ""}`).join(", "));
    const byStep = new Map<string, number>();
    for (const u of db.tables.onboarding_ai_usage) byStep.set(`${u.step_key}/${u.purpose}`, (byStep.get(`${u.step_key}/${u.purpose}`) ?? 0) + Number(u.cost_usd));
    const total = db.tables.onboarding_ai_usage.reduce((s, u) => s + Number(u.cost_usd), 0);
    console.log("\n[Cost by step]", [...byStep].map(([k, v]) => `${k} $${v.toFixed(4)}`).join(", "));
    console.log(`[Claude calls] ${db.tables.onboarding_ai_usage.length} logged (allergen suggestions aren't in the log)`);
    console.log(`[Total] $${total.toFixed(4)} over ${turns} turns`);
    console.log(`\n[Stumbles] ${stumbles.length ? stumbles.join("\n  ") : "none"}`);

    expect(session.completed_at).toEqual(expect.any(String));
    expect(db.tables.onboarding[0].completed_at).toEqual(expect.any(String));
    expect(r.active).toBe(true);
  });
});
