// App notifications (step 50, phase 2): what each says, quiet hours, the weekly
// nudge, and sending: only the owner's phones, a removed app is switched off, and
// an owner with the app gets a notification instead of WhatsApp.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { briefPush, headline, inQuietHours, nudgeDue, nudgePush, pushFor } from "@/lib/push-rules";

describe("what notifications say", () => {
  test("a bad review alert", () => {
    const m = pushFor("alert", "🚨 *2-star review just came in.* I've drafted a careful reply below.", "d1");
    expect(m).toMatchObject({ title: "New 2-star review", category: "draft", urgent: true, data: { screen: "inbox", draftId: "d1", kind: "review" } });
  });
  test("private feedback, the rota, an update", () => {
    expect(pushFor("feedback", "🚨 *Private feedback: 1★ from Jo*\n_\"Cold food\"_").title).toBe("A customer rated their visit 1 out of 5");
    expect(pushFor("rota", "Next week's rota…").title).toBe("Next week's rota is ready");
    expect(pushFor("update", "📷 I can't use that photo for Google: *too dark*\nhttps://x.test").body).toBe("📷 I can't use that photo for Google: too dark");
  });
  test("the brief", () => {
    expect(briefPush({ waiting: 3, takings: "£2,340 (+8% vs last week)", firstName: "Sam" })).toMatchObject({ title: "☀️ Good morning, Sam", body: "Yesterday £2,340 (+8% vs last week). 3 things to approve.", category: "brief" });
    expect(briefPush({ waiting: 0 })).toMatchObject({ body: "Nothing to approve today.", category: "info", data: { screen: "today" } });
  });
  test("headlines are cut to fit", () => {
    expect(headline("x".repeat(200)).length).toBe(120);
    expect(headline("\n\nok\nHello there")).toBe("Hello there");
  });
});

describe("timing", () => {
  test("quiet hours, including across midnight", () => {
    expect(inQuietHours(23 * 60, "22:00", "07:00")).toBe(true);
    expect(inQuietHours(6 * 60 + 59, "22:00", "07:00")).toBe(true);
    expect(inQuietHours(7 * 60, "22:00", "07:00")).toBe(false);
    expect(inQuietHours(15 * 60, "14:00", "16:00")).toBe(true);
    expect(inQuietHours(15 * 60, null, null)).toBe(false);
  });
  test("a nudge after 3 days away, at most once a week", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(nudgeDue(now, ago(2), null)).toBe(false);
    expect(nudgeDue(now, ago(3), null)).toBe(true);
    expect(nudgeDue(now, ago(10), ago(5))).toBe(false);
    expect(nudgeDue(now, ago(10), ago(8))).toBe(true);
    expect(nudgePush(2, null).body).toContain("2 drafts are ready");
    expect(nudgePush(0, "Two-for-one Tuesdays for students").body).toContain("Two-for-one Tuesdays");
  });
});

describe("sending", () => {
  const R = "aaaaaaaa-0000-4000-8000-000000000065";
  let db: ReturnType<typeof memoryDb>;
  const sent: { to: string; title: string; sound: unknown; interruptionLevel: string }[][] = [];
  const whatsapp: string[] = [];
  let expoAnswer: (batch: { to: string }[]) => unknown;

  beforeEach(() => {
    vi.resetModules();
    sent.length = 0;
    whatsapp.length = 0;
    expoAnswer = (batch) => ({ data: batch.map(() => ({ status: "ok", id: "t" })) });
    db = memoryDb({
      restaurants: [{ id: R, name: "Ember", owner_email: "sam@ember.test", owner_whatsapp: "whatsapp:+447700900765", quiet_hours_start: "22:00", quiet_hours_end: "07:00" }],
      app_devices: [
        { id: "p1", owner_email: "sam@ember.test", push_token: "ExponentPushToken[aaaaaaaaaaaa]", platform: "ios", disabled_at: null },
        { id: "p2", owner_email: "sam@ember.test", push_token: "ExponentPushToken[bbbbbbbbbbbb]", platform: "android", disabled_at: null },
        { id: "p3", owner_email: "builder@dinerai.test", push_token: "ExponentPushToken[cccccccccccc]", platform: "ios", disabled_at: null },
      ],
      drafts: [{ id: "d1", restaurant_id: R, status: "pending" }],
      messages: [],
      owner_outbox: [],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/whatsapp", () => ({ sendText: async (_f: string, _t: string, body: string) => (whatsapp.push(body), { sid: "SM", body }) }));
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const batch = JSON.parse(init.body);
      sent.push(batch);
      return new Response(JSON.stringify(expoAnswer(batch)), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/whatsapp");
  });

  test("only the owner's phones, never the builder's; the badge counts what's waiting", async () => {
    const { pushToOwner } = await import("@/lib/push");
    const r = db.tables.restaurants[0] as never;
    expect(await pushToOwner(r, briefPush({ waiting: 1 }), new Date("2026-11-20T09:00:00Z"))).toBe(2);
    expect(sent[0].map((m) => m.to)).toEqual(["ExponentPushToken[aaaaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbbbb]"]);
    expect(sent[0][0]).toMatchObject({ badge: 1, sound: "default", interruptionLevel: "active" });
  });

  test("quiet hours: silent, still delivered", async () => {
    const { pushToOwner } = await import("@/lib/push");
    await pushToOwner(db.tables.restaurants[0] as never, briefPush({ waiting: 1 }), new Date("2026-11-20T23:30:00Z"));
    expect(sent[0][0]).toMatchObject({ sound: null, interruptionLevel: "passive" });
  });

  test("a phone that removed the app is switched off", async () => {
    expoAnswer = () => ({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] });
    const { pushToOwner } = await import("@/lib/push");
    expect(await pushToOwner(db.tables.restaurants[0] as never, briefPush({ waiting: 1 }))).toBe(1);
    expect(db.tables.app_devices.find((d) => d.id === "p2")?.disabled_at).toBeTruthy();
  });

  test("an owner with the app gets a notification instead of WhatsApp; without it, WhatsApp as before", async () => {
    const { messageOwner } = await import("@/lib/notify");
    const channel = { restaurantId: R, from: "whatsapp:+14155238886", to: "whatsapp:+447700900765" };
    db.tables.messages.push({ restaurant_id: R, direction: "inbound", from_number: "whatsapp:+447700900765", created_at: new Date().toISOString() });
    await messageOwner(channel, "🚨 *2-star review just came in.*", false, { opener: "alert" });
    expect(sent).toHaveLength(1);
    expect(whatsapp).toHaveLength(0);
    for (const d of db.tables.app_devices) d.disabled_at = "2026-11-01T00:00:00Z";
    await messageOwner(channel, "🚨 *2-star review just came in.*", false, { opener: "alert" });
    expect(whatsapp).toHaveLength(1);
  });

  test("a redeemed reward doesn't buzz the phone (it's in Today's done list)", async () => {
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner({ restaurantId: R, from: "w", to: "whatsapp:+447700900765" }, "🎁 Reward redeemed", false, { opener: "none" });
    expect(sent).toHaveLength(0);
    expect(whatsapp).toHaveLength(0);
  });
});
