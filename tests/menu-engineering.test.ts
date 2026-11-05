// Menu engineering (5 Nov): profit per dish from the owner's costs (on the price
// without VAT), the four groups (from the till's sales by item, else the owner's
// say), the offer rule (never under the owner's minimum profit), costs onto the
// menu, and costs never reaching customers.
import { describe, expect, test } from "vitest";
import { growthProblems, NO_BASELINE, type GrowthDraftOutput } from "@/lib/agents/growth-rules";
import { moneyAndRisk, moneyAtDraft, type RuleDraft } from "@/lib/checks/money";
import { applyCosts, costFrom, dishesToPush, menuProfit, menuProfitLines, menuReportLines, offerMarginProblem, profitFromSales } from "@/lib/menu-engineering";
import type { StructuredOffer } from "@/lib/offers";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import { customerSafeMenu, type MenuCategory } from "@/lib/onboarding/profile-data";
import { caseContext, loadGrowthCases } from "./agents/support/growth-cases";

const dish = (name: string, price: number, cost?: number, extra: Record<string, unknown> = {}) => ({ name, price, description: null, ...(cost !== undefined ? { cost, cost_estimated: true } : {}), ...extra });
// Prices include VAT: Lamb Chops £14.40 is £12.00 without it, so £9.00 profit (75%).
const menu: MenuCategory[] = [
  { category: "Grills", items: [dish("Lamb Chops", 14.4, 3), dish("Mixed Grill", 18, 7.5), dish("Chicken Wings", 6, 2.5), dish("Paneer Tikka", 9.6, 1), dish("Veg Curry", 7.2, 3.6)] },
  { category: "Drinks", items: [dish("Mango Lassi", 3.6)] },
];
const sales = { "LAMB CHOPS": 40, "Mixed Grill": 30, "Chicken Wings": 50, "Paneer Tikka": 5, "Veg Curry": 5 };

describe("profit per dish and the groups", () => {
  test("profit and margin on the price without VAT; dishes without a cost listed", () => {
    const p = menuProfit(menu);
    expect(p.dishes.find((d) => d.name === "Lamb Chops")).toMatchObject({ profit: 9, margin: 75, popular: null, group: "high_profit", estimated: true });
    expect(p.dishes.find((d) => d.name === "Chicken Wings")).toMatchObject({ profit: 2.5, margin: 50, group: "low_profit" });
    expect(p).toMatchObject({ uncosted: ["Mango Lassi"], total: 6, popularity: "none" });
  });

  test("with the till's sales by item: winners, crowd-pleasers, hidden gems and rethink", () => {
    const p = menuProfit(menu, { sales });
    expect(Object.fromEntries(p.dishes.map((d) => [d.name, d.group]))).toEqual({
      "Lamb Chops": "winner",
      "Mixed Grill": "winner",
      "Chicken Wings": "crowd_pleaser",
      "Paneer Tikka": "hidden_gem",
      "Veg Curry": "rethink",
    });
    expect(p.popularity).toBe("sales");
    expect(dishesToPush(p)).toEqual(["Paneer Tikka", "Lamb Chops", "Mixed Grill"]);
    // 40 x £9 + 30 x £7.50 + 50 x £2.50 + 5 x £7 + 5 x £2.40
    expect(profitFromSales(p, sales)).toBe(757);
  });

  test("with only the owner's say on top and slow sellers", () => {
    const owned = applyCosts(menu, { top: ["Lamb Chops"], slow: ["Paneer Tikka"] }).menu;
    const p = menuProfit(owned);
    expect(p.popularity).toBe("owner");
    expect(Object.fromEntries(p.dishes.map((d) => [d.name, d.group]))).toMatchObject({ "Lamb Chops": "winner", "Paneer Tikka": "hidden_gem", "Mixed Grill": "high_profit", "Chicken Wings": "low_profit" });
  });

  test("in words for Growth and the report", () => {
    const p = menuProfit(menu, { sales });
    expect(menuProfitLines(p, 50)).toBe(
      "Dishes to push (high profit, hidden gems first): Paneer Tikka (88% profit), Lamb Chops (75% profit), Mixed Grill (50% profit).\nLow profit, so never discount: Chicken Wings (50% profit).\nNo offer may leave a dish under 50% profit after the discount (code checks).",
    );
    const lines = menuReportLines(p);
    expect(lines[0]).toMatch(/^⭐ Winners \(sell well, high profit\): Lamb Chops \(75%\), Mixed Grill \(50%\)/);
    expect(lines.some((l) => l.startsWith("💎 Hidden gems") && l.includes("Paneer Tikka"))).toBe(true);
    expect(lines.at(-1)).toBe("1 dish has no cost yet: add them in settings to include them.");
    expect(menuProfitLines(menuProfit([]), 50)).toBeNull();
  });
});

describe("the offer rule: never under the minimum profit", () => {
  const offer = (o: Partial<StructuredOffer>) => ({ type: "percent_off", description: "An offer", items: [], applies_to: null, discount_percent: null, discount_value_gbp: null, ...o });
  test("each kind of offer, against a 50% minimum", () => {
    expect(offerMarginProblem(offer({ discount_percent: 20, applies_to: "Lamb Chops" }), menu, 50)).toBeNull();
    expect(offerMarginProblem(offer({ description: "20% off the Mixed Grill", discount_percent: 20, applies_to: "Mixed Grill" }), menu, 50)).toBe(
      '"20% off the Mixed Grill" leaves Mixed Grill at 38% profit after the discount, under the 50% minimum',
    );
    expect(offerMarginProblem(offer({ type: "money_off", discount_value_gbp: 2, applies_to: "Chicken Wings" }), menu, 50)).toMatch(/Chicken Wings at 25% profit/);
    expect(offerMarginProblem(offer({ type: "two_for_one", applies_to: "Lamb Chops" }), menu, 50)).toBeNull();
    expect(offerMarginProblem(offer({ type: "two_for_one", applies_to: "Mixed Grill" }), menu, 50)).toMatch(/Mixed Grill \(two for the price of one\) at 0% profit/);
    expect(offerMarginProblem(offer({ type: "free_item", applies_to: "Mixed Grill", items: ["Chicken Wings", "Mixed Grill"] }), menu, 50)).toMatch(/Mixed Grill with a free Chicken Wings at 33% profit/);
  });
  test("dishes without a cost aren't checked; the owner's own minimum counts; no setting means 50%", () => {
    expect(offerMarginProblem(offer({ type: "free_item", applies_to: "Mixed Grill", items: ["Mango Lassi"] }), menu, 50)).toBeNull();
    expect(offerMarginProblem(offer({ discount_percent: 50, applies_to: "Mango Lassi" }), menu, 50)).toBeNull();
    expect(offerMarginProblem(offer({ discount_percent: 20, applies_to: "Mixed Grill" }), menu, 30)).toBeNull();
    expect(offerMarginProblem(offer({ discount_percent: 20, applies_to: "Mixed Grill" }), menu, null)).not.toBeNull();
  });

  const structured: StructuredOffer = {
    type: "percent_off", description: "20% off the Mixed Grill", items: ["Mixed Grill"], applies_to: "Mixed Grill", discount_percent: 20, discount_value_gbp: null,
    valid_from: "2026-11-12", valid_to: "2026-11-12", conditions: "Dine-in only",
  };
  const restaurant = { paused: false, discount_cap_percent: 30, send_window_start: "09:00:00", send_window_end: "21:00:00", menu };
  const approved: RuleDraft = { status: "approved", approved_at: "2026-11-05T10:00:00Z", sent_at: null, scheduled_for: null, content: "20% off the Mixed Grill", offer_details: structured };
  const noon = new Date("2026-11-05T12:00:00Z");

  test("the send gate stops it (as too much off), and the draft says so first", () => {
    expect(moneyAndRisk(approved, restaurant, noon, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap", detail: expect.stringMatching(/^"20% off the Mixed Grill" leaves Mixed Grill at 38% profit/) });
    expect(moneyAndRisk(approved, { ...restaurant, min_margin_pct: 30 }, noon, "approve")).toEqual({ outcome: "ok" });
    expect(moneyAtDraft(approved.content, 30, { details: structured, menu })).toEqual([expect.stringMatching(/under the 50% minimum, so it will be blocked if you approve it$/)]);
    // The owner's own sign-up reward is their call.
    expect(moneyAndRisk({ ...approved, offer_details: { ...structured, description: "20% off your first visit" } }, { ...restaurant, signup_reward: "20% off your first visit" }, noon, "approve")).toEqual({ outcome: "ok" });
  });

  test("Growth is told to offer less when its offer would go under", () => {
    const thursday = loadGrowthCases().find((c) => c.file.startsWith("01"))!.case;
    const ctx = caseContext(thursday);
    const costed = [{ category: "Grills", items: [{ name: "Mixed Grill Platter", price: 18.5, cost: 9 }, { name: "Mango Lassi", price: 3.5, cost: 1.5 }] }];
    const draft: GrowthDraftOutput = {
      type: "campaign", channel: "email", name: "Quiet Thursday mango treat", segment: "everyone", audience_size: 18, send_at: "2026-10-14T10:00", template: "offer", photo_id: null,
      content: { subject: "A Thursday treat", headline: "Free Mango Lassi this Thursday", body: "Come in this Thursday from 5pm and get a free Mango Lassi with any Mixed Grill Platter. Dine-in only, one per table.", cta: "Book a table" },
      offer: { type: "free_item", description: "Free Mango Lassi with any Mixed Grill Platter", items: ["Mango Lassi", "Mixed Grill Platter"], applies_to: "Mixed Grill Platter", discount_percent: null, discount_value_gbp: 3.5, valid_from: "2026-10-15T17:00", valid_to: "2026-10-15T21:00", conditions: "Dine-in only, one per table" },
      idea: null, expected_outcome: NO_BASELINE, needs_owner_input: null, sources_used: ["profile:menu", "profile:discount_cap", "segment:everyone"],
    };
    expect(growthProblems(draft, { ...ctx, margin: { menu: costed, min: 50 } }).join(" | ")).toMatch(/at 32% profit after the discount, under the 50% minimum: offer less/);
    expect(growthProblems(draft, ctx).join(" | ")).not.toMatch(/minimum/);
  });
});

describe("the owner's costs onto the menu", () => {
  test("£, %, words; a share of the price for the rest; sellers; problems named, never guessed", () => {
    const bare: MenuCategory[] = menu.map((c) => ({ ...c, items: c.items.map(({ name, price, description }) => ({ name, price, description })) }));
    const out = applyCosts(bare, {
      costs: [
        { dish: "lamb chops", cost: "£3", estimated: false },
        { dish: "Wings", cost: "30%" },
        { dish: "Pizza", cost: "2" },
        { dish: "Mixed Grill", cost: "about 20 quid" },
      ],
      rest_percent: 25,
      top: ["Lamb Chops"],
      slow: ["Veg Curry", "Biryani"],
    });
    const item = (n: string) => out.menu.flatMap((c) => c.items).find((i) => i.name === n)!;
    expect(item("Lamb Chops")).toMatchObject({ cost: 3, cost_estimated: false, seller: "top" });
    expect(item("Chicken Wings")).toMatchObject({ cost: 1.8, cost_estimated: true });
    expect(item("Mixed Grill")).toMatchObject({ cost: 4.5, cost_estimated: true });
    expect(item("Veg Curry")).toMatchObject({ cost: 1.8, seller: "slow" });
    expect(out.set).toBe(6);
    expect(out.problems).toEqual(['"Pizza" isn\'t on the menu', "Mixed Grill costs £20.00 to make but sells for £18.00: is that right?", '"Biryani" isn\'t on the menu']);
    expect(costFrom("3.5", 10)).toBe(3.5);
    expect(costFrom("nothing", 10)).toBeNull();
  });

  test("costs never reach customers (or the agents' menu)", () => {
    const safe = customerSafeMenu(applyCosts(menu, { top: ["Lamb Chops"] }).menu);
    expect(JSON.stringify(safe)).not.toMatch(/cost|seller/);
  });

  test("saving the menu from settings keeps the costs; a cost typed there is exact", () => {
    const saved = applyCosts(menu, { top: ["Lamb Chops"] }).menu;
    const sent = saved.map((c) => ({ category: c.category, items: c.items.map(({ name, price, description }) => ({ name, price, description })) }));
    const kept = cleanMenu(sent, saved).flatMap((c) => c.items);
    expect(kept.find((i) => i.name === "Lamb Chops")).toMatchObject({ cost: 3, cost_estimated: true, seller: "top" });
    sent[0].items[0] = { ...sent[0].items[0], cost: 3.4 } as (typeof sent)[0]["items"][0];
    expect(cleanMenu(sent, saved).flatMap((c) => c.items)[0]).toMatchObject({ cost: 3.4, cost_estimated: false });
  });
});
