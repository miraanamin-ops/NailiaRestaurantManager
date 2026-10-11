// The checker's tools: resolve_sources, get_recent_outputs, get_maker_rules,
// get_profile and get_rendered_preview. Each reads only its own restaurant's
// data, and only tools in the agent's front matter can be used.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { legacySources } from "@/lib/agents/sources";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const restaurant = (id: string, name: string) => ({
  id, name, cuisine: "Grill", address: "1 High St", website: null, owner_name: "Bilal", brand_voice: "Warm", menu: [], opening_hours: {},
  phone: "020 7946 0000", signup_reward: null, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00",
  logo_url: null, brand_color: "#c2410c", brand_dark: "#1c1917", sign_off_name: "Bilal", greeting: null, complaint_contact: "hello@ember.test",
  halal_statement: "All our meat is halal (HMC certified).", allergen_statement: null, recovery_offers: ["Free dessert next visit"], words_to_avoid: [],
  emoji_allowed: null, profile_version: 3,
});
const draft = (id: string, rid: string, kind: string, content: string, created: string, status = "sent") => ({
  id, restaurant_id: rid, kind, content, status, created_at: created, request: id === "dA2" ? "Reply to Aisha" : null, review_id: null,
});

let db: ReturnType<typeof memoryDb>;
beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [restaurant(A, "Ember & Spice Grill"), restaurant(B, "Cardamom Corner")],
    reviews: [
      { id: "rA", restaurant_id: A, author_name: "Aisha K", rating: 5, text: "Best lamb chops", review_date: "2026-10-08T10:00:00Z" },
      { id: "rB", restaurant_id: B, author_name: "Beatrice", rating: 2, text: "Cold latte", review_date: "2026-10-08T10:00:00Z" },
    ],
    drafts: [
      draft("dA1", A, "review_reply", "Thanks Omar!", "2026-10-01T10:00:00Z"),
      draft("dA2", A, "review_reply", "Thank you, Aisha!", "2026-10-02T10:00:00Z", "pending"),
      draft("dA3", A, "google_post", "Lamb chops are back", "2026-10-03T10:00:00Z"),
      draft("dB1", B, "review_reply", "Thanks Beatrice", "2026-10-04T10:00:00Z"),
    ],
    customers: [],
    rewards: [],
    campaigns: [],
    campaign_sends: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

describe("resolve_sources", () => {
  test("resolves the review, profile fields and the owner's request", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    const out = await callTool("checker", "resolve_sources", A, { refs: ["review:rA", "profile:halal_statement", "profile:recovery_offers", "request:dA2"] });
    expect(out).toEqual([
      { ref: "review:rA", found: true, data: expect.objectContaining({ author_name: "Aisha K", rating: 5 }) },
      { ref: "profile:halal_statement", found: true, data: "All our meat is halal (HMC certified)." },
      { ref: "profile:recovery_offers", found: true, data: ["Free dessert next visit"] },
      { ref: "request:dA2", found: true, data: { owner_asked: "Reply to Aisha" } },
    ]);
  });

  test("another restaurant's review is never resolved", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    expect(await callTool("checker", "resolve_sources", A, { refs: ["review:rB"] })).toEqual([
      { ref: "review:rB", found: false, reason: "no such review for this restaurant" },
    ]);
  });

  test("unknown fields, unknown kinds and not-yet-built sources are reported as not found", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    const out = await callTool("checker", "resolve_sources", A, { refs: ["profile:favourite_colour", "website:x", "metrics:net_sales_weekly"] });
    expect(out.map((r) => r.found)).toEqual([false, false, false]);
  });
});

describe("the other tools", () => {
  test("get_recent_outputs: same kind, same restaurant, newest first, not the draft itself", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    expect(await callTool("checker", "get_recent_outputs", A, { kind: "review_reply", excludeDraftId: "dA2" })).toEqual(["Thanks Omar!"]);
  });

  test("get_maker_rules: the maker agent's Rules section", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    const rules = await callTool("checker", "get_maker_rules", A, { maker: "reputation" });
    expect(rules).toMatch(/Reply in the language the review is written in/);
  });

  test("get_profile: the profile and its version", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    const out = await callTool("checker", "get_profile", A, {});
    expect(out).toMatchObject({ version: 3, fields: { name: "Ember & Spice Grill", complaint_contact: "hello@ember.test" } });
  });

  test("get_rendered_preview: emails only (nothing for a review reply)", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    expect(await callTool("checker", "get_rendered_preview", A, { draftId: "dA1" })).toBeNull();
  });

  test("a tool missing from the agent's front matter is refused", async () => {
    const { callTool } = await import("@/lib/agents/tools");
    await expect(callTool("reputation", "resolve_sources", A, { refs: [] })).rejects.toThrow(/isn't allowed/);
    await expect(callTool("reputation", "get_maker_rules", A, { maker: "growth" })).rejects.toThrow(/isn't allowed/);
  });
});

describe("sources for drafts written before the agents", () => {
  test("a review reply relies on its review and the reply fields of the profile", () => {
    const refs = legacySources({ id: "d1", kind: "review_reply", review_id: "rA", request: "Review check" });
    expect(refs[0]).toBe("review:rA");
    expect(refs).toEqual(expect.arrayContaining(["profile:sign_off_name", "profile:complaint_contact", "profile:recovery_offers", "request:d1"]));
    expect(refs).not.toContain("profile:discount_cap");
  });
  test("a campaign relies on its segment and the cap", () => {
    expect(legacySources({ id: "d2", kind: "email_campaign", review_id: null, request: null }, "everyone")).toEqual(
      expect.arrayContaining(["profile:discount_cap", "segment:everyone"]),
    );
  });
});
