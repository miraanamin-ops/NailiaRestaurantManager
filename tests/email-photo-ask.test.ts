// The photo "part 2" (phase 4 of the Inbox and emails plan, 15 Nov 2026): approving an
// offer email about a dish with no photo brings a second card asking for one; the email
// waits (3 hours, or its own send time) and goes with the photo, without it, or at the
// deadline. It starts from the app's approval, so nothing here reaches WhatsApp.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { approvedLine, askText, photoDeadline, photoSubject, PHOTO_WAIT_MS, savedLine, wantsPhoto, withoutLine } from "@/lib/email/photo-ask-rules";
import { memoryDb } from "./support/memory-db";

const R = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-16T10:00:00Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("the rules", () => {
  test("every offer email prefers a photo; never a birthday, never one that has one", () => {
    expect(wantsPhoto({ family: "discount", photo_url: null })).toBe(true);
    expect(wantsPhoto({ family: "quiet", photo_url: null })).toBe(true);
    expect(wantsPhoto({ family: "discount", photo_url: "https://x/p.jpg" })).toBe(false);
    expect(wantsPhoto({ family: "birthday", photo_url: null })).toBe(false);
    expect(wantsPhoto(null)).toBe(false);
  });

  test("what to ask a photo of: the dish, a kind of dish, else the food", () => {
    expect(photoSubject("Mixed Grill Platter", [], null)).toEqual({ phrase: "the mixed grill platter", caption: "Mixed Grill Platter" });
    expect(photoSubject(null, ["any dessert"], null)).toEqual({ phrase: "one of your desserts", caption: "desserts" });
    expect(photoSubject(null, [], "any main")).toEqual({ phrase: "one of your mains", caption: "mains" });
    expect(photoSubject(null, [], null)).toEqual({ phrase: "your food", caption: null });
  });

  test("it waits 3 hours, or until its own send time if that's later", () => {
    expect(photoDeadline(NOW, null).getTime()).toBe(NOW.getTime() + PHOTO_WAIT_MS);
    expect(photoDeadline(NOW, "2026-11-16T11:00:00Z").getTime()).toBe(NOW.getTime() + PHOTO_WAIT_MS);
    expect(photoDeadline(NOW, "2026-11-18T09:00:00Z").toISOString()).toBe("2026-11-18T09:00:00.000Z");
  });

  test("short words", () => {
    expect(askText("the mixed grill platter", new Date("2026-11-16T13:00:00Z"), NOW)).toBe("Add a photo of the mixed grill platter and it goes in the email. It sends at 1:00pm either way.");
    expect(approvedLine("the lamb chops")).toBe("Approved. Add a photo of the lamb chops? It's next in your Inbox.");
    expect(savedLine(true, null, NOW)).toBe("Photo added. Sending now.");
    expect(withoutLine(false, new Date("2026-11-18T09:00:00Z"), NOW)).toBe("It sends at Wed 18 Nov, 9:00am, without a photo.");
  });
});

describe("the flow", () => {
  let db: ReturnType<typeof memoryDb>;
  const released: number[] = [];
  let verdict = "ok";
  const menu = [{ category: "Grills", items: [{ name: "Mixed Grill Platter", price: 24, description: null }] }];
  const restaurant = { id: R, name: "Ember & Spice Grill", menu, photo_library: [] };

  beforeEach(() => {
    vi.resetModules();
    released.length = 0;
    verdict = "ok";
    db = memoryDb({
      restaurants: [{ ...restaurant }],
      drafts: [{ id: "d1", restaurant_id: R, kind: "email_campaign", content: "x", status: "pending", waiting_for: "decision", created_at: "2026-11-16T09:00:00Z", version: 1 }],
      campaigns: [
        {
          id: "c1",
          restaurant_id: R,
          draft_id: "d1",
          name: "Mixed grill week",
          subject: "10% off our mixed grill",
          body: "Bring someone hungry.",
          offer: "10% off the mixed grill platter",
          valid_from: "2026-11-16",
          valid_until: "2026-11-19",
          is_birthday: false,
          sent_at: null,
          send_at: null,
          offer_details: { type: "percent_off", items: ["Mixed Grill Platter"], applies_to: null, discount_percent: 10, discount_value_gbp: null, conditions: "" },
          email_design: { family: "discount", look: "photo_hero", photo_url: null },
        },
      ],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/audit", () => ({ logAction: vi.fn(async () => {}) }));
    vi.doMock("@/lib/agents/enqueue", () => ({ queueDraftCheck: vi.fn(async () => {}) }));
    vi.doMock("@/lib/profile/versions", () => ({ currentProfileVersion: vi.fn(async () => null) }));
    vi.doMock("@/lib/send", () => ({ processQueue: vi.fn(async () => void released.push(Date.now())) }));
    vi.doMock("@/lib/email/photo-check", async (orig) => ({ ...(await orig<object>()), checkDishPhoto: vi.fn(async () => verdict) }));
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "@/lib/audit", "@/lib/agents/enqueue", "@/lib/profile/versions", "@/lib/send", "@/lib/email/photo-check"]) vi.doUnmock(m);
  });

  type CampaignRow = { send_at: string | null; email_design: { photo_url: string | null; photo_ask?: { request_draft_id: string; answered: string | null } } };
  const campaign = () => db.tables.campaigns[0] as unknown as CampaignRow;
  const request = () => db.tables.drafts.find((d) => d.kind === "photo_request") as { id: string; status: string; content: string } | undefined;

  test("approving asks for a photo; the email waits; a good photo goes in, into the library, and it sends", async () => {
    const { startPhotoAsk, answerWithPhoto } = await import("@/lib/email/photo-ask");
    expect(await startPhotoAsk(restaurant as never, db.tables.drafts[0] as never, NOW)).toBe("the mixed grill platter");
    expect(request()?.content).toMatch(/^Add a photo of the mixed grill platter/);
    // As the gate would: the approved email is held until the deadline.
    Object.assign(db.tables.drafts[0], { status: "queued", scheduled_for: new Date(NOW.getTime() + PHOTO_WAIT_MS).toISOString() });
    expect(campaign().send_at).toBe(new Date(NOW.getTime() + PHOTO_WAIT_MS).toISOString());
    // Asked once only.
    expect(await startPhotoAsk(restaurant as never, db.tables.drafts[0] as never, NOW)).toBeNull();

    await db.client.storage.from("app-uploads").upload(`${R}/2026-11-16/p.jpg`, JPEG, { contentType: "image/jpeg" });
    // Someone else's upload is refused.
    expect(await answerWithPhoto(restaurant as never, request()!.id, "22222222-2222-4222-8222-222222222222/x.jpg", NOW)).toEqual({ ok: false, reason: "That photo isn't one of yours." });
    // A dark photo: the reason, and the card stays.
    verdict = "too_dark";
    expect(await answerWithPhoto(restaurant as never, request()!.id, `${R}/2026-11-16/p.jpg`, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/too dark/) });
    expect(request()?.status).toBe("pending");

    verdict = "ok";
    expect(await answerWithPhoto(restaurant as never, request()!.id, `${R}/2026-11-16/p.jpg`, NOW)).toEqual({ ok: true, sendAt: null });
    expect(campaign().email_design.photo_url).toMatch(/^https:\/\/storage\.test\/post-photos\//);
    expect(campaign().send_at).toBeNull();
    expect(released).toHaveLength(1);
    // The held email's release time is cleared too, so the release sends it now.
    expect(db.tables.drafts.find((d) => d.id === "d1")?.scheduled_for).toBeNull();
    expect(request()?.status).toBe("answered");
    expect((db.tables.restaurants[0].photo_library as { caption: string }[])[0].caption).toBe("Mixed Grill Platter");
  });

  test("Send without: it goes at its own time again; at the deadline the card leaves by itself", async () => {
    const { startPhotoAsk, answerWithoutPhoto, closePhotoAskFor } = await import("@/lib/email/photo-ask");
    (db.tables.campaigns[0] as { send_at: string | null }).send_at = "2026-11-18T09:00:00Z";
    await startPhotoAsk(restaurant as never, db.tables.drafts[0] as never, NOW);
    expect(campaign().send_at).toBe("2026-11-18T09:00:00.000Z");
    expect(await answerWithoutPhoto(restaurant as never, request()!.id, NOW)).toEqual({ ok: true, sendAt: new Date("2026-11-18T09:00:00Z") });
    expect(released).toHaveLength(0); // not due yet: the hourly release sends it then

    // Had nobody answered, the card is withdrawn as the email goes at its deadline.
    const req = request()!;
    req.status = "pending";
    campaign().email_design.photo_ask!.answered = null;
    await closePhotoAskFor({ id: "c1", restaurant_id: R, email_design: campaign().email_design as never });
    expect(request()?.status).toBe("withdrawn");
  });

  test("a library photo of it is used straight away, with nothing to ask", async () => {
    const { startPhotoAsk } = await import("@/lib/email/photo-ask");
    const withPhoto = { ...restaurant, photo_library: [{ url: "https://cdn.test/grill.jpg", caption: "Mixed grill platter" }] };
    expect(await startPhotoAsk(withPhoto as never, db.tables.drafts[0] as never, NOW)).toBeNull();
    expect(campaign().email_design.photo_url).toBe("https://cdn.test/grill.jpg");
    expect(request()).toBeUndefined();
  });

  test("no photo asked for a campaign that has one, or before 071 (no saved design)", async () => {
    const { startPhotoAsk } = await import("@/lib/email/photo-ask");
    (db.tables.campaigns[0] as { email_design: unknown }).email_design = null;
    expect(await startPhotoAsk(restaurant as never, db.tables.drafts[0] as never, NOW)).toBeNull();
    (db.tables.campaigns[0] as { email_design: unknown }).email_design = { family: "discount", look: "photo_hero", photo_url: "https://x/p.jpg" };
    expect(await startPhotoAsk(restaurant as never, db.tables.drafts[0] as never, NOW)).toBeNull();
    expect(request()).toBeUndefined();
  });

  test("a file that isn't a photo is refused by its bytes", async () => {
    const { imageTypeOf } = await import("@/lib/email/photo-ask");
    expect(imageTypeOf(JPEG)).toBe("image/jpeg");
    expect(imageTypeOf(Buffer.from("%PDF-1.4 hello"))).toBeNull();
  });
});
