// Customer email designs (phase 3 of the Inbox and emails plan, 15 Nov 2026; the owner's
// Stitch mock-ups): which family a campaign is, which look comes next, the facts each
// look shows, and every look drawn in two restaurants' colours, with and without a photo.
// EMAIL_LOOKS_DIR=<folder> also writes each one as an HTML file to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { brandFor } from "@/lib/email/brand";
import { campaignContent, type DesignFacts } from "@/lib/email/content";
import { anotherLook, bigDay, bigNumber, chooseDesign, dateTile, designOf, familyOf, LOOKS, nextLook, occasionOf, offerDish, photoFor, prices, type CampaignLike, type Family, type Look } from "@/lib/email/designs";
import { renderEmail } from "@/lib/email/templates";

const menu = [
  { category: "Grills", items: [{ name: "Mixed Grill Platter", price: 24, description: "Lamb chops, chicken tikka, seekh kebab, rice" }] },
  { category: "Biryani", items: [{ name: "Lamb Shank Biryani", price: 15.95, description: "Slow-cooked for 6 hours, served with raita" }] },
  { category: "Desserts", items: [{ name: "Kunafa", price: 6.5, description: null }] },
];

const campaign = (fields: Partial<CampaignLike> = {}): CampaignLike => ({
  id: "c-1",
  name: "Mixed grill week",
  subject: "10% off our mixed grill",
  body: "Monday to Thursday this week. Bring someone hungry.",
  offer: "10% off the mixed grill platter",
  valid_from: "2026-11-16",
  valid_until: "2026-11-19",
  is_birthday: false,
  offer_details: { type: "percent_off", items: ["Mixed Grill Platter"], applies_to: null, discount_percent: 10, discount_value_gbp: null, conditions: "Dine in only" },
  ...fields,
});

describe("which family", () => {
  test("birthday, occasion, new dish, quiet night, else a discount", () => {
    expect(familyOf(campaign({ is_birthday: true }))).toBe("birthday");
    expect(familyOf(campaign({ name: "Eid weekend", subject: "Eid at Ember & Spice" }))).toBe("occasion");
    expect(familyOf(campaign({ name: "Derby night", subject: "West Ham v Fulham on the big screen" }))).toBe("occasion");
    expect(familyOf(campaign({ subject: "New on the menu: lamb shank biryani" }))).toBe("new_dish");
    expect(familyOf(campaign({ subject: "Tuesday's on us (nearly)", body: "Tuesday evenings are quiet here. 2 mains for £20." }))).toBe("quiet");
    expect(familyOf(campaign())).toBe("discount");
  });

  test("occasions bring their own banner colours", () => {
    expect(occasionOf("Eid weekend")).toMatchObject({ key: "eid", title: "Eid Mubarak" });
    expect(occasionOf("Iftar platters all Ramadan")).toMatchObject({ key: "ramadan" });
    expect(occasionOf("Just a Tuesday")).toBeNull();
  });
});

describe("which look", () => {
  test("the looks take turns, so two in a row never match", () => {
    expect(nextLook("discount", null)).toBe("photo_hero");
    expect(nextLook("discount", "photo_hero")).toBe("big_number");
    expect(nextLook("discount", "menu_card")).toBe("photo_hero");
    expect(nextLook("birthday", "birthday")).toBe("birthday");
    expect(anotherLook({ family: "quiet", look: "receipt", photo_url: null }).look).toBe("big_day");
  });

  test("a saved design is used; a campaign without one gets a steady choice", () => {
    expect(designOf(campaign({ email_design: { family: "discount", look: "menu_card", photo_url: null } })).look).toBe("menu_card");
    const a = designOf(campaign({ id: "abc" }));
    expect(designOf(campaign({ id: "abc" }))).toEqual(a);
    expect(designOf(campaign({ email_design: { family: "discount", look: "banner" as Look, photo_url: null } })).family).toBe("discount");
  });

  test("a new campaign: next look, and the dish's photo only if the library plainly has it", () => {
    const library = [
      { url: "https://cdn.test/front.jpg", caption: "Our shop front" },
      { url: "https://cdn.test/grill.jpg", caption: "Mixed grill platter, fresh off the coals" },
    ];
    expect(chooseDesign(campaign(), "photo_hero", menu, library)).toEqual({ family: "discount", look: "big_number", photo_url: "https://cdn.test/grill.jpg" });
    expect(photoFor(library, "Kunafa")).toBeNull();
    expect(photoFor([{ url: "http://insecure/grill.jpg", caption: "mixed grill platter" }], "Mixed Grill Platter")).toBeNull();
  });
});

describe("the facts each look shows (nothing invented)", () => {
  test("the dish, the big number and the new price come from the offer and the menu", () => {
    const c = campaign();
    const dish = offerDish(c, menu);
    expect(dish).toEqual({ name: "Mixed Grill Platter", description: "Lamb chops, chicken tikka, seekh kebab, rice", price: 24, section: "Grills" });
    expect(bigNumber(c)).toEqual({ big: "10%", rest: "off" });
    expect(prices(c, dish)).toEqual({ was: 24, now: 21.6 });
    expect(bigNumber(campaign({ offer_details: { type: "money_off", items: [], applies_to: null, discount_percent: null, discount_value_gbp: 5, conditions: "" } }))).toEqual({ big: "£5", rest: "off" });
    expect(bigNumber(campaign({ offer_details: null, offer: "A free drink with any main" }))).toBeNull();
  });

  test("the day in big type and the date tile", () => {
    expect(bigDay(campaign({ valid_from: "2026-11-17", valid_until: "2026-11-17" }))).toBe("Tuesday");
    expect(bigDay(campaign({ subject: "Wednesday treat", body: "" }))).toBe("Wednesday");
    expect(bigDay(campaign({ subject: "Treat", body: "", valid_from: "2026-11-16", valid_until: "2026-11-19" }))).toBe("Midweek");
    expect(bigDay(campaign({ subject: "Treat", body: "", valid_from: "2026-11-16", valid_until: "2026-11-22" }))).toBe("This week");
    expect(dateTile("2027-03-20")).toEqual({ weekday: "Saturday", day: "20", month: "Mar" });
  });
});

// ---------- Every look, drawn ----------

const brands = {
  ember: brandFor({ name: "Ember & Spice Grill", tagline: "Halal charcoal grill", address: "142 Mile End Road, London E1 4LJ", logo_url: null, brand_color: "#b3261e", brand_dark: "#2b2b2b", brand_voice: "Warm and family-run", owner_name: "Amir Rahman" }),
  cafe: brandFor({ name: "Cardamom Corner Café", tagline: null, address: "8 Cranbrook Road, Ilford IG1", logo_url: "https://cdn.test/cardamom-logo.png", brand_color: "#e8a33d", brand_dark: "#1f4e5a", brand_voice: "Playful and casual", owner_name: "Priya" }),
};

const forFamily: Record<Family, Partial<CampaignLike>> = {
  discount: {},
  occasion: { name: "Eid weekend", subject: "Celebrate Eid with family", body: "Free kunafa for every table of 4 or more, Eid weekend.", offer: "Free kunafa for tables of 4+", valid_from: "2027-03-20", valid_until: "2027-03-21", offer_details: { type: "free_item", items: ["Kunafa"], applies_to: "any main", discount_percent: null, discount_value_gbp: null, conditions: "Tables of 4 or more" } },
  quiet: { name: "Quiet Tuesday", subject: "Tuesday's on us (nearly)", body: "Tuesday evenings are calmer here.", offer: "2 mains for £20", valid_from: "2026-11-17", valid_until: "2026-11-17", offer_details: { type: "two_for_one", items: [], applies_to: "any main", discount_percent: null, discount_value_gbp: null, conditions: "Dine in only, 5pm to close" } },
  new_dish: { name: "New biryani", subject: "My mum's recipe, finally on the menu", body: "Slow-cooked for six hours.\n\nCome and try it this week.", offer: "", offer_details: { type: "percent_off", items: ["Lamb Shank Biryani"], applies_to: null, discount_percent: null, discount_value_gbp: null, conditions: "" } },
  birthday: { is_birthday: true, subject: "Happy birthday", body: "A free dessert is waiting for you this week.", offer: "Free dessert with any main", offer_details: null },
};

function facts(c: CampaignLike, look: Look, family: Family, photo: boolean, owner: string | null): DesignFacts {
  const dish = offerDish(c, menu);
  return {
    family,
    look,
    photoUrl: photo ? "https://cdn.test/dish.jpg" : null,
    dish,
    big: bigNumber(c),
    prices: prices(c, dish),
    day: bigDay(c),
    occasion: family === "occasion" ? occasionOf(`${c.name}\n${c.subject}`) : null,
    date: dateTile(c.valid_from),
    validity: c.valid_from === c.valid_until ? "Tue 17 Nov only" : "Mon 16 Nov to Thu 19 Nov",
    conditions: c.offer_details?.conditions || null,
    firstName: "Sara",
    ownerFirst: owner,
  };
}

const outDir = process.env.EMAIL_LOOKS_DIR;
if (outDir) mkdirSync(outDir, { recursive: true });

describe("every look, in two restaurants' colours, with and without a photo", () => {
  const links = { unsubscribe: "https://site.test/unsubscribe/tok", deleteData: "https://site.test/delete/tok" };
  for (const [brandKey, brand] of Object.entries(brands)) {
    for (const family of Object.keys(LOOKS) as Family[]) {
      for (const look of LOOKS[family] as readonly Look[]) {
        for (const photo of [true, false]) {
          test(`${brandKey} ${family} ${look}${photo ? "" : " (no photo)"}`, async () => {
            const c = campaign(forFamily[family]);
            const content = campaignContent(brand, {
              birthday: c.is_birthday,
              subject: c.subject,
              body: c.body,
              offer: c.offer,
              validity: "Mon 16 Nov to Thu 19 Nov",
              firstName: "Sara",
              offerUrl: "https://site.test/offer/tok",
              links,
              ownerCopy: false,
              trackingPixel: null,
              design: facts(c, look, family, photo, brandKey === "ember" ? "Amir" : "Priya"),
            });
            const { html } = await renderEmail(content);
            // The links every customer email must carry, the restaurant's own name and colour.
            expect(html).toContain(links.unsubscribe);
            expect(html).toContain(links.deleteData);
            expect(html).toContain("https://site.test/offer/tok");
            expect(html).toContain(brand.color);
            expect(html.includes(brand.name.replace("&", "&amp;")) || html.includes(brand.name)).toBe(true);
            // A photo only when there is one; never a made-up detail from the mock-ups.
            // (The birthday look has no photo, like its mock-up.)
            expect(html.includes("https://cdn.test/dish.jpg")).toBe(photo && family !== "birthday");
            for (const invented of ["Est.", "HMC", "Voucher no", "Preferences", "fill up", "Reserve early", "—"]) expect(html, invented).not.toContain(invented);
            // Well under Gmail's 102 KB clipping size.
            expect(Buffer.byteLength(html)).toBeLessThan(70_000);
            if (outDir) writeFileSync(join(outDir, `${brandKey}-${family}-${look}${photo ? "" : "-nophoto"}.html`), html);
          });
        }
      }
    }
  }
});

// ---------- Saved per campaign (071) ----------

describe("saving designs (lib/email/design-store.ts)", () => {
  const R = "11111111-1111-4111-8111-111111111111";
  test("each new campaign takes the next look in its family; Try another look moves it on; nothing crosses restaurants", async () => {
    const { vi } = await import("vitest");
    const { memoryDb } = await import("./support/memory-db");
    vi.resetModules();
    const db = memoryDb({
      campaigns: [
        { id: "old", restaurant_id: R, draft_id: "d0", created_at: "2026-11-01T10:00:00Z", email_design: { family: "discount", look: "photo_hero", photo_url: null }, sent_at: "2026-11-02T10:00:00Z" },
        { id: "other", restaurant_id: "22222222-2222-4222-8222-222222222222", draft_id: "dx", created_at: "2026-11-10T10:00:00Z", email_design: { family: "discount", look: "big_number", photo_url: null } },
        { id: "new1", restaurant_id: R, draft_id: "d1", created_at: "2026-11-15T10:00:00Z", email_design: null, sent_at: null },
      ],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    const { assignDesign, tryAnotherLook } = await import("@/lib/email/design-store");
    const restaurant = { id: R, menu, photo_library: [] } as never;
    const saved = await assignDesign(restaurant, campaign({ id: "new1" }));
    // The other restaurant's big_number doesn't count: this one's last discount was photo_hero.
    expect(saved).toEqual({ family: "discount", look: "big_number", photo_url: null });
    expect(db.tables.campaigns.find((c) => c.id === "new1")?.email_design).toEqual(saved);
    expect((await tryAnotherLook(R, "d1"))?.look).toBe("menu_card");
    // Sent campaigns, and another restaurant's, can't be changed.
    expect(await tryAnotherLook(R, "d0")).toBeNull();
    expect(await tryAnotherLook(R, "dx")).toBeNull();
    vi.doUnmock("@/lib/supabase");
  });
});
