// Structured offers and the discount cap: a % off as it is; a free item or £ off as a %
// of the menu price of the dish it comes with; 2 for 1 as half off the pair. If
// code can't work it out, the gate blocks it. The wording check stays as a backstop.
import { describe, expect, test } from "vitest";
import { moneyAndRisk, moneyAtDraft } from "@/lib/checks/money";
import { findDish, offerCap, type StructuredOffer } from "@/lib/offers";

const MENU = [
  { category: "Grills", items: [{ name: "Mixed Grill Platter", price: 18.5 }, { name: "Lamb Chops (4 pcs)", price: 13.95 }] },
  { category: "Drinks", items: [{ name: "Mango Lassi", price: 3.5 }] },
];
const offer = (o: Partial<StructuredOffer>): StructuredOffer => ({
  type: "free_item",
  description: "Free Mango Lassi with any Mixed Grill Platter",
  items: ["Mango Lassi"],
  applies_to: "Mixed Grill Platter",
  discount_percent: null,
  discount_value_gbp: 3.5,
  valid_from: "2026-10-15",
  valid_to: "2026-10-15",
  conditions: "Dine-in only, one per table",
  ...o,
});

describe("the cap from the offer's fields", () => {
  test("a free item is a % of the dish it comes with (£3.50 with an £18.50 platter = 19%)", () => {
    expect(offerCap(offer({}), MENU, 20)).toEqual({ ok: true, percent: 19 });
    expect(offerCap(offer({}), MENU, 15)).toMatchObject({ ok: false, reason: "over_cap", percent: 19 });
  });
  test("a % off is checked as it is; 2 for 1 is half off", () => {
    expect(offerCap(offer({ type: "percent_off", discount_percent: 15, discount_value_gbp: null }), MENU, 20)).toEqual({ ok: true, percent: 15 });
    expect(offerCap(offer({ type: "percent_off", discount_percent: 25, discount_value_gbp: null }), MENU, 20)).toMatchObject({ ok: false, reason: "over_cap" });
    expect(offerCap(offer({ type: "two_for_one", applies_to: "Lamb Chops" }), MENU, 20)).toMatchObject({ ok: false, reason: "over_cap", percent: 50 });
  });
  test("a dish that isn't on the menu, or no £ value, can't be checked: blocked", () => {
    expect(offerCap(offer({ applies_to: "Lobster" }), MENU, 20)).toMatchObject({ ok: false, reason: "unknown" });
    expect(offerCap(offer({ discount_value_gbp: null }), MENU, 20)).toMatchObject({ ok: false, reason: "unknown" });
  });
  test("dishes are found by name, without the portion in brackets", () => {
    expect(findDish(MENU, "lamb chops")?.price).toBe(13.95);
    expect(findDish(MENU, "Lamb Chops (4 pcs)")?.price).toBe(13.95);
    expect(findDish(MENU, "chips")).toBeNull();
  });
});

describe("the gate", () => {
  const restaurant = { paused: false, discount_cap_percent: 15, send_window_start: "09:00:00", send_window_end: "21:00:00", menu: MENU };
  const draft = { kind: "email_campaign", status: "approved", approved_at: "2026-10-12T10:00:00Z", sent_at: null, scheduled_for: null, content: "A treat for Thursday: a free drink with your platter." };
  const now = new Date("2026-10-12T11:00:00Z");

  test("blocks an offer over the cap from its fields, even when the wording has no %", () => {
    expect(moneyAndRisk({ ...draft, offer_details: offer({}) }, restaurant, now, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap", detail: expect.stringMatching(/19% off, above the 15% cap/) });
    expect(moneyAndRisk({ ...draft, offer_details: offer({}) }, { ...restaurant, discount_cap_percent: 20 }, now, "approve")).toMatchObject({ outcome: "ok" });
  });
  test("an offer code can't measure is blocked", () => {
    expect(moneyAndRisk({ ...draft, offer_details: offer({ applies_to: null }) }, restaurant, now, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap", detail: expect.stringMatching(/name the menu dish/) });
  });
  test("the wording check still applies (a backstop), with or without fields", () => {
    const words = { ...draft, content: "30% off all grills this Thursday" };
    expect(moneyAndRisk(words, restaurant, now, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap" });
    expect(moneyAndRisk({ ...words, offer_details: offer({ type: "percent_off", discount_percent: 10, discount_value_gbp: null }) }, restaurant, now, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap" });
  });
  test("at draft time the owner is told before approving", () => {
    expect(moneyAtDraft(draft.content, 15, { details: offer({}), menu: MENU })).toEqual([expect.stringMatching(/19% off, above the 15% cap, so it will be blocked/)]);
  });
});
