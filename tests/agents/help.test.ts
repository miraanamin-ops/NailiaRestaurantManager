// The owner help guide (agents/help.md) and the how_to route: the guide covers every
// WhatsApp shortcut and every onboarding step; "your setup" lines; the answer's
// rules; and the flow with a stand-in Claude (answered and checked, an offer to do
// it, not covered, one retry after the fact check).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { helpCommands, helpProblems, setupLines, type SetupFacts } from "@/lib/agents/help-rules";
import { memoryDb } from "../support/memory-db";

const guide = readFileSync(join("agents", "help.md"), "utf8");

describe("the help guide covers everything an owner can do", () => {
  test("every shortcut in the WhatsApp HELP text", async () => {
    vi.doMock("server-only", () => ({}));
    const { HELP_TEXT } = await import("@/lib/bot/commands");
    const commands = helpCommands(HELP_TEXT);
    expect(commands).toEqual(expect.arrayContaining(["APPROVE ALL", "UNDO", "PAUSE", "EXPORT CUSTOMERS", "ADD STAFF", "ROTA"]));
    expect(commands.filter((c) => !guide.includes(c))).toEqual([]);
  });

  test("every onboarding chapter and step", async () => {
    const { availableChapters } = await import("@/lib/onboarding/guide/chapters");
    const { STEP_DEFS, availableSteps } = await import("@/lib/onboarding/flow");
    expect(availableChapters().map((c) => c.title).filter((t) => !guide.includes(t))).toEqual([]);
    expect(availableSteps().map((s) => STEP_DEFS[s].title).filter((t) => !guide.includes(t))).toEqual([]);
  });

  test("the common questions the owner listed", () => {
    for (const topic of ["QR", "sign-up reward", "Email offers", "Importing a customer list", "Reviews", "Google", "till report", "Rota", "PAUSE", "UNDO", "Export", "Delete my data", "billing"]) expect(guide, topic).toContain(topic);
  });

  test("owner words only: no internal names", () => {
    expect(guide).not.toMatch(/\b(GM|router|composer|Insights|Growth agent|Reputation agent|Visibility agent|checker|supabase|agent_jobs|z_reports|drafts table)\b/);
  });
});

describe("the help answer's rules", () => {
  const facts: SetupFacts = {
    google_connected: false, customers: 15, emailable_customers: 12, signup_page: "https://app.dinerai.co.uk/r/mn-test", qr_card: "https://app.dinerai.co.uk/r/mn-test/qr", qr_pack: "https://app.dinerai.co.uk/r/mn-test/qr-pack",
    signup_reward: "A free baklava", discount_cap_percent: 15, send_window: "09:00 to 21:00", paused: false, sales_days_last_30: 0, item_sales_last_30: false, dishes: 24, dishes_with_costs: 0, allergens_to_confirm: 3, staff_phones: 0, today: "2026-11-09",
  };

  test("your setup, one fact a line", () => {
    const lines = setupLines(facts).join("\n");
    expect(lines).toContain("Google Business Profile: not connected yet.");
    expect(lines).toContain("Customers on the list: 15 (12 can receive offers");
    expect(lines).toContain("QR pack (table cards, counter sign, poster) as a PDF: https://app.dinerai.co.uk/r/mn-test/qr-pack");
    expect(lines).toContain("No sales sent in the last 30 days");
    expect(lines).toContain("3 with allergens still to confirm");
    expect(setupLines({ ...facts, paused: true }).join()).toContain("PAUSED");
  });

  test("no internal words, no em-dashes, no action without an answer", () => {
    const ok = { covered: true, message: "Just send the file here and I'll do the rest.", action: "Import my customer list" };
    expect(helpProblems(ok)).toEqual([]);
    expect(helpProblems({ ...ok, message: "The GM routes it to Growth." }).join()).toMatch(/internal words/);
    expect(helpProblems({ ...ok, message: `Easy ${String.fromCharCode(0x2014)} send it.` }).join()).toMatch(/em-dash/);
    expect(helpProblems({ covered: false, message: "I'll check with the team.", action: "x" }).join()).toMatch(/can't offer an action/);
    // "table cards" is owner language, not an internal word.
    expect(helpProblems({ ...ok, message: "Print your QR table cards from Customers." })).toEqual([]);
  });
});

// ---------- The how_to route, through the real code ----------

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const SANDBOX = "whatsapp:+14155238886";
const NOW = new Date("2026-11-09T15:00:00Z");
const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "How do I import a customer list?", language: "English", question: null, options: [], pasted_review: null, open_item: null, decision: null, sales: null, ...extra });
const verdict = (pass: boolean) => ({
  verdict: pass ? "pass" : "fail",
  checks: ["F1", "F2", "F3", "F4", "F5", "C6"].map((id) => ({ id, result: pass || id !== "F1" ? "pass" : "fail", reason: pass || id !== "F1" ? null : "the guide doesn't mention a Mailchimp sync", fix: pass || id !== "F1" ? null : "remove the Mailchimp sync" })),
  minor_fixes: [],
  owner_question: null,
  notes: "",
});

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let prompts: string[];
let sent: { text: string; buttons: unknown }[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  prompts = [];
  sent = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, slug: "mn-test", name: "MN Test", is_demo: true, active: true, agent_modes: { gm: "live", insights: "live" }, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, owner_name: "Miraan", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: {}, special_hours: {}, signup_reward: "A free baklava", profile_version: 1, send_window_start: "09:00:00", send_window_end: "21:00:00",
        menu: [], discount_cap_percent: 15, trust_levels: {}, sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null, paused: false, fake_now: null,
      },
    ],
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 10).padStart(2, "0")}`, source: "seed", is_dummy: true })),
    drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], reviews: [], draft_feedback: [],
    z_reports: [], pos_imports: [], sales_items: [], sales_hours: [], customers: [], staff_numbers: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/claude", () => ({
    MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
    MODEL: "claude-sonnet-5-5",
    MAX_TOKENS: 100,
    WITH_FALLBACK: {},
    fallbackFor: () => ({}),
    claude: () => ({
      beta: {
        messages: {
          parse: async (args: { messages: { content: unknown }[] }) => {
            const c0 = args.messages[0]?.content;
            prompts.push(typeof c0 === "string" ? c0 : Array.isArray(c0) ? c0.map((c: { text?: string }) => c.text ?? "").join("\n") : "");
            const next = answers.shift();
            if (next === undefined) throw new Error("No more stand-in answers");
            return { stop_reason: "end_turn", content: [], parsed_output: next, usage: { input_tokens: 500, output_tokens: 50 }, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), chat: async () => ({ type: "text", text: "Today's answer" }) }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/assistant", "server-only"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function say(body: string, buttonPayload?: string) {
  db.tables.messages.push({ id: `m${db.tables.messages.length}`, restaurant_id: A, direction: "inbound", body, status: "received", from_number: OWNER, to_number: SANDBOX, created_at: new Date().toISOString() });
  const { handleConversation } = await import("@/lib/bot/conversation");
  const restaurant = { ...db.tables.restaurants[0] };
  const ctx = { restaurantId: A, restaurant, restaurantName: restaurant.name, now: new Date(), today: "Monday 9 November 2026", reviews: [], customers: [] };
  const send = async (text: string, buttons: unknown = false) => void sent.push({ text, buttons });
  await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: SANDBOX, to: OWNER }, send } as never, body, buttonPayload);
}

describe("how do I...?", () => {
  test("answered from the guide and the setup, checked, then sent", async () => {
    answers = [route("how_to"), { covered: true, message: "Tap *Customers*, then *Import customers*.", action: null }, verdict(true)];
    await say("how do i import a customer data list");
    expect(sent.map((s) => s.text)).toEqual(["Tap *Customers*, then *Import customers*."]);
    // The answer was written from the guide and the setup...
    expect(prompts[1]).toContain("# DinerAI help guide");
    expect(prompts[1]).toContain("Customer sign-up page: https://app.dinerai.co.uk/r/mn-test");
    // ...and checked against the guide.
    expect(prompts[2]).toContain("Reference: the DinerAI owner help guide");
    expect(db.tables.agent_jobs.some((j) => j.kind === "gm_help" && j.verdict === "answered")).toBe(true);
  });

  test("where DinerAI can do it: the answer with Yes, do it / No thanks", async () => {
    answers = [route("how_to", { request: "How do I get my QR codes?" }), { covered: true, message: "Want me to send your QR pack now? Or tap *Customers*, then *Print QR table cards*.", action: "Send me my QR code" }, verdict(true)];
    await say("how do i get my qr codes");
    const card = db.tables.drafts.find((d) => d.kind === "choice")!;
    expect(card.agent_input.options.map((o: { label: string }) => o.label)).toEqual(["Yes, do it", "No thanks"]);
    expect(sent[0]).toMatchObject({ text: expect.stringContaining("Want me to send your QR pack now?"), buttons: { buttons: "choice", options: ["Yes, do it", "No thanks"] } });
    // No thanks: nothing else happens.
    await say("No thanks", `choose:${card.id}:2`);
    expect(sent.at(-1)!.text).toMatch(/Just ask whenever/);
  });

  test("a fact the guide doesn't support goes back once with the checker's notes", async () => {
    answers = [
      route("how_to"),
      { covered: true, message: "It syncs with Mailchimp automatically.", action: null },
      verdict(false),
      { covered: true, message: "Send the file here, or tap *Customers*, then *Import customers*.", action: null },
      verdict(true),
    ];
    await say("does it sync with mailchimp?");
    expect(prompts[3]).toContain("remove the Mailchimp sync");
    expect(sent.map((s) => s.text)).toEqual(["Send the file here, or tap *Customers*, then *Import customers*."]);
  });

  test("not covered by the guide: an honest line, no guessing", async () => {
    answers = [route("how_to", { request: "Can I connect Xero?" }), { covered: false, message: "Good question. I'll check with the DinerAI team and come back to you.", action: null }];
    await say("can i connect xero");
    expect(sent.map((s) => s.text)).toEqual(["Good question. I'll check with the DinerAI team and come back to you."]);
  });
});
