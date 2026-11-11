// The app's Reports and More tabs (step 50, phase 5): reports from their saved
// snapshots (only the owner's own), customers (search, counts, QR, export link),
// settings checked and saved through the website's own saveProfileFields, the
// notification choices (and that a switched-off kind never buzzes), Pause / Resume as
// on WhatsApp, the referral code and the help guide.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { alertKindOf, alertPrefs, settingsChanges, settingsView } from "@/lib/app/settings-rules";
import { memoryDb } from "./support/memory-db";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const TOKEN = "owner-token-1234567";

describe("settings rules", () => {
  const r = {
    opening_hours: { Monday: "12:00 – 22:00", Sunday: "Closed" },
    signup_reward: "Free dessert",
    discount_cap_percent: 20,
    send_window_start: "09:00:00",
    send_window_end: "21:00:00",
    quiet_hours_start: "23:00:00",
    quiet_hours_end: "09:00:00",
    brief_hour: 9,
    emoji_allowed: { review_replies: 1, posts: 2, campaigns: 0 },
    app_alerts: { nudge: false },
  };

  test("what the screen shows", () => {
    const v = settingsView(r);
    expect(v.hours[0]).toEqual({ day: "Monday", value: "12:00 – 22:00" });
    expect(v.hours[1]).toEqual({ day: "Tuesday", value: "" });
    expect(v.sendWindow).toEqual({ start: "09:00", end: "21:00" });
    expect(v.alerts).toEqual({ brief: true, urgent: true, updates: true, reports: true, nudge: false });
  });

  test("only what changed is saved; problems in plain words, and nothing saved", () => {
    expect(settingsChanges({ hours: [{ day: "Tuesday", value: "12:00-22:00" }] }, r).fields.opening_hours).toMatchObject({ Monday: "12:00 – 22:00", Tuesday: expect.stringMatching(/12:00.*22:00/) });
    expect(settingsChanges({ hours: [{ day: "Tuesday", value: "whenever" }] }, r).problem).toMatch(/Tuesday/);
    expect(settingsChanges({ discountCap: 150 }, r).problem).toMatch(/between 0 and 100/);
    expect(settingsChanges({ sendWindow: { start: "09:00", end: "21:00" } }, r).fields).toEqual({}); // the same, so nothing
    expect(settingsChanges({ sendWindow: { start: "06:00", end: "21:00" } }, r).problem).toMatch(/7am and 10pm/);
    expect(settingsChanges({ sendWindow: { start: "10:00", end: "12:00" } }, r).problem).toMatch(/4 hours/);
    expect(settingsChanges({ quietHours: { start: "22:00", end: "22:00" } }, r).problem).toMatch(/different/);
    expect(settingsChanges({ briefHour: 6 }, r).problem).toMatch(/7am and 11am/);
    expect(settingsChanges({ briefHour: 8 }, r).fields).toEqual({ brief_hour: 8 });
    expect(settingsChanges({ voice: { wordsToAvoid: "cheap, deal ,\nbargain", emoji: { posts: 9 } } }, r).fields).toEqual({
      words_to_avoid: ["cheap", "deal", "bargain"],
      emoji_allowed: { review_replies: 1, posts: 5, campaigns: 0 },
    });
    expect(settingsChanges({ alerts: { urgent: false, made_up: true } as never }, r).alerts).toEqual({ brief: true, urgent: false, updates: true, reports: true, nudge: false });
  });

  test("which notification a message is", () => {
    expect(["brief", "alert", "review", "feedback", "report", "rota", "update", "nudge"].map(alertKindOf)).toEqual(["brief", "urgent", "urgent", "urgent", "reports", "updates", "updates", "nudge"]);
    expect(alertPrefs(null)).toEqual({ brief: true, urgent: true, updates: true, reports: true, nudge: true });
  });
});

// ---------- The routes ----------

let mem: ReturnType<typeof memoryDb>;
const saved: { fields: Record<string, unknown>; detail: string }[] = [];
const released: string[] = [];

beforeEach(() => {
  vi.resetModules();
  saved.length = 0;
  released.length = 0;
  process.env.LINK_SECRET = "link-secret-for-tests";
  mem = memoryDb({
    restaurants: [
      { id: A, name: "Ember & Spice", slug: "ember-spice", brand_dark: "#111111", paused: false, discount_cap_percent: 20, brief_hour: 9, referral_code: null, owner_email: "sam@ember.test" },
      { id: B, name: "Cardamom", slug: "cardamom-corner", paused: false },
    ],
    reports: [
      { token: "weekly-token-aaaa", restaurant_id: A, period_start: "2026-11-02", period_end: "2026-11-08", created_at: "2026-11-09T07:00:00Z", expires_at: "2026-12-09T07:00:00Z", data: { version: 1, period: { label: "2 to 8 November" }, sections: [] } },
      { token: "monthly-token-bbbb", restaurant_id: A, period_start: "2026-10-01", period_end: "2026-10-31", created_at: "2026-11-02T07:00:00Z", expires_at: "2026-11-01T00:00:00Z", data: { kind: "monthly", figures: { label: "October 2026" } } },
      { token: "other-token-cccc", restaurant_id: B, period_start: "2026-11-02", period_end: "2026-11-08", created_at: "2026-11-09T07:00:00Z", expires_at: null, data: { version: 1, period: { label: "B's week" }, sections: [] } },
    ],
    customers: [
      { id: "c1", restaurant_id: A, name: "Priya Shah", email: "priya@x.test", created_at: "2026-11-01T10:00:00Z", email_confirmed_at: "2026-11-01T10:05:00Z", unsubscribed_at: null, deleted_at: null, import_status: null },
      { id: "c2", restaurant_id: A, name: "Tom Lee", email: "tom@y.test", created_at: "2026-11-03T10:00:00Z", email_confirmed_at: null, unsubscribed_at: null, deleted_at: null, import_status: null },
      { id: "c3", restaurant_id: A, name: "Gone", email: "gone@z.test", created_at: "2026-10-03T10:00:00Z", email_confirmed_at: null, unsubscribed_at: null, deleted_at: "2026-11-01", import_status: null },
      { id: "c4", restaurant_id: B, name: "Priya Other", email: "p2@b.test", created_at: "2026-11-03T10:00:00Z", email_confirmed_at: "x", unsubscribed_at: null, deleted_at: null, import_status: null },
    ],
    audit_log: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => mem.client }));
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    ownerFromToken: async (t: string) => (t === TOKEN ? { email: "sam@ember.test", isBuilder: false, restaurantIds: [A], allowed: true } : null),
  }));
  vi.doMock("@/lib/profile-edits", () => ({
    saveProfileFields: async (r: { id: string }, fields: Record<string, unknown>, detail: string) => {
      saved.push({ fields, detail });
      Object.assign(mem.tables.restaurants.find((x) => x.id === r.id)!, fields);
    },
  }));
  vi.doMock("@/lib/followups", async (orig) => ({ ...(await orig<object>()), releaseQueue: async (r: { id: string }) => (released.push(r.id), [{ id: "d1" }]) }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/auth", "@/lib/profile-edits", "@/lib/followups", "@/lib/push"]) vi.doUnmock(m);
});

const call = (url: string, method = "GET", body?: object, auth = true) =>
  new NextRequest(`https://app.test${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) } });
const restaurantA = () => mem.tables.restaurants.find((x) => x.id === A)!;

describe("reports", () => {
  test("the list, newest first, weekly and monthly; one report's snapshot with a PDF link; never another restaurant's", async () => {
    const list = await import("@/app/api/app/reports/route");
    expect((await list.GET(call("/api/app/reports", "GET", undefined, false))).status).toBe(401);
    const json = await (await list.GET(call(`/api/app/reports?r=${B}`))).json();
    expect(json.restaurantId).toBe(A);
    expect(json.reports.map((x: { kind: string; label: string }) => [x.kind, x.label])).toEqual([
      ["weekly", "2 to 8 November"],
      ["monthly", "October 2026"],
    ]);
    const one = await import("@/app/api/app/reports/[token]/route");
    const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
    const weekly = await (await one.GET(call("/api/app/reports/weekly-token-aaaa"), ctx("weekly-token-aaaa"))).json();
    expect(weekly).toMatchObject({ kind: "weekly", data: { period: { label: "2 to 8 November" } }, webUrl: expect.stringContaining("/report/weekly-token-aaaa") });
    expect(weekly.pdfUrl).toMatch(/\/api\/report-pdf\/weekly-token-aaaa\?s=/);
    // The monthly report's web link has run out; the app still shows it (and its PDF).
    expect(await (await one.GET(call("/api/app/reports/monthly-token-bbbb"), ctx("monthly-token-bbbb"))).json()).toMatchObject({ kind: "monthly", webUrl: null });
    expect((await one.GET(call("/api/app/reports/other-token-cccc"), ctx("other-token-cccc"))).status).toBe(404);
  });
});

describe("customers", () => {
  test("counts, search, the QR code and the pack; deleted and other restaurants' customers never shown", async () => {
    const { GET } = await import("@/app/api/app/customers/route");
    const all = await (await GET(call("/api/app/customers"))).json();
    expect([all.total, all.subscribed]).toEqual([2, 1]);
    expect(all.customers.map((c: { name: string; status: string }) => [c.name, c.status])).toEqual([
      ["Tom Lee", "Hasn't confirmed their email"],
      ["Priya Shah", "Signed up"],
    ]);
    expect(all.qrSvg).toMatch(/^<svg/);
    expect(all.signupUrl).toMatch(/\/r\/ember-spice$/);
    expect(all.qrPackUrl).toMatch(/\/r\/ember-spice\/qr-pack$/);
    const found = await (await GET(call("/api/app/customers?q=priya"))).json();
    expect(found.customers.map((c: { name: string }) => c.name)).toEqual(["Priya Shah"]);
  });

  test("export: the signed one-hour download page, as on WhatsApp", async () => {
    const { POST } = await import("@/app/api/app/customers/export/route");
    const { url } = await (await POST(call("/api/app/customers/export", "POST"))).json();
    expect(url).toMatch(new RegExp(`/export/download\\?r=${A}&t=`));
    const { verifyLink } = await import("@/lib/signed-links");
    expect(verifyLink("customer-export", A, new URL(url).searchParams.get("t"))).toBe(true);
  });
});

describe("settings", () => {
  test("a change goes through saveProfileFields (UNDO-able); a problem saves nothing; the answer is the settings now", async () => {
    const { GET, POST } = await import("@/app/api/app/settings/route");
    expect(await (await GET(call("/api/app/settings"))).json()).toMatchObject({ discountCap: 20, briefHour: 9, paused: false });
    const after = await (await POST(call("/api/app/settings", "POST", { discountCap: 25, briefHour: 8 }))).json();
    expect(saved).toEqual([{ fields: { discount_cap_percent: 25, brief_hour: 8 }, detail: "Changed in the app" }]);
    expect(after).toMatchObject({ discountCap: 25, briefHour: 8 });
    expect(await (await POST(call("/api/app/settings", "POST", { discountCap: 300 }))).json()).toEqual({ problem: expect.stringMatching(/between 0 and 100/) });
    expect(saved).toHaveLength(1);
  });

  test("notification choices are saved and logged", async () => {
    const { POST } = await import("@/app/api/app/settings/route");
    const out = await (await POST(call("/api/app/settings", "POST", { alerts: { nudge: false } }))).json();
    expect(out.alerts.nudge).toBe(false);
    expect(restaurantA().app_alerts).toMatchObject({ nudge: false, brief: true });
    expect(mem.tables.audit_log.at(-1)).toMatchObject({ detail: "App notifications: nudge off" });
  });

  test("a kind switched off never buzzes the phone, and doesn't go to WhatsApp instead", async () => {
    restaurantA().app_alerts = { urgent: false };
    const pushed: string[] = [];
    vi.doMock("@/lib/push", async (orig) => {
      const real = await orig<typeof import("@/lib/push")>();
      return real;
    });
    mem.tables.app_devices = [{ id: "dev1", owner_email: "sam@ember.test", push_token: "ExponentPushToken[x]", platform: "ios", disabled_at: null, last_seen_at: new Date().toISOString() }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      pushed.push(String((init as RequestInit).body));
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }));
    });
    const { pushInsteadOfWhatsApp } = await import("@/lib/push");
    expect(await pushInsteadOfWhatsApp(A, "⭐⭐ A 2-star review", "alert")).toBe(true);
    expect(pushed).toEqual([]);
    fetchSpy.mockRestore();
  });
});

describe("pause, refer and help", () => {
  test("Pause and Resume as on WhatsApp: logged, and resuming sends what was held", async () => {
    const { POST } = await import("@/app/api/app/pause/route");
    expect(await (await POST(call("/api/app/pause", "POST", { paused: true }))).json()).toEqual({ paused: true, released: 0 });
    expect(restaurantA().paused).toBe(true);
    expect(mem.tables.audit_log.at(-1)).toMatchObject({ detail: "Paused all sending" });
    expect(await (await POST(call("/api/app/pause", "POST", { paused: false }))).json()).toEqual({ paused: false, released: 1 });
    expect(restaurantA().paused).toBe(false);
    expect(released).toEqual([A]);
    expect((await POST(call("/api/app/pause", "POST", { paused: "yes" }))).status).toBe(400);
  });

  test("the referral code is made once and comes with its link", async () => {
    const { GET } = await import("@/app/api/app/refer/route");
    const first = await (await GET(call("/api/app/refer"))).json();
    expect(first.code).toMatch(/^EMBER-/);
    expect(first.link).toMatch(new RegExp(`/start\\?ref=${first.code}$`));
    expect((await (await GET(call("/api/app/refer"))).json()).code).toBe(first.code);
  });

  test("the help guide, without the note about how the assistant uses it, and the support email", async () => {
    const { GET } = await import("@/app/api/app/help/route");
    const help = await (await GET(call("/api/app/help"))).json();
    expect(help.markdown).toMatch(/^## The basics/);
    expect(help.markdown).toMatch(/Delete your account/);
    expect(help.supportEmail).toMatch(/@/);
  });
});
