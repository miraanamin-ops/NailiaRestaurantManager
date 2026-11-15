// How the email designs do (phase 5 of the Inbox and emails plan, 15 Nov 2026): a
// difference is only told to the owner, or acted on, when there's enough data and it's real.
import { describe, expect, test } from "vitest";
import { arm, lookResults, MIN, photoInsight, weakLooks, zScore, type SendRow } from "@/lib/email/design-results-rules";
import { LOOKS, nextLook } from "@/lib/email/designs";

// n emails over `campaigns` campaigns, `clicks` of them clicked.
function rows(n: number, clicks: number, base: Partial<SendRow>, campaigns = 5): SendRow[] {
  return Array.from({ length: n }, (_, i) => ({
    campaign_id: `${base.look ?? "x"}-${base.photo ? "p" : "n"}-${i % campaigns}`,
    family: "discount",
    look: "photo_hero",
    photo: false,
    opened: i % 2 === 0,
    clicked: i < clicks,
    redeemed: i < Math.floor(clicks / 3),
    ...base,
  }));
}

describe("the numbers", () => {
  test("an arm counts emails, campaigns and each action", () => {
    expect(arm(rows(10, 4, {}, 3))).toEqual({ sent: 10, campaigns: 3, opened: 5, clicked: 4, redeemed: 1 });
  });

  test("the z-score: equal rates are 0, a big gap on big numbers is past 1.96", () => {
    expect(zScore(10, 100, 10, 100)).toBe(0);
    expect(zScore(80, 400, 30, 400)).toBeGreaterThan(1.96);
    expect(zScore(3, 20, 1, 20)).toBeLessThan(1.96);
  });

  test("per look, for the builder", () => {
    const out = lookResults([...rows(10, 2, { look: "big_number" }), ...rows(20, 1, { look: "menu_card" })]);
    expect(out.map((l) => [l.look, l.sent, l.clickRate])).toEqual([
      ["big_number", 10, 0.2],
      ["menu_card", 20, 0.05],
    ]);
  });
});

describe("the owner's line about photos", () => {
  test("told only when both sides have enough emails and the difference is real", () => {
    const real = [...rows(400, 80, { photo: true }), ...rows(400, 30, { photo: false })];
    expect(photoInsight(real)).toBe("Emails with a dish photo got 2.7× the clicks (20% against 7.5% without).");
    // Too few emails without a photo.
    expect(photoInsight([...rows(400, 80, { photo: true }), ...rows(MIN.photoSends - 1, 5, { photo: false })])).toBeNull();
    // Too few campaigns with one.
    expect(photoInsight([...rows(400, 80, { photo: true }, 2), ...rows(400, 30, { photo: false })])).toBeNull();
    // A small gap that could be chance.
    expect(photoInsight([...rows(120, 13, { photo: true }), ...rows(120, 11, { photo: false })])).toBeNull();
  });

  test("a smaller real gap is said as a percentage, and either way round", () => {
    expect(photoInsight([...rows(2000, 260, { photo: true }), ...rows(2000, 200, { photo: false })])).toBe("Emails with a dish photo got 30% more clicks (13% against 10% without).");
    expect(photoInsight([...rows(400, 30, { photo: true }), ...rows(400, 80, { photo: false })])).toMatch(/^Emails without a photo got 2\.7× the clicks/);
  });
});

describe("a look that clearly does worse leaves the turns", () => {
  test("only with enough data, a real gap under 70% of the rest, at most one per family", () => {
    const data = [...rows(400, 20, { look: "photo_hero" }), ...rows(400, 60, { look: "big_number" }), ...rows(400, 64, { look: "menu_card" })];
    expect(weakLooks(data, LOOKS)).toEqual(["photo_hero"]);
    // Not enough emails of it yet.
    expect(weakLooks([...rows(MIN.lookSends - 1, 5, { look: "photo_hero" }), ...rows(400, 60, { look: "big_number" })], LOOKS)).toEqual([]);
    // Close to the others: stays.
    expect(weakLooks([...rows(400, 55, { look: "photo_hero" }), ...rows(400, 60, { look: "big_number" })], LOOKS)).toEqual([]);
  });

  test("the turns pass over a skipped look, but never leave a family with none", () => {
    expect(nextLook("discount", null, ["photo_hero"])).toBe("big_number");
    expect(nextLook("discount", "big_number", ["menu_card"])).toBe("photo_hero");
    expect(nextLook("birthday", "birthday", ["birthday"])).toBe("birthday");
  });
});
