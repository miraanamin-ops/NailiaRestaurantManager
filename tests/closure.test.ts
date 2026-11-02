// Closing an account (lib/closure-rules.ts, lib/closure.ts): asked twice, a
// 24-hour cooling-off that can be cancelled (skippable for demo and Pilot Zero
// only), then the export (7 days), the email, Google, Stripe and deleting every
// file and row, keeping one anonymous line. Another restaurant is never touched.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";
import { canSkipCoolingOff, closedEmail, closeRefused, closesAt, closureKind, closureRef, confirmEmail, COOLING_OFF_MS, googleClosing, nameMatches } from "@/lib/closure-rules";

describe("the rules", () => {
  test("which restaurants, which kind, who can skip the cooling-off", () => {
    expect(closureKind({ pilot_zero: true, is_demo: false })).toBe("pilot_zero");
    expect(closureKind({ is_demo: true })).toBe("demo");
    expect(closureKind({ is_test: true })).toBe("demo");
    expect(closureKind({})).toBe("real");
    expect(closeRefused({ slug: "ember-spice" })).toMatch(/never closed/);
    expect(closeRefused({ slug: "cardamom-corner" })).toMatch(/never closed/);
    expect(closeRefused({ slug: "maison-noor" })).toBeNull();
    expect(canSkipCoolingOff({ pilot_zero: true })).toBe(true);
    expect(canSkipCoolingOff({ is_demo: true })).toBe(true);
    expect(canSkipCoolingOff({})).toBe(false);
    const now = new Date("2026-11-10T10:00:00Z");
    expect(closesAt({}, now, true).getTime()).toBe(now.getTime() + COOLING_OFF_MS); // a real one can't skip
    expect(closesAt({ pilot_zero: true }, now, true)).toEqual(now);
    expect(closesAt({ pilot_zero: true }, now, false).getTime()).toBe(now.getTime() + COOLING_OFF_MS);
    expect(nameMatches("  pilot zero hall ", "Pilot Zero Hall")).toBe(true);
    expect(nameMatches("Pilot Zero", "Pilot Zero Hall")).toBe(false);
    expect(nameMatches("", "")).toBe(false);
    expect(closureRef(new Uint8Array([0, 1, 2, 3, 4, 31]))).toBe("CL-ABCDE9");
  });

  test("Google: an owner's login is revoked; our shared manager account needs removing by them", () => {
    expect(googleClosing({ linked: true, connectionKind: "owner" })).toBe("revoke");
    expect(googleClosing({ linked: true, connectionKind: "manager" })).toBe("remove_manager");
    expect(googleClosing({ linked: false, connectionKind: "owner" })).toBe("none");
  });

  test("the emails: when it closes, how to cancel, the links and how long they last, the Google steps; no em-dashes", () => {
    const a = confirmEmail({ restaurant: "Pilot Zero Hall", closesAt: "Wed 11 Nov, 10:00", coolingOff: true });
    expect(a.text).toMatch(/It closes on Wed 11 Nov, 10:00\. Until then nothing is deleted.*reply to this email before then and we'll cancel it/);
    expect(a.text).toMatch(/works for 7 days/);
    const b = closedEmail({ restaurant: "Pilot Zero Hall", links: [{ label: "Customer list (CSV)", url: "https://x/c.csv" }], expires: "Tue 17 Nov", removeManager: { email: "dina@dinerai.co.uk", profile: "Maison Noor" } });
    expect(b.text).toMatch(/before Tue 17 Nov/);
    expect(b.text).toContain("- Customer list (CSV): https://x/c.csv");
    expect(b.text).toMatch(/remove our manager account \(dina@dinerai\.co\.uk\) from your Google Business Profile \(Maison Noor\)/);
    for (const t of [a.text, b.text, a.subject, b.subject]) expect(t).not.toMatch(/[—–]/);
  });
});

// ---------- Against the stand-in database ----------

const PZ = "aaaaaaaa-0000-0000-0000-0000000000c1"; // Pilot Zero, Google by our manager account
const REAL = "aaaaaaaa-0000-0000-0000-0000000000c2"; // another restaurant: never touched
const EMBER = "11111111-1111-1111-1111-111111111111";

let db: ReturnType<typeof memoryDb>;
const queued: { type: string; restaurantId: string | null; payload?: Record<string, unknown> }[] = [];
const emails: { to: string | null; subject: string; text: string }[] = [];
const alerts: string[] = [];
const disconnect = vi.fn(async () => {});
const users = [
  { id: "u-pz", email: "me+pilot0@builder.dev" },
  { id: "u-real", email: "owner@real.test" },
  { id: "u-builder", email: "me@builder.dev" },
];
const deletedUsers: string[] = [];

const restaurantRow = (id: string, extra: Record<string, unknown>) => ({ id, active: true, paused: false, paused_at: null, is_demo: false, pilot_zero: false, stripe_subscription_id: null, google_connection_id: null, google_location_id: null, google_location_title: null, ...extra });
const both = <T extends Record<string, unknown>>(make: (rid: string, i: number) => T) => [make(PZ, 0), make(REAL, 1)];

beforeEach(async () => {
  vi.resetModules();
  queued.length = emails.length = alerts.length = deletedUsers.length = 0;
  disconnect.mockClear();
  vi.stubEnv("BUILDER_EMAIL", "me@builder.dev");
  db = memoryDb({
    restaurants: [
      restaurantRow(PZ, { name: "Pilot Zero Hall", slug: "pilot-zero-hall", pilot_zero: true, owner_email: "me+pilot0@builder.dev", google_connection_id: "gc-m", google_location_id: "locations/9", google_location_title: "Maison Noor" }),
      restaurantRow(REAL, { name: "A Real Grill", slug: "a-real-grill", owner_email: "owner@real.test" }),
      restaurantRow(EMBER, { name: "Ember & Spice Grill", slug: "ember-spice", is_demo: true }),
    ],
    google_connections: [{ id: "gc-m", restaurant_id: null, kind: "manager", status: "ok" }],
    customers: both((rid, i) => ({ id: `cu${i}`, restaurant_id: rid, name: `Customer ${i}`, email: `c${i}@x.test`, phone: null, birthday: null, source: "signup", created_at: "2026-10-01T00:00:00Z", email_confirmed_at: null, marketing_opt_in: true, unsubscribed_at: null, visit_count: 1, last_visit: null, deleted_at: null })),
    rewards: [],
    reviews: both((rid, i) => ({ id: `rv${i}`, restaurant_id: rid, rating: 5 })),
    drafts: both((rid, i) => ({ id: `d${i}`, restaurant_id: rid, kind: "review_reply" })),
    messages: both((rid, i) => ({ id: `m${i}`, restaurant_id: rid, body: "hi" })),
    sales_days: both((rid, i) => ({ id: `s${i}`, restaurant_id: rid, day: "2026-10-30", net_sales: 1000 + i, source: "pos" })),
    staff: both((rid, i) => ({ id: `st${i}`, restaurant_id: rid, display_name: `Staff ${i}` })),
    account_closures: [],
    audit_log: [],
  });
  for (const rid of [PZ, REAL]) {
    await db.client.storage.from("post-photos").upload(`${rid}/photo.jpg`, Buffer.from("x"));
    await db.client.storage.from("onboarding-uploads").upload(`${rid}/menu.pdf`, Buffer.from("x"));
  }
  Object.assign(db.client, {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: users.filter((u) => !deletedUsers.includes(u.id)) } }),
        deleteUser: async (id: string) => (deletedUsers.push(id), { error: null }),
      },
    },
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/queue/store", () => ({ enqueue: async (j: (typeof queued)[number]) => (queued.push(j), { id: "job" }) }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: async () => 0 }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async (r: { owner_email: string | null }, m: { subject: string; text: string }) => (emails.push({ to: r.owner_email, ...m }), { delivery: "email" }) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "sent") }));
  vi.doMock("@/lib/google/connections", () => ({ disconnect }));
  vi.doMock("@/lib/onboarding/dina/setup-config", () => ({ managerEmail: async () => "dina@dinerai.co.uk" }));
  vi.doMock("@/lib/billing/config", () => ({ stripeConfigured: () => false }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const m of ["@/lib/supabase", "@/lib/queue/store", "@/lib/queue/kick", "next/server", "@/lib/email", "@/lib/builder-alerts", "@/lib/google/connections", "@/lib/onboarding/dina/setup-config", "@/lib/billing/config"]) vi.doUnmock(m);
});

const lib = () => import("@/lib/closure");
const rowOf = (id: string) => db.tables.restaurants.find((r) => r.id === id);
const closureOf = (rid: string) => db.tables.account_closures.find((c) => c.restaurant_id === rid);
const otherRestaurantIntact = () => {
  expect(rowOf(REAL)).toBeTruthy();
  for (const t of ["customers", "reviews", "drafts", "messages", "sales_days", "staff"]) expect(db.tables[t].filter((x) => x.restaurant_id === REAL)).toHaveLength(1);
  expect(db.files.has(`post-photos/${REAL}/photo.jpg`)).toBe(true);
  expect(db.files.has(`onboarding-uploads/${REAL}/menu.pdf`)).toBe(true);
  expect(deletedUsers).not.toContain("u-real");
};

describe("asking twice", () => {
  test("request: the name typed exactly, one at a time, never the demo pair; nothing changes yet", async () => {
    const { requestClosure } = await lib();
    await expect(requestClosure(PZ, "Pilot Zero", "me@builder.dev")).rejects.toThrow(/type the restaurant's name exactly \(Pilot Zero Hall\)/);
    await expect(requestClosure(EMBER, "Ember & Spice Grill", "me@builder.dev")).rejects.toThrow(/never closed/);
    const c = await requestClosure(PZ, "pilot zero hall", "me@builder.dev");
    expect(c).toMatchObject({ status: "requested", kind: "pilot_zero", ref: expect.stringMatching(/^CL-[A-Z2-9]{6}$/) });
    await expect(requestClosure(PZ, "Pilot Zero Hall", "me@builder.dev")).rejects.toThrow(/already has a closure in progress/);
    expect(rowOf(PZ)).toMatchObject({ paused: false });
    expect(emails).toEqual([]);
  });

  test("confirm: the name again and the box ticked; a real restaurant can't skip the cooling-off", async () => {
    const { requestClosure, confirmClosure } = await lib();
    const c = await requestClosure(REAL, "A Real Grill", "me@builder.dev");
    const confirm = (extra: Partial<Parameters<typeof confirmClosure>[0]>) => confirmClosure({ closureId: c.id, typedName: "A Real Grill", understood: true, skipCoolingOff: false, builderEmail: "me@builder.dev", ...extra });
    await expect(confirm({ typedName: "Real" })).rejects.toThrow(/a second time/);
    await expect(confirm({ understood: false })).rejects.toThrow(/tick the box/);
    await expect(confirm({ skipCoolingOff: true })).rejects.toThrow(/Only a demo or Pilot Zero restaurant can skip/);
    expect(closureOf(REAL)).toMatchObject({ status: "requested" });
    const { closesAt: when } = await confirm({});
    expect(when.getTime() - Date.now()).toBeGreaterThan(COOLING_OFF_MS - 60_000);
    expect(closureOf(REAL)).toMatchObject({ status: "scheduled", paused_before: false, skipped_cooling_off: false });
    expect(rowOf(REAL)).toMatchObject({ paused: true });
    expect(emails).toEqual([expect.objectContaining({ to: "owner@real.test", subject: "Closing your DinerAI account for A Real Grill", text: expect.stringMatching(/reply to this email before then/) })]);
    expect(queued).toEqual([]); // not before the cooling-off
  });
});

describe("the cooling-off", () => {
  test("not closed early; due after 24 hours; cancelling puts sending back on", async () => {
    const { requestClosure, confirmClosure, runClosing, dueClosures, cancelClosure } = await lib();
    const c = await requestClosure(REAL, "A Real Grill", "me@builder.dev");
    await confirmClosure({ closureId: c.id, typedName: "A Real Grill", understood: true, skipCoolingOff: false, builderEmail: "me@builder.dev" });
    expect(await runClosing(c.id)).toEqual({ skipped: "the cooling-off isn't over" });
    expect(await dueClosures(new Date())).toEqual([]);
    expect(await dueClosures(new Date(Date.now() + COOLING_OFF_MS + 60_000))).toEqual([{ id: c.id }]);
    await cancelClosure(c.id, "me@builder.dev");
    expect(closureOf(REAL)).toMatchObject({ status: "cancelled" });
    expect(rowOf(REAL)).toMatchObject({ paused: false });
    expect(await runClosing(c.id)).toEqual({ skipped: "already cancelled" });
    otherRestaurantIntact();
  });
});

describe("closing", () => {
  test("Pilot Zero, cooling-off skipped: export, email with links, manager alert, everything of its deleted, one anonymous line; the other restaurant untouched", async () => {
    const { requestClosure, confirmClosure, runClosing } = await lib();
    const c = await requestClosure(PZ, "Pilot Zero Hall", "me@builder.dev");
    await confirmClosure({ closureId: c.id, typedName: "Pilot Zero Hall", understood: true, skipCoolingOff: true, builderEmail: "me@builder.dev" });
    expect(queued).toEqual([expect.objectContaining({ type: "account_close", restaurantId: null, payload: { closure: c.id } })]);

    const out = await runClosing(c.id);
    expect(out).toMatchObject({ closed: true, counts: { customers: 1, reviews: 1, drafts: 1, messages: 1, sales_days: 1, staff: 1, files: 2 }, steps: { google: "remove_manager", stripe: "off", email: "email", login: "deleted" } });
    // The export: three files under the anonymous reference, for 7 days.
    const exported = [...db.files.keys()].filter((k) => k.startsWith("account-exports/"));
    expect(exported.sort()).toEqual([`account-exports/${c.ref}/account.json`, `account-exports/${c.ref}/customers.csv`, `account-exports/${c.ref}/sales.csv`]);
    const json = JSON.parse(db.files.get(`account-exports/${c.ref}/account.json`)!.bytes.toString("utf8"));
    expect(json.customers.map((x: { id: string }) => x.id)).toEqual(["cu0"]); // only its own
    expect(json.sales_days.map((x: { id: string }) => x.id)).toEqual(["s0"]);
    expect(db.files.get(`account-exports/${c.ref}/customers.csv`)!.bytes.toString("utf8")).toContain("c0@x.test");
    expect(db.files.get(`account-exports/${c.ref}/customers.csv`)!.bytes.toString("utf8")).not.toContain("c1@x.test");
    // The emails: confirmed (closing now), then closed with the links and the Google steps.
    expect(emails.map((e) => e.subject)).toEqual(["Closing your DinerAI account for Pilot Zero Hall", "Your DinerAI account for Pilot Zero Hall is closed"]);
    expect(emails[1].text).toMatch(/Customer list \(CSV\): https:\/\/storage\.test\/account-exports\/CL-/);
    expect(emails[1].text).toMatch(/remove our manager account \(dina@dinerai\.co\.uk\)/);
    expect(alerts.some((a) => /remove dina@dinerai\.co\.uk as a manager from the Google profile "Maison Noor"/.test(a))).toBe(true);
    expect(disconnect).not.toHaveBeenCalled(); // the shared manager account isn't revoked for everyone
    // Deleted: the restaurant row, its files and its login.
    expect(rowOf(PZ)).toBeUndefined();
    expect(db.files.has(`post-photos/${PZ}/photo.jpg`)).toBe(false);
    expect(db.files.has(`onboarding-uploads/${PZ}/menu.pdf`)).toBe(false);
    expect(deletedUsers).toEqual(["u-pz"]);
    // The one line kept: no name, email or number.
    const line = closureOf(PZ) ?? db.tables.account_closures.find((x) => x.id === c.id)!;
    expect(line).toMatchObject({ status: "closed", restaurant_id: null, kind: "pilot_zero", export_expires_at: expect.any(String) });
    expect(JSON.stringify(line)).not.toMatch(/Pilot Zero Hall|me\+pilot0|builder\.dev|Maison Noor/);
    otherRestaurantIntact();
  });

  test("an owner's own Google login is revoked; Stripe cancelled when it's on; a retry carries on from the step it stopped at", async () => {
    Object.assign(rowOf(REAL)!, { google_connection_id: "gc-o", google_location_id: "locations/5", stripe_subscription_id: "sub_1" });
    db.tables.google_connections.push({ id: "gc-o", restaurant_id: REAL, kind: "owner", status: "ok" });
    const cancel = vi.fn(async () => ({}));
    vi.doMock("@/lib/billing/config", () => ({ stripeConfigured: () => true }));
    vi.doMock("@/lib/billing/stripe", () => ({ getStripe: () => ({ subscriptions: { cancel } }) }));
    // The first try fails at the email; the retry doesn't export or cancel again.
    let fail = true;
    vi.doMock("@/lib/email", () => ({
      sendOwnerEmail: async (r: { owner_email: string | null }, m: { subject: string; text: string }) => {
        if (fail && m.subject.includes("is closed")) throw new Error("Resend down");
        emails.push({ to: r.owner_email, ...m });
        return { delivery: "email" };
      },
    }));
    const { requestClosure, confirmClosure, runClosing, closingFailed } = await lib();
    const c = await requestClosure(REAL, "A Real Grill", "me@builder.dev");
    await confirmClosure({ closureId: c.id, typedName: "A Real Grill", understood: true, skipCoolingOff: false, builderEmail: "me@builder.dev" });
    Object.assign(closureOf(REAL)!, { closes_at: new Date(Date.now() - 1000).toISOString() }); // the 24 hours are up
    await expect(runClosing(c.id)).rejects.toThrow(/Resend down/);
    expect(disconnect).toHaveBeenCalledWith(REAL);
    expect(cancel).toHaveBeenCalledWith("sub_1");
    expect(rowOf(REAL)).toBeTruthy(); // nothing deleted before the email went
    fail = false;
    expect(await runClosing(c.id)).toMatchObject({ closed: true, steps: { google: "revoke", stripe: "cancelled", email: "email" } });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(rowOf(PZ)).toBeTruthy(); // the Pilot Zero restaurant: untouched
    expect(db.files.has(`post-photos/${PZ}/photo.jpg`)).toBe(true);
    await closingFailed("nope", new Error("x")); // a bad id never throws
    vi.doUnmock("@/lib/billing/stripe");
  });

  test("a login another restaurant also uses, or the builder's own, is kept", async () => {
    Object.assign(rowOf(REAL)!, { owner_email: "me+pilot0@builder.dev" });
    const { requestClosure, confirmClosure, runClosing } = await lib();
    const c = await requestClosure(PZ, "Pilot Zero Hall", "me@builder.dev");
    await confirmClosure({ closureId: c.id, typedName: "Pilot Zero Hall", understood: true, skipCoolingOff: true, builderEmail: "me@builder.dev" });
    expect((await runClosing(c.id)).steps).toMatchObject({ login: "kept (another restaurant uses it)" });
    expect(deletedUsers).toEqual([]);
  });

  test("the export is deleted once its 7 days are up", async () => {
    const { requestClosure, confirmClosure, runClosing, deleteExpiredExports } = await lib();
    const c = await requestClosure(PZ, "Pilot Zero Hall", "me@builder.dev");
    await confirmClosure({ closureId: c.id, typedName: "Pilot Zero Hall", understood: true, skipCoolingOff: true, builderEmail: "me@builder.dev" });
    await runClosing(c.id);
    expect(await deleteExpiredExports(new Date(Date.now() + 6 * 86_400_000))).toBe(0);
    expect(await deleteExpiredExports(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    expect([...db.files.keys()].filter((k) => k.startsWith("account-exports/"))).toEqual([]);
    expect(db.tables.account_closures[0].export_deleted_at).toEqual(expect.any(String));
  });
});
