// The business review's Google profile health check (step 5): the score is
// plain code and deterministic; fixes only ever fill empty fields (checked when
// planned and again just before writing); a change to anything already there is
// a copy-paste step; what we don't know is asked, never guessed; UNDO empties
// again exactly what was filled in.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { descriptionProblems, knownAttributes, planFixes, readyFixes, topExamples, withFixes, yesNo, type KnownFacts } from "@/lib/review/fix-plan";
import { ATTRIBUTE_KEYS, RUBRIC_TOTAL, scoreProfile, type ProfileSnapshot } from "@/lib/review/health";

const NOV = new Date("2026-11-03T12:00:00Z");
const JUNE = new Date("2027-06-03T12:00:00Z");

const full: ProfileSnapshot = {
  description: "x".repeat(300),
  primaryCategory: "Halal restaurant",
  additionalCategories: ["Grill"],
  hasRegularHours: true,
  specialHourDates: ["2026-12-25"],
  phone: "020 7946 0000",
  website: "https://ember.example",
  menuLink: "https://ember.example/menu",
  attributes: { halal: true, vegetarian: true, parking: false, wheelchair: true, outdoor_seating: false },
  photoCount: 24,
  latestPhotoAt: "2026-10-20T10:00:00Z",
  hasLogo: true,
  hasCover: true,
  replyRate: 0.9,
};
const gappy: ProfileSnapshot = {
  ...full,
  description: "Grill house in Whitechapel.",
  additionalCategories: [],
  specialHourDates: [],
  phone: null,
  website: null,
  menuLink: null,
  attributes: { halal: null, vegetarian: null, parking: null, wheelchair: true, outdoor_seating: false },
  photoCount: 6,
  latestPhotoAt: "2026-03-01T10:00:00Z",
  hasLogo: false,
  hasCover: false,
  replyRate: 0.4,
};
const facts: KnownFacts = {
  name: "Ember & Spice",
  phone: "020 7946 0123",
  website: "https://emberandspice.example",
  opening_hours: { Monday: "12:00 – 23:00" },
  special_hours: null,
  halal_statement: "Yes, all our meat is HMC certified",
  faqs: { parking: "No, but there's a car park 2 minutes away", accessibility: "Yes, step-free" },
  logo_url: "https://app.test/logo.png",
  cuisine: "Grill",
};

describe("the score", () => {
  test("the rubric adds up to 100; a complete profile scores 100", () => {
    expect(RUBRIC_TOTAL).toBe(100);
    expect(scoreProfile(full, NOV).score).toBe(100);
  });

  test("deterministic: the same profile always gets the same score (500 random profiles)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const p: ProfileSnapshot = {
        ...full,
        description: rand() < 0.3 ? null : "y".repeat(Math.floor(rand() * 400)),
        primaryCategory: rand() < 0.2 ? null : "Restaurant",
        additionalCategories: rand() < 0.5 ? [] : ["Cafe"],
        hasRegularHours: rand() < 0.8,
        specialHourDates: rand() < 0.5 ? [] : ["2026-12-25"],
        phone: rand() < 0.3 ? null : "1",
        attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, rand() < 0.4 ? null : rand() < 0.5])) as ProfileSnapshot["attributes"],
        photoCount: Math.floor(rand() * 30),
        replyRate: rand() < 0.1 ? null : rand(),
      };
      const a = scoreProfile(p, NOV);
      expect(scoreProfile(structuredClone(p), NOV)).toEqual(a);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
      expect(a.items.reduce((s, x) => s + x.points, 0)).toBe(a.score);
    }
  });

  test("the gaps cost what the rubric says", () => {
    const s = scoreProfile(gappy, NOV);
    expect(s.score).toBe(33); // description 8, category 8, hours 10, 2 of 5 attributes 4, 6 photos 3
    expect(s.gaps).toEqual(["description_long", "secondary_categories", "special_hours", "phone", "website", "menu_link", "attributes", "photos", "photos_recent", "logo", "cover", "reply_rate"]);
    // Christmas hours only count from November.
    expect(scoreProfile(gappy, JUNE).gaps).not.toContain("special_hours");
  });
});

describe("the fixes", () => {
  test("empty fields filled from what the owner told us; nothing already on Google is touched", () => {
    const plan = planFixes(gappy, facts, NOV);
    expect(plan.apply.map((a) => a.field)).toEqual(["phone", "website", "attributes", "logo"]);
    expect(plan.apply.find((a) => a.field === "attributes")!.value).toEqual({ halal: true, parking: false });
    // A short description already there: a longer one is suggested to paste in, never written over.
    expect(plan.description).toBe("longer");
    expect(plan.copyPaste.map((c) => c.label)).toEqual(["Secondary categories", "More recent photos", "A cover photo"]);
    // Christmas hours we don't have, a menu link, vegetarian: asked, never guessed.
    expect(plan.asks).toEqual(["your Christmas and New Year hours", "a link to your menu online, if you have one", "whether you have vegetarian options"]);
    expect(readyFixes(plan)).toBe(8);
    expect(topExamples(plan)).toEqual(["A longer description", "Your phone number"]);
  });

  test("a phone number on Google, even a different one, is left alone", () => {
    const plan = planFixes({ ...gappy, phone: "020 0000 0000" }, facts, NOV);
    expect(plan.apply.map((a) => a.field)).not.toContain("phone");
  });

  test("Christmas hours: known and Google has none, filled; Google has other dates, copy-paste; unknown, asked", () => {
    const xmas = { ...facts, special_hours: { "2026-12-25": { hours: "Closed" } } };
    expect(planFixes(gappy, xmas, NOV).apply.map((a) => a.field)).toContain("special_hours");
    const other = planFixes({ ...gappy, specialHourDates: ["2026-08-31"] }, xmas, NOV);
    expect(other.apply.map((a) => a.field)).not.toContain("special_hours");
    expect(other.copyPaste.find((c) => c.label === "Your Christmas and New Year hours")!.text).toMatch(/25 December: Closed/);
  });

  test("an empty description is written by Dina (and filled); her words must pass the rules", () => {
    expect(planFixes({ ...gappy, description: null }, facts, NOV).description).toBe("fill");
    const good = `Ember & Spice is a halal grill in Whitechapel, cooking over charcoal. ${"Lamb chops, mixed grills and fresh naan, made to order every day. ".repeat(3)}`;
    expect(descriptionProblems(good, "Ember & Spice")).toEqual([]);
    expect(descriptionProblems(`${good} Call 020 7946 0123`, "Ember & Spice").join(" ")).toMatch(/phone/);
    expect(descriptionProblems(`${good} The best grill in London.`, "Ember & Spice").join(" ")).toMatch(/best/);
    expect(descriptionProblems("Too short.", "Ember & Spice").join(" ")).toMatch(/at least 250/);
  });

  test("yes and no from the owner's own words", () => {
    expect(yesNo("Yes, free parking at the back")).toBe(true);
    expect(yesNo("No, sadly")).toBe(false);
    expect(yesNo("There's a car park nearby")).toBe(true);
    expect(yesNo("Depends on the day")).toBeNull();
    expect(knownAttributes({ ...facts, halal_statement: null, faqs: {} }).halal).toBeNull();
  });

  test("the score the fixes would give (a dry run's 'after')", () => {
    const plan = planFixes(gappy, facts, NOV);
    expect(scoreProfile(withFixes(gappy, plan.apply, null), NOV).score).toBeGreaterThan(scoreProfile(gappy, NOV).score);
  });
});

// ---------- Filling in, on dummy Google, then UNDO ----------

const R = "cdcdcdcd-0000-4000-8000-000000000058";
let db: ReturnType<typeof memoryDb>;
beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [
      {
        id: R, name: "Ember & Spice", is_demo: true, owner_whatsapp: "whatsapp:+447700900158", paused: false, send_window_start: "00:00:00", send_window_end: "23:59:00", discount_cap_percent: 20, agent_modes: null,
        dummy_google_profile: { description: null, phone: null, website: "https://already.example", attributes: { halal: null, parking: null }, photos: [] },
      },
    ],
    drafts: [],
    audit_log: [],
    sent_log: [],
    blocked_sends: [],
    reviews: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

function fixDraft(extra: Record<string, unknown> = {}) {
  const d = {
    id: "fix-1", restaurant_id: R, kind: "profile_fix", status: "approved", version: 1, content: "Filling in...", audience: "your Google profile", approved_at: new Date().toISOString(), sent_at: null, waiting_for: null, created_at: new Date().toISOString(),
    checks: { tone: { status: "pass", fixes: [], flags: [] }, facts: { status: "pass", fixes: [], flags: [] } },
    agent_input: {
      description: "Ember & Spice is a halal grill...",
      apply: [
        { field: "phone", label: "Your phone number", value: "020 7946 0123" },
        { field: "website", label: "Your website", value: "https://emberandspice.example" },
        { field: "attributes", label: "What customers filter by", value: { halal: true, parking: false } },
      ],
    },
    ...extra,
  };
  db.tables.drafts.push(d);
  return d;
}

describe("filling in and UNDO (dummy Google)", () => {
  test("only fields still empty are filled: a website set since the plan is left as it is", async () => {
    fixDraft();
    const { attemptSend } = await import("@/lib/send");
    const out = await attemptSend("fix-1", db.tables.restaurants[0] as never, new Date(), "approve");
    expect(out.outcome).toBe("sent");
    const p = db.tables.restaurants[0].dummy_google_profile as Record<string, unknown>;
    expect(p).toMatchObject({ description: "Ember & Spice is a halal grill...", phone: "020 7946 0123", website: "https://already.example", attributes: { halal: true, parking: false } });
    expect(out.outcome === "sent" && out.note).toMatch(/Filled in on Google: your description, your phone number, halal food, parking\. One field wasn't empty any more/);
  });

  test("nothing is filled without the owner's approval (the gate refuses a pending draft)", async () => {
    fixDraft({ status: "pending", approved_at: null });
    const { attemptSend } = await import("@/lib/send");
    expect((await attemptSend("fix-1", db.tables.restaurants[0] as never, new Date(), "approve")).outcome).toBe("blocked");
    expect((db.tables.restaurants[0].dummy_google_profile as Record<string, unknown>).phone).toBeNull();
  });

  test("UNDO empties again exactly what was filled in, and nothing else", async () => {
    fixDraft();
    const { attemptSend } = await import("@/lib/send");
    await attemptSend("fix-1", db.tables.restaurants[0] as never, new Date(), "approve");
    db.tables.audit_log.push({ id: "a1", restaurant_id: R, draft_id: "fix-1", actor: "owner", action: "approved", detail: "Approved the Google profile fixes", data: null, batch_id: null, undone_at: null, created_at: new Date().toISOString() });
    const { undoLast } = await import("@/lib/undo");
    const text = await undoLast(db.tables.restaurants[0] as never, new Date());
    expect(String(text)).toMatch(/Took back the profile fixes/);
    expect(db.tables.restaurants[0].dummy_google_profile).toMatchObject({ description: null, phone: null, website: "https://already.example", attributes: { halal: null, parking: null } });
    expect(db.tables.drafts[0].status).toBe("withdrawn");
  });
});

describe("filling in on live Google", () => {
  test("re-read just before writing: only empty fields are in the update mask, set attributes are left alone", async () => {
    const patchProfile = vi.fn(async () => ({}));
    const patchAttributes = vi.fn(async () => ({}));
    vi.doMock("@/lib/google", async (orig) => ({ ...(await orig<object>()), googleModeFor: async () => "live" }));
    vi.doMock("@/lib/google/connections", async (orig) => ({ ...(await orig<object>()), linkFor: async () => ({ restaurant: db.tables.restaurants[0], connection: {}, accountId: "accounts/1", locationId: "locations/9" }) }));
    vi.doMock("@/lib/google/writes", () => ({ onceOnGoogle: async (_i: unknown, write: () => Promise<unknown>) => write() }));
    vi.doMock("@/lib/google/api", async (orig) => ({
      ...(await orig<object>()),
      // The owner added a phone number on Google since the plan was made.
      getProfileLocation: async () => ({ name: "locations/9", phoneNumbers: { primaryPhone: "020 1111 2222" }, profile: {} }),
      getAttributes: async () => [{ name: "attributes/has_halal", values: [true] }],
      attributeMetadata: async () => [
        { parent: "attributes/has_halal", valueType: "BOOL", displayName: "Halal food" },
        { parent: "attributes/has_parking", valueType: "BOOL", displayName: "Free parking lot" },
      ],
      listMedia: async () => [],
      patchProfile,
      patchAttributes,
    }));
    const d = fixDraft();
    const { applyProfileFix } = await import("@/lib/review/google-profile");
    const note = await applyProfileFix(db.tables.restaurants[0] as never, d as never);
    expect(patchProfile).toHaveBeenCalledTimes(1);
    expect((patchProfile.mock.calls[0] as unknown[])[2]).toEqual(["profile.description", "websiteUri"]);
    expect((patchAttributes.mock.calls[0] as unknown[])[1]).toEqual([{ name: "attributes/has_parking", values: [false] }]);
    expect(note).toMatch(/2 fields weren't empty any more/);
    for (const m of ["@/lib/google", "@/lib/google/connections", "@/lib/google/writes", "@/lib/google/api"]) vi.doUnmock(m);
  });
});

describe("the profile part and its step in the guided flow", () => {
  test("score, one held 'Approve fixes' draft, then Approve fixes fills them in and shows before and after", async () => {
    const RV = "cdcdcdcd-0000-4000-8000-00000000a058";
    const desc = `Ember & Spice is a halal grill in Whitechapel, cooking over charcoal. ${"Lamb chops, mixed grills and fresh naan, made to order every day. ".repeat(3)}`;
    Object.assign(db.tables.restaurants[0], { phone: "020 7946 0123", website: null, halal_statement: "Yes, HMC certified", faqs: {}, menu: [], logo_url: null, opening_hours: { Monday: "12:00 – 23:00" }, dummy_google_profile: { description: null, primaryCategory: "Halal restaurant", regularHours: { Monday: "12:00 – 23:00" }, attributes: {}, photos: [] } });
    db.tables.business_reviews = [{ id: RV, restaurant_id: R, status: "sent", google_connected: true, flow_state: {}, created_at: new Date().toISOString() }];
    db.tables.business_review_parts = [];
    db.tables.time_saved_log = [];
    vi.doMock("@/lib/agents/run", () => ({ callAgent: async () => ({ output: { description: desc } }) }));
    vi.doMock("@/lib/assistant", () => ({ loadRestaurantContext: async () => ({ restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }) }));
    vi.doMock("@/lib/checks", () => ({ checkDraft: async (_c: unknown, d: { content: string }) => ({ content: d.content, checks: { tone: { status: "pass", fixes: [], flags: [] }, facts: { status: "pass", fixes: [], flags: [] } } }) }));
    const { profilePart } = await import("@/lib/review/parts/profile");
    const result = await profilePart({ review: db.tables.business_reviews[0] as never, restaurant: db.tables.restaurants[0] as never, now: NOV, connected: true, round: 0 });
    expect(result.score).toBe(27); // category 8, hours 10, no reviews yet so replies 9
    expect(result.draftId).toEqual(expect.any(String));
    const draft = db.tables.drafts.find((d) => d.id === result.draftId)!;
    expect(draft).toMatchObject({ kind: "profile_fix", status: "pending", business_review_id: RV });
    expect(String(draft.content)).toContain(`1. Description: "${desc.trim()}"`);
    expect(String(draft.content)).toContain("2. Your phone number: 020 7946 0123");
    db.tables.business_review_parts.push({ review_id: RV, restaurant_id: R, part: "profile", status: "done", result });

    const out: string[] = [];
    vi.doMock("@/lib/notify", () => ({ sendAndLog: async (_c: unknown, deliver: () => Promise<unknown>) => void (await deliver()) }));
    vi.doMock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), sendDinaChoices: async (_f: string, _t: string, m: { body: string }) => (out.push(m.body), { sid: "SM", body: m.body }) }));
    const flow = await import("@/lib/review/flow-run");
    const turn = { ctx: { restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }, channel: { restaurantId: R, from: "a", to: "b" }, owner: "b", send: async (t: string) => void (t && out.push(t)) } as never;
    await flow.handleReviewFlow(turn, "GO", undefined);
    expect(out.at(-1)).toMatch(/^📋 \*Your Google profile: 27\/100\*/);
    await flow.handleReviewFlow(turn, "", `review:${RV}:profile:approve`);
    expect(out.join("\n")).toMatch(/Filled in on Google: your description, your phone number, halal food/);
    expect(out.join("\n")).toMatch(/Before: 27\/100\. Now: \d+\/100\./);
    expect(out.join("\n")).toMatch(/things Google only lets you change yourself/);
    expect(out.join("\n")).toMatch(/To finish the rest, I just need/);
    expect((db.tables.restaurants[0].dummy_google_profile as Record<string, unknown>).phone).toBe("020 7946 0123");
    for (const m of ["@/lib/agents/run", "@/lib/assistant", "@/lib/checks", "@/lib/notify", "@/lib/whatsapp"]) vi.doUnmock(m);
  });
});

test("UNDO's plan for profile fixes: empty them again (dummy and live); simulated or dry run posted nothing", async () => {
  const { undoPlan } = await import("@/lib/undo-plan");
  const approved = { action: "approved", data: null };
  expect(undoPlan(approved, { kind: "profile_fix", status: "sent", review_id: null }, "live")).toEqual({ type: "restore_google_profile" });
  expect(undoPlan(approved, { kind: "profile_fix", status: "sent", review_id: null }, "dummy")).toEqual({ type: "restore_google_profile" });
  expect(undoPlan(approved, { kind: "profile_fix", status: "sent", review_id: null }, "simulated")).toEqual({ type: "withdraw_simulated" });
  expect(undoPlan(approved, { kind: "profile_fix", status: "sent", review_id: null, checks: { send: { dry_run: {} } } }, "live")).toEqual({ type: "withdraw_simulated" });
});
