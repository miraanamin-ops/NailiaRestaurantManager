// Everything the agents need, asked in setup (4 Nov): the sign-off name and emoji
// (tone), the allergen statement (menu), the kinds of offer (rewards), the logo,
// colours and dish photos (customers and QR codes). The rules as plain code, then
// saving on the in-memory database, and the guard that matters: a restaurant that
// answered everything has nothing missing for any agent's go-live checklist.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { brandCard, colourFrom, DEFAULT_ALLERGEN_STATEMENT, detailFields, EMOJI_NO, EMOJI_YES, offerTypesFrom } from "@/lib/onboarding/dina/details-content";
import { DinaReplyWire, fromWire } from "@/lib/onboarding/dina/reply";
import { GO_LIVE_FIELDS, missingForGoLive } from "@/lib/profile/fields";
import { memoryDb } from "./support/memory-db";

describe("the rules", () => {
  test("offer types from names, ids or the owner's words", () => {
    expect(offerTypesFrom("2 for 1, % off")).toEqual(["percent_off", "two_for_one"]);
    expect(offerTypesFrom("percent_off; kids_eat_free")).toEqual(["percent_off", "kids_eat_free"]);
    expect(offerTypesFrom("A free item with a purchase and £ off")).toEqual(["money_off", "free_item"]);
    expect(offerTypesFrom("buy one get one free")).toEqual(["two_for_one"]);
    expect(offerTypesFrom("whatever")).toEqual([]);
  });

  test("details notes become fields; anything unusable is a problem, never a guess", () => {
    expect(detailFields({ sign_off_name: " Amina,  Ember & Spice ", emoji: "Yes please", allergen_statement: DEFAULT_ALLERGEN_STATEMENT, offer_types: "2 for 1" })).toEqual({
      fields: { sign_off_name: "Amina, Ember & Spice", emoji_allowed: EMOJI_YES, allergen_statement: DEFAULT_ALLERGEN_STATEMENT, approved_offer_types: ["two_for_one"] },
      problems: [],
    });
    expect(detailFields({ emoji: "no" }).fields.emoji_allowed).toEqual(EMOJI_NO);
    const bad = detailFields({ sign_off_name: "A", emoji: "maybe", allergen_statement: "ask", offer_types: "nothing" });
    expect(bad.fields).toEqual({});
    expect(bad.problems).toHaveLength(4);
  });

  test("colours: codes and common names; anything else isn't guessed", () => {
    expect(colourFrom("#1B5E20")).toBe("#1b5e20");
    expect(colourFrom("1b5e20")).toBe("#1b5e20");
    expect(colourFrom("Dark green")).toBe("#1b5e20");
    expect(colourFrom("the colour of our sign")).toBeNull();
  });

  test("the 'Your look' card: the logo as a picture and the colour as a swatch; a missing logo says so", () => {
    expect(brandCard({ logo_url: "https://s.test/logo.png", brand_color: "#123456", from_website: true }, {})).toEqual({
      title: "Your look",
      image: "https://s.test/logo.png",
      fields: [
        { key: "logo", label: "Logo", value: "From your website (above)" },
        { key: "brand_color", label: "Main colour", value: "#123456", colour: "#123456" },
      ],
    });
    expect(brandCard(null, { brand_color: "#c2410c" }).fields[0].value).toBeNull();
  });

  test("on WhatsApp the logo goes first as a picture, then the card with its buttons", async () => {
    const { renderForWhatsApp } = await import("@/lib/onboarding/dina/whatsapp");
    const card = brandCard({ logo_url: "https://s.test/logo.png", brand_color: "#123456" }, {});
    const outs = renderForWhatsApp([{ id: "m1", role: "dina", text: "Is this your look?", component: { type: "confirmation", card } }], { skippable: true, chatUrl: "https://app.test/c", appUrl: "https://app.test" });
    expect(outs[0]).toEqual({ kind: "text", body: "*Your look*", mediaUrl: "https://s.test/logo.png" });
    expect(JSON.stringify(outs[1])).toContain("Main colour: #123456");
  });

  test("Dina's notes for these come through the wire shape", () => {
    const wire = DinaReplyWire.parse({
      messages: [{ text: "Lovely.", component: null }],
      notes: [
        { field: "details.sign_off_name", value: "Amina" },
        { field: "details.emoji", value: "no" },
        { field: "brand.colour", value: "navy" },
      ],
    });
    expect(fromWire(wire)).toMatchObject({ details_notes: { sign_off_name: "Amina", emoji: "no" }, brand_notes: { colour: "navy" } });
    expect(DinaReplyWire.safeParse({ messages: [{ text: "x", component: { type: "editable_card", card: "brand" } }], notes: [] }).success).toBe(true);
  });
});

// ---------- On the in-memory database ----------

const R = "dddddddd-0000-4000-8000-0000000000c1";
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [
      {
        id: R, name: "Ember Grill", slug: "ember-grill", owner_name: "Amina", website: null, logo_url: null, brand_color: "#c2410c", brand_dark: "#1c1917",
        emoji_allowed: { review_replies: 0, posts: 2, campaigns: 2 }, photo_library: [], menu: [], profile_version: 0,
      },
    ],
    onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "customers_qr", channel_last_used: "web", started_at: "2026-11-04T10:00:00.000Z", completed_at: null }],
    onboarding_steps: [{ restaurant_id: R, step_key: "customers_qr", status: "in_progress", data: {} }],
    onboarding_messages: [],
    setup_gaps: [],
    audit_log: [],
    profile_versions: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
  vi.doMock("@/lib/photos", async (orig) => ({
    ...(await orig<object>()),
    saveLogo: async () => "https://storage.test/logo.png",
    savePostPhoto: async () => `https://storage.test/dish-${Math.random().toString(36).slice(2, 8)}.jpg`,
  }));
  vi.doMock("@/lib/onboarding/dina/uploads-store", async (orig) => ({ ...(await orig<object>()), readSavedFile: async () => Buffer.from([0xff, 0xd8, 0xff, 0x00]) }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/ops/menu", "@/lib/photos", "@/lib/onboarding/dina/uploads-store"]) vi.doUnmock(m);
});

const r = () => db.tables.restaurants[0];
const confirmed = () => new Set(db.tables.profile_versions.map((v) => v.field as string));
const photo = (n: number) => ({ type: "file" as const, path: `${R}/incoming/p${n}.jpg`, kind: "photo" as const, contentType: "image/jpeg", bytes: 4 });

describe("saving", () => {
  test("details notes are saved and count as confirmed, even the emoji default kept as it is", async () => {
    const { applyDetailNotes } = await import("@/lib/onboarding/dina/details-step");
    await applyDetailNotes(R, { sign_off_name: "Amina, Ember Grill", emoji: "yes", allergen_statement: DEFAULT_ALLERGEN_STATEMENT, offer_types: "% off, 2 for 1" });
    expect(r()).toMatchObject({ sign_off_name: "Amina, Ember Grill", allergen_statement: DEFAULT_ALLERGEN_STATEMENT, approved_offer_types: ["percent_off", "two_for_one"], emoji_allowed: EMOJI_YES });
    expect(confirmed()).toEqual(new Set(["sign_off_name", "allergen_statement", "approved_offer_types", "emoji_allowed"]));
  });

  test("the logo they send is kept as a draft, 'Looks right' saves it and confirms the default colours", async () => {
    const { lookFiles, confirmBrand } = await import("@/lib/onboarding/dina/details-step");
    expect(await confirmBrand(R, "web")).toMatch(/There's no logo yet/);
    expect(await lookFiles(R, [photo(1)])).toMatch(/kept that as their logo\. Show editable_card brand/);
    expect(r().logo_url).toBeNull();
    expect(await confirmBrand(R, "web")).toMatch(/saved their logo and colours\. Next, suggest they send 3 photos/);
    expect(r().logo_url).toBe("https://storage.test/logo.png");
    expect(confirmed()).toEqual(new Set(["logo", "colours"]));
    // After that, photos are dishes for the library.
    expect(await lookFiles(R, [photo(2), photo(3)])).toMatch(/saved 2 photos to their library \(2 in all\)\. They can send 1 more/);
    expect((r().photo_library as unknown[]).length).toBe(2);
  });

  test("a colour they name goes onto the card's draft", async () => {
    const { applyBrandNotes } = await import("@/lib/onboarding/dina/details-step");
    expect(await applyBrandNotes(R, { colour: "navy" })).toBe(true);
    expect(db.tables.onboarding_steps[0].data).toMatchObject({ brand_draft: { brand_color: "#1a237e" } });
    expect(await applyBrandNotes(R, { colour: "the sign" })).toBe(false);
  });
});

describe("a full setup leaves nothing missing for any agent", () => {
  test("every go-live field is one setup asks for", async () => {
    const { applyDetailNotes, lookFiles, confirmBrand } = await import("@/lib/onboarding/dina/details-step");
    // What the earlier steps save (each has its own tests): hello, making it right,
    // hours and FAQs (halal), rewards and the cap, timing; language and quiet hours have defaults.
    Object.assign(r(), {
      address: "1 High St, E1 1AA", cuisine: "Grill", google_place_id: "ChIJ1", menu: [{ category: "Grills", items: [{ name: "Lamb Chops", price: 14, description: null }] }],
      opening_hours: { Monday: "12:00 – 23:00" }, complaint_contact: "Amina, owner", recovery_offers: ["Invite them back"], halal_statement: "HMC certified",
      signup_reward: "a free dessert", discount_cap_percent: 15, send_window_start: "09:00:00", send_window_end: "21:00:00",
      owner_language: "English", quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00",
    });
    await applyDetailNotes(R, { sign_off_name: "Amina", emoji: "yes", allergen_statement: DEFAULT_ALLERGEN_STATEMENT, offer_types: "% off" });
    await lookFiles(R, [photo(1)]);
    await confirmBrand(R, "web");
    for (const agent of Object.keys(GO_LIVE_FIELDS) as (keyof typeof GO_LIVE_FIELDS)[]) {
      expect({ agent, missing: missingForGoLive(r(), agent, confirmed()) }).toEqual({ agent, missing: [] });
    }
  });
});
