// Isolation: one restaurant can never see, or send to, another's customers,
// drafts or reviews. Two restaurants' data sit in an in-memory database that
// applies every filter for real (tests/support/memory-db.ts), and the real app
// code runs against it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import twilio from "twilio";
import { fakeAfter, flushAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // Ember & Spice
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // Cardamom Corner
const OWNER_A = "whatsapp:+447700900111";
const OWNER_B = "whatsapp:+447700900222";
const SANDBOX = "whatsapp:+14155238886";
const NOON_UK = new Date("2026-10-09T11:00:00Z");

const restaurant = (id: string, extra: Record<string, unknown>) => ({
  id,
  restaurant_id: undefined,
  menu: [],
  opening_hours: {},
  discount_cap_percent: 20,
  send_window_start: "09:00:00",
  send_window_end: "21:00:00",
  paused: false,
  fake_now: null,
  whatsapp_from: SANDBOX,
  email_test_mode: true,
  active: true,
  is_demo: true,
  last_brief_at: "2026-10-09T08:05:00Z",
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});
const customer = (id: string, rid: string, name: string) => ({
  id, restaurant_id: rid, name, email: `${id}@example.com`, phone: null, birthday: null, visit_count: 1, last_visit: null,
  marketing_opt_in: true, unsubscribed_at: null, unsubscribe_token: `unsub-${id}`, source: "signup", notes: null,
  email_confirmed_at: "2026-10-01T00:00:00Z", deleted_at: null,
});
const review = (id: string, rid: string, author: string, text: string) => ({
  id, restaurant_id: rid, author_name: author, rating: 5, text, review_date: "2026-10-08T10:00:00Z", replied: false,
  reply_text: null, reply_posted_at: null, handled_at: "2026-10-08T10:00:00Z", claimed_at: null, source: "google",
});
const draft = (id: string, rid: string, reviewId: string, n: number) => ({
  id, restaurant_id: rid, kind: "review_reply", review_id: reviewId, customer_id: null, content: `Reply ${id}`,
  audience: `Google review ${id}`, status: "pending", waiting_for: null, version: 1, approved_at: null, sent_at: null,
  scheduled_for: null, block_reason: null, check_notes: null, checks: null, held_at: "2026-10-09T07:00:00Z",
  brief_number: n, briefed_at: "2026-10-09T08:05:00Z", created_at: `2026-10-09T07:0${n}:00Z`, updated_at: "2026-10-09T07:00:00Z",
});

function seed() {
  return memoryDb({
    restaurants: [
      restaurant(A, { name: "Ember & Spice Grill", slug: "ember-spice", owner_whatsapp: OWNER_A, owner_email: "a@owner.test", cuisine: "Halal grill" }),
      restaurant(B, { name: "Cardamom Corner Café", slug: "cardamom-corner", owner_whatsapp: OWNER_B, owner_email: "b@owner.test", cuisine: "Café" }),
      restaurant("cccccccc-0000-0000-0000-000000000003", { name: "Closed Diner", slug: "closed", owner_whatsapp: null, active: false }),
    ],
    customers: [customer("ca1", A, "Aisha"), customer("ca2", A, "Omar"), customer("cb1", B, "Beatrice"), customer("cb2", B, "Bilal")],
    reviews: [review("ra1", A, "Grill Fan", "Lamb chops!"), review("rb1", B, "Cafe Fan", "Cardamom latte!")],
    drafts: [draft("da1", A, "ra1", 1), draft("db1", B, "rb1", 1), draft("db2", B, "rb1", 2)],
    messages: [
      { id: "m1", restaurant_id: A, direction: "inbound", from_number: OWNER_A, to_number: SANDBOX, body: "hi from A", status: "received", created_at: new Date().toISOString() },
      { id: "m2", restaurant_id: B, direction: "inbound", from_number: OWNER_B, to_number: SANDBOX, body: "hi from B", status: "received", created_at: new Date().toISOString() },
    ],
    audit_log: [
      { id: "la1", restaurant_id: A, draft_id: null, batch_id: "batch-1", actor: "owner", action: "setting", detail: "A cap", data: { field: "discount_cap_percent", before: 20, after: 30 }, undone_at: null, created_at: new Date(Date.now() - 60_000).toISOString() },
      // Same batch id in another restaurant: must never be swept into A's UNDO.
      { id: "lb1", restaurant_id: B, draft_id: null, batch_id: "batch-1", actor: "owner", action: "setting", detail: "B cap", data: { field: "discount_cap_percent", before: 15, after: 40 }, undone_at: null, created_at: new Date().toISOString() },
    ],
  });
}

let db: ReturnType<typeof memoryDb>;
const sent: { to: string; text: string }[] = [];

beforeEach(() => {
  vi.resetModules();
  db = seed();
  sent.length = 0;
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/notify", () => ({
    messageOwner: async (channel: { to: string }, text: string) => {
      sent.push({ to: channel.to, text });
    },
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/notify");
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const rowsOf = (table: string, rid: string) => db.tables[table].filter((r) => r.restaurant_id === rid);

describe("what a restaurant's assistant can see", () => {
  test("its context holds only its own customers and reviews", async () => {
    const { loadRestaurantContext } = await import("@/lib/assistant");
    const ctx = await loadRestaurantContext(A, { realTime: true });
    expect(ids(ctx.customers)).toEqual(["ca1", "ca2"]);
    expect(ids(ctx.reviews)).toEqual(["ra1"]);
    expect(ctx.data.customer_summary.total).toBe(2);
    const ctxB = await loadRestaurantContext(B, { realTime: true });
    expect(ids(ctxB.customers)).toEqual(["cb1", "cb2"]);
    expect(ids(ctxB.reviews)).toEqual(["rb1"]);
  });

  test("Claude's look-ups only search that restaurant", async () => {
    const { loadRestaurantContext } = await import("@/lib/assistant");
    const { lookUpCustomers, lookUpReviews } = await import("@/lib/claude-data");
    const ctx = await loadRestaurantContext(A, { realTime: true });
    expect(lookUpCustomers(ctx.customers, { name: "B" }, NOON_UK)).toEqual([]); // Beatrice and Bilal are B's
    expect(lookUpReviews(ctx.reviews, { search: "latte" })).toEqual([]);
  });
});

describe("who a restaurant can send to", () => {
  test("an email campaign only reaches its own customers", async () => {
    const { recipientsFor } = await import("@/lib/campaigns");
    const a = await recipientsFor(db.tables.restaurants[0] as never, "everyone", NOON_UK);
    expect(ids(a.eligible)).toEqual(["ca1", "ca2"]);
    const b = await recipientsFor(db.tables.restaurants[1] as never, "everyone", NOON_UK);
    expect(ids(b.eligible)).toEqual(["cb1", "cb2"]);
  });

  test("the morning brief lists only its own drafts, and goes only to its own owner", async () => {
    const { sendBrief } = await import("@/lib/brief");
    const r = db.tables.restaurants[0] as never;
    const out = await sendBrief(r, { restaurantId: A, from: SANDBOX, to: OWNER_A }, NOON_UK);
    expect(out.items).toBe(1);
    expect(sent.every((m) => m.to === OWNER_A)).toBe(true);
    expect(sent.map((m) => m.text).join("\n")).not.toMatch(/db1|db2|Cafe Fan|latte/);
    // B's drafts weren't renumbered into A's brief
    expect(db.tables.drafts.find((d) => d.id === "db2")?.briefed_at).toBe("2026-10-09T08:05:00Z");
  });

  test("APPROVE ALL approves and posts only its own drafts", async () => {
    const { approveAll } = await import("@/lib/brief");
    await approveAll(db.tables.restaurants[0] as never, NOON_UK);
    expect(rowsOf("drafts", A).every((d) => d.status === "sent")).toBe(true);
    expect(rowsOf("drafts", B).every((d) => d.status === "pending")).toBe(true);
    expect(rowsOf("reviews", A)[0].replied).toBe(true);
    expect(rowsOf("reviews", B)[0].replied).toBe(false);
  });

  test("tapping a button with another restaurant's draft id does nothing to it", async () => {
    const { loadRestaurantContext } = await import("@/lib/assistant");
    const { decideTargeted } = await import("@/lib/bot/decisions");
    const ctx = await loadRestaurantContext(A, { realTime: true });
    const replies: string[] = [];
    const turn = { ctx, channel: { restaurantId: A, from: SANDBOX, to: OWNER_A }, owner: OWNER_A, send: async (t: string) => void replies.push(t) };
    await decideTargeted(turn as never, { action: "approve", draftId: "db1" });
    expect(replies[0]).toMatch(/couldn't find/);
    expect(db.tables.drafts.find((d) => d.id === "db1")?.status).toBe("pending");
    // and "APPROVE 2" only means item 2 of A's own brief (A has no item 2)
    await decideTargeted(turn as never, { action: "approve", briefNumber: 2 });
    expect(replies[1]).toMatch(/can't find item 2/);
    expect(db.tables.drafts.find((d) => d.id === "db2")?.status).toBe("pending");
  });

  test("one restaurant can't send another restaurant's draft, even approved", async () => {
    const { attemptSend } = await import("@/lib/send");
    const b = db.tables.drafts.find((d) => d.id === "db1")!;
    Object.assign(b, { status: "approved", approved_at: "2026-10-09T10:00:00Z" });
    const result = await attemptSend("db1", db.tables.restaurants[0] as never, NOON_UK, "approve");
    expect(result.outcome).toBe("blocked");
    expect(b.status).toBe("approved"); // not sent
    expect(rowsOf("reviews", B)[0].replied).toBe(false);
  });

  test("UNDO only ever reverses its own actions, even in a batch with the same id", async () => {
    const { undoLast } = await import("@/lib/undo");
    const text = await undoLast(db.tables.restaurants[0] as never, new Date());
    expect(text).toMatch(/back to 20%/);
    expect(db.tables.restaurants[0].discount_cap_percent).toBe(20);
    expect(db.tables.restaurants[1].discount_cap_percent).toBe(20); // B untouched (its own entry said 15)
    expect(db.tables.audit_log.find((e) => e.id === "lb1")?.undone_at).toBeNull();
  });
});

describe("incoming WhatsApp messages", () => {
  const TOKEN = "test-twilio-auth-token";
  const URL_ = "https://naila.test/api/whatsapp";
  const handleMessage = vi.fn(async () => {});
  const replyUnregistered = vi.fn(async () => {});

  async function post(from: string) {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    vi.doMock("@/lib/bot", () => ({ handleMessage }));
    vi.doMock("@/lib/unregistered", () => ({ replyUnregistered }));
    vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/whatsapp/route");
    const params = { From: from, To: SANDBOX, Body: "STATUS", MessageSid: `SM${Math.random()}` };
    const sig = twilio.getExpectedTwilioSignature(TOKEN, URL_, params);
    const res = await POST(
      new NextRequest(URL_, { method: "POST", body: new URLSearchParams(params), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig } }),
    );
    vi.doUnmock("@/lib/bot");
    await flushAfter();
    vi.doUnmock("@/lib/unregistered");
    vi.doUnmock("next/server");
    return res;
  }

  test("each owner's message goes to their own restaurant", async () => {
    handleMessage.mockClear();
    await post(OWNER_A);
    await post(OWNER_B);
    expect(handleMessage.mock.calls.map((c) => (c as unknown as [{ restaurantId: string }])[0].restaurantId)).toEqual([A, B]);
  });

  test("an unknown number gets the polite 'not registered' reply and nothing else", async () => {
    handleMessage.mockClear();
    replyUnregistered.mockClear();
    const res = await post("whatsapp:+447700900999");
    expect(res.status).toBe(200);
    expect(handleMessage).not.toHaveBeenCalled();
    expect(replyUnregistered).toHaveBeenCalledWith("whatsapp:+447700900999", SANDBOX);
  });

  test("a message can't act on a restaurant whose owner it isn't from", async () => {
    const { handleMessage: realHandle } = await import("@/lib/bot");
    await realHandle({ restaurantId: A, owner: OWNER_B, sandbox: SANDBOX, body: "PAUSE", buttonPayload: undefined });
    expect(sent).toEqual([]);
    expect(db.tables.restaurants[0].paused).toBe(false);
  });

  test("the 'not registered' reply goes at most once a day per number", async () => {
    vi.doMock("@/lib/whatsapp", () => ({ sendText: vi.fn(async (_f: string, _t: string, body: string) => ({ sid: "SMx", body })) }));
    const { replyUnregistered: real, UNREGISTERED_REPLY } = await import("@/lib/unregistered");
    await real("whatsapp:+447700900999", SANDBOX);
    await real("whatsapp:+447700900999", SANDBOX);
    const replies = db.tables.messages.filter((m) => m.to_number === "whatsapp:+447700900999");
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe(UNREGISTERED_REPLY);
    expect(replies[0].restaurant_id).toBeNull();
    vi.doUnmock("@/lib/whatsapp");
  });
});

describe("scheduled jobs", () => {
  test("every active restaurant is processed, and one failing doesn't stop the others", async () => {
    process.env.CRON_SECRET = "secret";
    const seen: string[] = [];
    vi.doMock("@/lib/morning", () => ({
      runMorning: async (r: { id: string }) => {
        seen.push(r.id);
        if (r.id === A) throw new Error("A broke");
        return { done: ["released 0"] };
      },
    }));
    vi.doMock("@/lib/job-runs", () => ({ startRun: async () => "run1", finishRun: async () => true, checkJobHealth: async () => {} }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(new NextRequest("https://naila.test/api/cron?job=daily", { headers: { authorization: "Bearer secret" } }));
    const body = (await res.json()) as { summary: { restaurant: string; morning: { error?: string; done?: string[] } }[] };
    expect(seen).toEqual([A, B]); // the inactive restaurant is skipped
    expect(body.summary.find((s) => s.restaurant === A)?.morning.error).toBe("A broke");
    expect(body.summary.find((s) => s.restaurant === B)?.morning.done).toEqual(["released 0"]);
    vi.doUnmock("@/lib/morning");
    vi.doUnmock("@/lib/job-runs");
    vi.doUnmock("@/lib/builder-alerts");
  });
});

describe("logged-in pages", () => {
  test("an owner can only pick their own restaurant; the builder can pick any", async () => {
    const { pickRestaurantId } = await import("@/lib/auth");
    const ownerA = { email: "a@owner.test", isBuilder: false, restaurantIds: [A], allowed: true };
    expect(pickRestaurantId(ownerA, B)).toBe(A); // asking for B gets A
    expect(pickRestaurantId(ownerA, undefined)).toBe(A);
    const builder = { email: "me@builder.test", isBuilder: true, restaurantIds: [A, B], allowed: true };
    expect(pickRestaurantId(builder, B)).toBe(B);
  });
});

describe("no query forgets which restaurant it's for", () => {
  // Restaurant-owned tables: every read or write of them must say which restaurant
  // (or a specific row by id/token). A new query that doesn't fails this test.
  const OWNED = ["customers", "reviews", "drafts", "campaigns", "campaign_sends", "sent_log", "audit_log", "reports", "google_posts", "rewards", "consents", "customer_events", "draft_feedback", "blocked_sends", "messages", "onboarding", "feedback", "feedback_requests"];
  const SCOPED = /restaurant_id|\.eq\("id"|\.in\("id"|eq\("token"|eq\("draft_id"|in\("draft_id"|eq\("campaign_id"|eq\("customer_id"|eq\("unsubscribe_token"|eq\("confirm_token"|eq\("request_id"|eq\("review_id"|in\("review_id"|eq\("batch_id"|is\("restaurant_id"/;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
    });

  test("every query on restaurant data is scoped", () => {
    const unscoped: string[] = [];
    for (const file of files("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/\.from\("(\w+)"\)/);
        if (!m || !OWNED.includes(m[1])) return;
        // The query's filters come within the next dozen lines (after any update fields).
        const window = lines.slice(i, i + 13).join(" ");
        if (!SCOPED.test(window)) unscoped.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(unscoped).toEqual([]);
  });

  test("nothing picks 'the first restaurant'", () => {
    const offenders = files("src").filter((f) => /from\("restaurants"\)[^;]*\.limit\(1\)/s.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
