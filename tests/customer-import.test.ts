// Importing a customer list (064): column mapping (the AI sees no customer data),
// cleaning (invalid, duplicates, already on the list, suppressed), the legal basis
// ("not sure" is refused), no campaign before the welcome, the welcome batches,
// hard bounces pausing an import over 5%, removing a whole import (and UNDO), the
// Resend webhook's signature, and the WhatsApp path end to end.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanRows,
  columnShapes,
  declarationQuestion,
  emailHash,
  importedContactReady,
  looksLikeCustomerList,
  mappingProblems,
  ruleMapping,
  sendRoom,
  shouldPause,
  UNKNOWN_BASIS_REPLY,
  type Table,
} from "@/lib/customer-import/rules";
import { hardBounceFrom, signWebhook, verifyWebhook } from "@/lib/email/webhook";
import { undoPlan } from "@/lib/undo-plan";
import { memoryDb } from "./support/memory-db";

const list: Table = {
  headers: ["Guest name", "E-mail address", "Mobile", "DOB", "Notes"],
  rows: [
    ["Aisha Khan", "aisha@example.com", "07700 900123", "14/03/1990", "window seat"],
    ["Ben Taylor", "BEN@example.com ", "", "", ""],
    ["Ben Taylor again", "ben@example.com", "", "", ""],
    ["No email", "not-an-email", "", "", ""],
    ["Old regular", "old@example.com", "", "", ""],
    ["Unsubscribed before", "gone@example.com", "", "", ""],
    ["Chloe Evans", "chloe@example.com", "", "1988-11-02", ""],
  ],
};
const salesFile: Table = { headers: ["Date", "Item", "Qty", "Net", "Customer email"], rows: [["2026-11-01", "Lamb chops", 2, 28, "a@example.com"]] };

describe("the columns", () => {
  test("found by heading, in a booking system's own words", () => {
    expect(ruleMapping(list)).toEqual({ email: 1, name: 0, phone: 2, birthday: 3 });
    expect(mappingProblems(list, ruleMapping(list))).toEqual([]);
  });

  test("what the AI sees: headings and shapes, never a customer's details", () => {
    const shapes = JSON.stringify(columnShapes(list));
    for (const secret of ["aisha", "Aisha", "07700", "1990", "window"]) expect(shapes).not.toContain(secret);
    expect(columnShapes(list)[1]).toMatchObject({ header: "E-mail address", email_like_pct: 86 });
  });

  test("a wrong mapping from the AI is caught by code", () => {
    expect(mappingProblems(list, { email: 0, name: 1, phone: null, birthday: null }).join()).toMatch(/doesn't hold email addresses/);
    expect(mappingProblems(list, { email: 1, name: 1, phone: null, birthday: null }).join()).toMatch(/used for two things/);
  });

  test("a customer list, not a sales file", () => {
    expect(looksLikeCustomerList(list)).toBe(true);
    expect(looksLikeCustomerList(salesFile)).toBe(false);
  });
});

describe("cleaning", () => {
  test("invalid, duplicates, already on the list, and never anyone suppressed", () => {
    const { rows, counts } = cleanRows(list, ruleMapping(list), new Set(["old@example.com"]), new Set([emailHash("gone@example.com")]));
    expect(counts).toEqual({ total: 7, invalid: 1, duplicate: 1, existing: 1, suppressed: 1, to_add: 3 });
    expect(rows).toEqual([
      { email: "aisha@example.com", name: "Aisha", phone: "07700900123", birthday: "1990-03-14" },
      { email: "ben@example.com", name: "Ben", phone: null, birthday: null },
      { email: "chloe@example.com", name: "Chloe", phone: null, birthday: "1988-11-02" },
    ]);
  });
});

describe("the legal basis and sending rules", () => {
  test("'not sure' is refused, with the reason in plain words", () => {
    expect(UNKNOWN_BASIS_REPLY).toMatch(/even a "please confirm" email is marketing/);
    expect(declarationQuestion("opted_in", "MN Test", 3)).toContain("the 3 people in this list opted in to receive marketing from MN Test");
  });

  test("no campaign reaches an imported contact before their welcome", () => {
    expect(importedContactReady({ source: "import", import_status: "not_contacted", email_confirmed_at: null })).toBe(false);
    expect(importedContactReady({ source: "import", import_status: "welcomed", email_confirmed_at: null })).toBe(true);
    expect(importedContactReady({ source: "import", import_status: "awaiting_confirm", email_confirmed_at: null })).toBe(false);
    expect(importedContactReady({ source: "import", import_status: "awaiting_confirm", email_confirmed_at: "2026-11-09T10:00:00Z" })).toBe(true);
    // Sign-ups and the setup-time import are unchanged: confirmed email.
    expect(importedContactReady({ source: "signup", import_status: null, email_confirmed_at: null })).toBe(false);
    expect(importedContactReady({ source: "import", import_status: null, email_confirmed_at: "2026-11-09T10:00:00Z" })).toBe(true);
  });

  test("bounces over 5% pause an import; daily and hourly caps", () => {
    expect(shouldPause(19, 2)).toBe(false); // too few sent to judge
    expect(shouldPause(20, 1)).toBe(false); // 5%
    expect(shouldPause(20, 2)).toBe(true); // 10%
    expect(shouldPause(10, 3)).toBe(true); // 3 bounces early on
    expect(sendRoom(0, 500)).toBe(10);
    expect(sendRoom(45, 500)).toBe(5);
    expect(sendRoom(50, 500)).toBe(0);
  });

  test("UNDO on an import removes the whole batch", () => {
    expect(undoPlan({ action: "customers_imported", data: { import_id: "imp-1" } }, null, "dummy")).toEqual({ type: "remove_import", importId: "imp-1" });
  });
});

describe("Resend's webhook", () => {
  const secret = `whsec_${Buffer.from("test-secret-123").toString("base64")}`;
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "em_1", to: ["ben@example.com"], bounce: { type: "Permanent" } } });
  const now = 1_800_000_000;
  const sig = signWebhook(secret, "msg_1", String(now), body);

  test("only a correctly signed, recent event is accepted", () => {
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(true);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, `${body} `, now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, body, now + 3600)).toBe(false);
    expect(verifyWebhook("", { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
  });

  test("a hard bounce, not a full inbox", () => {
    expect(hardBounceFrom(JSON.parse(body))).toEqual({ address: "ben@example.com", emailId: "em_1" });
    expect(hardBounceFrom({ type: "email.bounced", data: { to: ["x@example.com"], bounce: { type: "Transient" } } })).toBeNull();
    expect(hardBounceFrom({ type: "email.delivered", data: { to: ["x@example.com"] } })).toBeNull();
  });
});

// ---------- Through the real code ----------

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = "whatsapp:+447700900111";
const SANDBOX = "whatsapp:+14155238886";
const NOW = new Date("2026-11-09T12:00:00Z");
const csv = (t: Table) => Buffer.from([t.headers.join(","), ...t.rows.map((r) => r.map((c) => String(c ?? "")).join(","))].join("\n"));

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let prompts: string[];
let sent: { text: string; buttons: unknown }[];
let emails: { kind: string; to: string; reason?: string; reward?: string | null }[];
let alerts: string[];
let ownerMessages: string[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("TEST_MODE", "true");
  answers = [];
  prompts = [];
  sent = [];
  emails = [];
  alerts = [];
  ownerMessages = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, slug: "mn-test", name: "MN Test", is_demo: true, active: true, agent_modes: { gm: "live", insights: "live" }, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, owner_name: "Miraan", owner_language: "English",
        quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00", opening_hours: {}, special_hours: {}, signup_reward: "A free baklava", profile_version: 1, send_window_start: "09:00:00", send_window_end: "21:00:00",
        menu: [], discount_cap_percent: 15, trust_levels: {}, sign_off_name: null, complaint_contact: null, recovery_offers: [], halal_statement: null, allergen_statement: null, paused: false, fake_now: null,
      },
    ],
    sales_days: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, restaurant_id: A, day: `2026-10-${String(i + 10).padStart(2, "0")}`, source: "seed", is_dummy: true })),
    customers: [{ id: "c-old", restaurant_id: A, name: "Old", email: "old@example.com", source: "signup", marketing_opt_in: true, email_confirmed_at: "2026-10-01T10:00:00Z", unsubscribed_at: null, deleted_at: null }],
    email_suppressions: [{ id: "sup-1", restaurant_id: A, email_hash: emailHash("gone@example.com"), reason: "unsubscribed" }],
    customer_imports: [], consents: [], rewards: [], drafts: [], campaigns: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], messages: [], reviews: [], draft_feedback: [],
    z_reports: [], pos_imports: [], sales_items: [], sales_hours: [], staff_numbers: [], unanswered_questions: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_key: string, text: string) => void alerts.push(text) }));
  vi.doMock("@/lib/notify", async (orig) => ({ ...(await orig<object>()), messageOwner: async (_c: unknown, text: string) => void ownerMessages.push(text) }));
  vi.doMock("@/lib/email", async (orig) => ({
    ...(await orig<object>()),
    sendImportWelcomeEmail: async (i: { customer: { email: string }; reason: string; reward: { reward: string } | null }) => {
      emails.push({ kind: "welcome", to: i.customer.email, reason: i.reason, reward: i.reward?.reward ?? null });
      return { delivery: "simulated", id: `em_${i.customer.email}`, to: null, redirectedFrom: null };
    },
    sendConfirmEmail: async (i: { customer: { email: string } }) => {
      emails.push({ kind: "confirm", to: i.customer.email });
      return { delivery: "simulated", id: `em_${i.customer.email}`, to: null, redirectedFrom: null };
    },
  }));
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
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/notify", "@/lib/email"]) vi.doUnmock(m);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;

async function preview() {
  const { previewImport } = await import("@/lib/customer-import");
  answers.push({ email: 1, name: 0, phone: 2, birthday: 3 }); // the AI's column mapping
  return previewImport({ restaurantId: A, table: list, bytes: csv(list), fileName: "guests.csv", channel: "web", createdBy: "owner@example.com" });
}

describe("the import, start to finish", () => {
  test("preview: the AI maps the columns from their shapes; already-listed and suppressed people are left out", async () => {
    const p = await preview();
    expect(p.ok).toBe(true);
    expect(prompts[0]).not.toContain("aisha");
    expect(db.tables.customer_imports[0]).toMatchObject({ status: "preview", mapped_by: "ai", rows_total: 7, rows_existing: 1, rows_suppressed: 1, rows_to_add: 3 });
    expect(db.tables.customers).toHaveLength(1); // nothing saved yet
    expect(p.ok && p.lines[0]).toBe("📇 *3 new customers* to add, out of 7 rows (email, name, phone, birthday).");
  });

  test("'don't know' can't be imported", async () => {
    const p = await preview();
    const { confirmImport } = await import("@/lib/customer-import");
    const r = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "unknown", declaredBy: "owner@example.com", doubleOptIn: false });
    expect(r).toEqual({ ok: false, text: UNKNOWN_BASIS_REPLY });
    expect(db.tables.customers).toHaveLength(1);
    expect(db.tables.customer_imports[0].status).toBe("cancelled");
  });

  test("confirmed: contacts added with basis, declaration and file hash; a welcome to approve; no campaign before it", async () => {
    const p = await preview();
    const { confirmImport } = await import("@/lib/customer-import");
    const r = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "owner@example.com", doubleOptIn: false, declaration: "I confirm..." });
    expect(r.ok && r.added).toBe(3);
    const imported = db.tables.customers.filter((c) => c.source === "import");
    expect(imported).toHaveLength(3);
    expect(imported[0]).toMatchObject({ import_basis: "opted_in", import_declared_by: "owner@example.com", import_file_hash: expect.stringMatching(/^[0-9a-f]{64}$/), import_status: "not_contacted", marketing_opt_in: true });
    expect(db.tables.consents).toHaveLength(3);
    expect(db.tables.customer_imports[0]).toMatchObject({ status: "imported", basis: "opted_in", declared_by: "owner@example.com", declaration: expect.stringContaining("I confirm..."), preview_rows: null });
    expect(db.tables.drafts[0]).toMatchObject({ kind: "import_welcome", status: "pending", waiting_for: "decision" });
    expect(db.tables.audit_log.some((l) => l.action === "customers_imported")).toBe(true);
    // Campaigns: the imported contacts aren't eligible yet.
    const { recipientsFor } = await import("@/lib/campaigns");
    const { eligible } = await recipientsFor(restaurant(), "everyone", NOW);
    expect(eligible.map((c: { email: string | null }) => c.email)).toEqual(["old@example.com"]);
  });

  test("approved: welcomes go out in batches with the reward; then campaigns can reach them", async () => {
    const p = await preview();
    const { confirmImport, approveImportWelcome, runImportWelcomes } = await import("@/lib/customer-import");
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "past_customers", declaredBy: "owner@example.com", doubleOptIn: false });
    const draft = c.ok ? c.draft : null;
    expect(await approveImportWelcome(restaurant(), draft!)).toMatch(/batches of up to 50 a day/);
    expect(db.tables.customer_imports[0].status).toBe("sending");
    await runImportWelcomes(restaurant(), NOW);
    expect(emails).toEqual([
      { kind: "welcome", to: "aisha@example.com", reason: "you've been a customer at MN Test", reward: "A free baklava" },
      { kind: "welcome", to: "ben@example.com", reason: "you've been a customer at MN Test", reward: "A free baklava" },
      { kind: "welcome", to: "chloe@example.com", reason: "you've been a customer at MN Test", reward: "A free baklava" },
    ]);
    expect(db.tables.customers.filter((x) => x.source === "import").every((x) => x.import_status === "welcomed" && x.welcome_sent_at)).toBe(true);
    expect(db.tables.customer_imports[0].status).toBe("done");
    const { recipientsFor } = await import("@/lib/campaigns");
    expect((await recipientsFor(restaurant(), "everyone", NOW)).eligible).toHaveLength(4);
  });

  test("nothing goes out outside sending hours", async () => {
    const p = await preview();
    const { confirmImport, approveImportWelcome, runImportWelcomes } = await import("@/lib/customer-import");
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: false });
    await approveImportWelcome(restaurant(), c.ok ? c.draft : (null as never));
    await runImportWelcomes(restaurant(), new Date("2026-11-09T22:30:00Z"));
    expect(emails).toEqual([]);
  });

  test("double opt-in: a confirm email instead, and they only count once confirmed", async () => {
    const p = await preview();
    const { confirmImport, approveImportWelcome, runImportWelcomes } = await import("@/lib/customer-import");
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: true });
    expect(db.tables.customers.filter((x) => x.source === "import").every((x) => x.import_status === "awaiting_confirm" && x.marketing_opt_in === false && x.confirm_token)).toBe(true);
    await approveImportWelcome(restaurant(), c.ok ? c.draft : (null as never));
    await runImportWelcomes(restaurant(), NOW);
    expect(emails.map((e) => e.kind)).toEqual(["confirm", "confirm", "confirm"]);
    const { recipientsFor } = await import("@/lib/campaigns");
    expect((await recipientsFor(restaurant(), "everyone", NOW)).eligible).toHaveLength(1);
  });

  test("hard bounces: never emailed again (anywhere), and the contact marked", async () => {
    // A bigger list: 25 people, 2 of whom bounce (8%).
    const big: Table = { headers: ["email"], rows: Array.from({ length: 25 }, (_, i) => [`guest${i}@example.com`]) };
    const { previewImport, confirmImport, approveImportWelcome, runImportWelcomes, recordHardBounce } = await import("@/lib/customer-import");
    answers.push({ email: 0, name: null, phone: null, birthday: null });
    const p = await previewImport({ restaurantId: A, table: big, bytes: csv(big), fileName: "big.csv", channel: "web", createdBy: "o" });
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: false });
    await approveImportWelcome(restaurant(), c.ok ? c.draft : (null as never));
    // Three hourly runs: 10 + 10 + 5 (the hourly cap).
    for (let h = 0; h < 3; h++) await runImportWelcomes(restaurant(), new Date(NOW.getTime() + h * 3600_000));
    expect(emails).toHaveLength(25);
    await recordHardBounce("guest3@example.com", "em_guest3@example.com");
    expect(db.tables.customer_imports[0].status).toBe("done");
    // The import was already done; a pause needs it to be sending: start a fresh one to test the pause.
    expect(db.tables.email_suppressions.some((s) => s.restaurant_id === null && s.email_hash === emailHash("guest3@example.com") && s.reason === "hard_bounce")).toBe(true);
    expect(db.tables.customers.find((x) => x.email === "guest3@example.com")!.bounced_at).toBeTruthy();
  });

  test("a sending import with too many bounces is paused", async () => {
    const big: Table = { headers: ["email"], rows: Array.from({ length: 40 }, (_, i) => [`guest${i}@example.com`]) };
    const { previewImport, confirmImport, approveImportWelcome, runImportWelcomes, recordHardBounce } = await import("@/lib/customer-import");
    answers.push({ email: 0, name: null, phone: null, birthday: null });
    const p = await previewImport({ restaurantId: A, table: big, bytes: csv(big), fileName: "old-list.csv", channel: "web", createdBy: "o" });
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: false });
    await approveImportWelcome(restaurant(), c.ok ? c.draft : (null as never));
    await runImportWelcomes(restaurant(), NOW);
    await runImportWelcomes(restaurant(), new Date(NOW.getTime() + 3600_000));
    expect(emails).toHaveLength(20);
    await recordHardBounce("guest0@example.com", "em_guest0@example.com");
    expect(db.tables.customer_imports[0].status).toBe("sending"); // 1 of 20: 5%
    await recordHardBounce("guest1@example.com", "em_guest1@example.com");
    expect(db.tables.customer_imports[0]).toMatchObject({ status: "paused", paused_reason: "2 of 20 welcome emails bounced" });
    expect(alerts[0]).toMatch(/paused sending to an imported customer list/);
    expect(ownerMessages[0]).toMatch(/The list looks out of date/);
    // Paused: no more welcomes.
    await runImportWelcomes(restaurant(), new Date(NOW.getTime() + 2 * 3600_000));
    expect(emails).toHaveLength(20);
  });

  test("removing a whole import, in one go (UNDO or the customers page)", async () => {
    const p = await preview();
    const { confirmImport, removeImport } = await import("@/lib/customer-import");
    await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: false });
    const r = await removeImport(A, p.ok ? p.imp.id : "");
    expect(r).toMatchObject({ ok: true, removed: 3 });
    expect(db.tables.customers.map((c) => c.email)).toEqual(["old@example.com"]);
    expect(db.tables.consents).toHaveLength(0);
    expect(db.tables.customer_imports[0].status).toBe("undone");
    expect(db.tables.drafts[0].status).toBe("withdrawn");
  });

  test("unsubscribing puts the address on the suppression list, so a later import skips it", async () => {
    const { suppress, suppressedHashes } = await import("@/lib/customer-import/suppression");
    await suppress(A, "ben@example.com", "unsubscribed");
    expect((await suppressedHashes(A)).has(emailHash("ben@example.com"))).toBe(true);
    const p = await preview();
    expect(p.ok && p.imp.rows_suppressed).toBe(2);
  });
});

describe("on WhatsApp", () => {
  const route = (r: string, extra: Record<string, unknown> = {}) => ({ route: r, request: "Owner's ask", language: "English", question: null, options: [], pasted_review: null, open_item: null, decision: null, sales: null, import_basis: null, double_opt_in: null, ...extra });

  async function say(body: string) {
    db.tables.messages.push({ id: `m${db.tables.messages.length}`, restaurant_id: A, direction: "inbound", body, status: "received", from_number: OWNER, to_number: SANDBOX, created_at: new Date().toISOString() });
    const { handleConversation } = await import("@/lib/bot/conversation");
    const r = { ...db.tables.restaurants[0] };
    const ctx = { restaurantId: A, restaurant: r, restaurantName: r.name, now: new Date(), today: "Monday 9 November 2026", reviews: [], customers: [] };
    await handleConversation({ ctx, owner: OWNER, channel: { restaurantId: A, from: SANDBOX, to: OWNER }, send: async (text: string, buttons: unknown = false) => void sent.push({ text, buttons }) } as never, body, undefined);
  }

  test("the owner sends the file, says how they agreed in their own words, confirms, and gets the welcome to approve", async () => {
    const { salesFromMedia } = await import("@/lib/sales/whatsapp");
    const replies: string[] = [];
    answers.push({ email: 1, name: 0, phone: 2, birthday: 3 });
    const outcome = await salesFromMedia({ restaurantId: A, number: OWNER, role: "owner", reply: async (t) => void replies.push(t) }, { bytes: csv(list), contentType: "text/csv" }, "", NOW);
    expect(outcome).toBe("handled");
    expect(replies[0]).toMatch(/^📇 \*3 new customers\* to add/);
    expect(replies[0]).toMatch(/how did these people agree to hear from you\?/);
    expect(replies[0]).not.toMatch(/^\d\. /m); // no numbered options (1 means Approve)

    answers = [route("answer_open", { open_item: "import", import_basis: "opted_in", request: "They ticked a box on OpenTable" })];
    await say("they all ticked the marketing box on opentable");
    expect(prompts.at(-1)).toContain('ref "import"');
    expect(sent.at(-1)!.text).toMatch(/opted in to receive marketing from MN Test/);
    expect(db.tables.customers).toHaveLength(1); // still nothing saved

    answers = [route("answer_open", { open_item: "import", decision: "yes", request: "Yes, confirm the declaration" })];
    await say("yes thats true");
    expect(db.tables.customers.filter((c) => c.source === "import")).toHaveLength(3);
    expect(db.tables.customers.find((c) => c.source === "import")!.import_declared_by).toBe(OWNER);
    expect(sent.at(-2)!.text).toMatch(/^✅ Added 3 customers to your list\. Nobody has been emailed yet/);
    expect(sent.at(-1)!.buttons).toBe(true);
  });

  test("'not sure' on WhatsApp: refused, explained, nothing imported", async () => {
    const { salesFromMedia } = await import("@/lib/sales/whatsapp");
    answers.push({ email: 1, name: 0, phone: 2, birthday: 3 });
    await salesFromMedia({ restaurantId: A, number: OWNER, role: "owner", reply: async () => undefined }, { bytes: csv(list), contentType: "text/csv" }, "", NOW);
    answers = [route("answer_open", { open_item: "import", import_basis: "unknown", request: "Not sure how they agreed" })];
    await say("no idea to be honest, i just have their emails");
    expect(sent.at(-1)!.text).toBe(UNKNOWN_BASIS_REPLY);
    expect(db.tables.customers).toHaveLength(1);
    expect(db.tables.customer_imports[0].status).toBe("cancelled");
  });

  test("a staff phone can't import a list", async () => {
    const { salesFromMedia } = await import("@/lib/sales/whatsapp");
    const replies: string[] = [];
    await salesFromMedia({ restaurantId: A, number: "whatsapp:+447700900222", role: "staff", reply: async (t) => void replies.push(t) }, { bytes: csv(list), contentType: "text/csv" }, "", NOW);
    expect(replies[0]).toMatch(/only the owner can import one/);
    expect(db.tables.customer_imports).toHaveLength(0);
  });

  test("Approve, Edit and Skip on the welcome", async () => {
    const { decideImportWelcome, IMPORT_WELCOME_EDIT } = await import("@/lib/bot/decisions");
    const p = await preview();
    const { confirmImport } = await import("@/lib/customer-import");
    const c = await confirmImport({ restaurant: restaurant(), importId: p.ok ? p.imp.id : "", basis: "opted_in", declaredBy: "o", doubleOptIn: false });
    const draft = c.ok ? c.draft : (null as never);
    expect(await decideImportWelcome(restaurant(), draft, "edit")).toBe(IMPORT_WELCOME_EDIT);
    expect(await decideImportWelcome(restaurant(), draft, "skip")).toMatch(/nobody on that list will be emailed/);
    expect(db.tables.customer_imports[0].status).toBe("imported");
  });
});
