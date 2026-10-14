// The plain-code price check: every £ amount in customer-facing text is a menu
// price, a value in the structured offer, or in the owner's own offers. It runs on
// each maker's output (Reputation, Visibility, Growth) before the checker.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { growthProblems } from "@/lib/agents/growth-rules";
import { reputationProblems } from "@/lib/agents/reputation-rules";
import { poundsIn, unknownPrices } from "@/lib/prices";

const MENU = [
  { category: "Grills", items: [{ name: "Peri Peri Wings (8)", price: 7.5 }, { name: "Lamb Chops (4 pcs)", price: 13.95 }] },
  { category: "Drinks", items: [{ name: "Mango Lassi", price: 3.95 }] },
];

describe("prices", () => {
  test("£ amounts are read in any common form", () => {
    expect(poundsIn("£7.50, £ 14, £1,200 and £3.9").map((p) => p.value)).toEqual([7.5, 14, 1200, 3.9]);
  });

  test("menu prices, offer values and the owner's own offers pass; anything else is flagged", () => {
    expect(unknownPrices("Wings £7.50, lamb chops £13.95.", { menu: MENU })).toEqual([]);
    expect(unknownPrices("£2 off any grill", { menu: MENU, values: [2] })).toEqual([]);
    expect(unknownPrices("£5 off your next visit", { menu: MENU, ownerTexts: ["£5 off your next visit"] })).toEqual([]);
    expect(unknownPrices("Wings for just £6.50 and lamb chops at £13.95", { menu: MENU })).toEqual(["£6.50"]);
  });

  test("checker case 08 (the wrong price Haiku passed) now fails in code", () => {
    const c = JSON.parse(readFileSync("agents/tests/checker/08-wrong-price.json", "utf8"));
    expect(unknownPrices(c.text, { menu: c.profile.fields.menu })).toEqual(["£6.50"]);
  });
});

describe("in the makers' rules", () => {
  test("Reputation: a price in a reply must be real", () => {
    const reply = {
      review_id: "r1", rating: 5, type: "review_reply", channel: "google", alert: false, content: { text: "Thank you, Aisha! Glad you loved the lamb chops at £12.95. Bilal and the team" },
      needs_owner_input: null, sources_used: ["review:r1", "profile:sign_off_name"],
    };
    const problems = reputationProblems(reply as never, { review: { id: "r1", author_name: "Aisha", rating: 5, text: "Loved it" }, profile: { sign_off_name: "Bilal and the team", menu: MENU } });
    expect(problems.join()).toMatch(/£12.95 in the reply isn't a price on the menu/);
  });

  test("Growth: the email and the offer's terms", () => {
    const d = {
      type: "campaign", channel: "email", name: "Wings night", segment: "everyone", audience_size: 3, send_at: "2026-10-14T10:00", template: "offer", photo_id: null,
      content: { subject: "Wings night", headline: "Wings for £6.50", body: "Our Peri Peri Wings, this Thursday only.", cta: "Book" },
      offer: { type: "money_off", description: "£1 off Peri Peri Wings", items: ["Peri Peri Wings (8)"], applies_to: "Peri Peri Wings (8)", discount_percent: null, discount_value_gbp: 1, valid_from: "2026-10-15", valid_to: "2026-10-15", conditions: "Dine-in only" },
      idea: null, expected_outcome: "First campaign of this kind, no baseline yet.", needs_owner_input: null, sources_used: ["profile:menu"],
    };
    const ctx = { task: "owner_request" as const, today: "2026-10-12", profile: { menu: MENU, discount_cap: 20, approved_offer_types: ["money_off"] }, segments: { everyone: 3 }, history: [], photoIds: [], sendWindow: { start: "09:00:00", end: "21:00:00" } };
    expect(growthProblems(d as never, ctx).join()).toMatch(/£6.50 in the email isn't a price on the menu/);
    expect(growthProblems({ ...d, content: { ...d.content, headline: "Wings £7.50, £1 off" } } as never, ctx).join()).not.toMatch(/isn't a price on the menu/);
  });
});
