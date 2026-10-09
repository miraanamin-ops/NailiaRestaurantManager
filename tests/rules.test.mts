// Unit tests for the plain-code safety rules. Run with: npm test
import { test } from "vitest";
import assert from "node:assert/strict";
import { formatLondon, isInSendWindow, londonTimeOn, nextWindowStart } from "../src/lib/clock.ts";
import { findDiscounts, overCap } from "../src/lib/discounts.ts";

const at = (iso: string) => new Date(iso);

test("send window uses UK time in summer (BST = UTC+1)", () => {
  assert.equal(isInSendWindow(at("2026-07-01T07:59:00Z"), "09:00", "21:00"), false); // 08:59 UK
  assert.equal(isInSendWindow(at("2026-07-01T08:00:00Z"), "09:00", "21:00"), true); // 09:00 UK
  assert.equal(isInSendWindow(at("2026-07-01T19:59:00Z"), "09:00", "21:00"), true); // 20:59 UK
  assert.equal(isInSendWindow(at("2026-07-01T20:00:00Z"), "09:00", "21:00"), false); // 21:00 UK
});

test("send window uses UK time in winter (GMT = UTC)", () => {
  assert.equal(isInSendWindow(at("2026-12-01T08:59:00Z"), "09:00", "21:00"), false);
  assert.equal(isInSendWindow(at("2026-12-01T09:00:00Z"), "09:00", "21:00"), true);
  assert.equal(isInSendWindow(at("2026-12-01T21:00:00Z"), "09:00", "21:00"), false);
});

test("queued drafts go out at the next 9am UK time", () => {
  // 10pm on 9 Oct (BST) -> 9am on 10 Oct = 08:00 UTC
  assert.equal(nextWindowStart(at("2026-10-09T21:00:00Z"), "09:00").toISOString(), "2026-10-10T08:00:00.000Z");
  // 6am -> 9am the same day
  assert.equal(nextWindowStart(at("2026-10-09T05:00:00Z"), "09:00").toISOString(), "2026-10-09T08:00:00.000Z");
  // Across the clocks going back (25 Oct 2026): 10pm Sat BST -> 9am Sun GMT = 09:00 UTC
  assert.equal(nextWindowStart(at("2026-10-24T21:00:00Z"), "09:00").toISOString(), "2026-10-25T09:00:00.000Z");
});

test("TIME command sets a UK wall-clock time", () => {
  const t = londonTimeOn(at("2026-10-09T12:00:00Z"), "22:00", 0);
  assert.equal(t.toISOString(), "2026-10-09T21:00:00.000Z");
  assert.match(formatLondon(t), /10:00\s?pm/i);
  assert.equal(londonTimeOn(at("2026-10-09T12:00:00Z"), "09:05", 1).toISOString(), "2026-10-10T08:05:00.000Z");
});

test("discount cap catches discounts but not other percentages", () => {
  assert.equal(overCap("Get 25% off all grills this Thursday!", 20)?.percent, 25);
  assert.equal(overCap("Save 30% on the mixed grill", 20)?.percent, 30);
  assert.equal(overCap("A 30 percent discount for students", 20)?.percent, 30);
  assert.equal(overCap("Half price wings tonight", 20)?.percent, 50);
  assert.equal(overCap("Buy one get one free on wraps", 20)?.percent, 50);
  assert.equal(overCap("2 for 1 on lassis", 20)?.percent, 50);
  assert.equal(overCap("Take 20% off your bill", 20), null); // exactly the cap is allowed
  assert.equal(overCap("15% off lamb chops", 20), null);
  assert.equal(overCap("100% halal, 100% delicious", 20), null);
  assert.equal(overCap("Mixed Grill Platter for £18.50", 20), null);
  assert.deepEqual(
    findDiscounts("10% off starters and 40% off desserts").map((d) => d.percent).sort((a, b) => a - b),
    [10, 40],
  );
  assert.equal(overCap("Get 25% off", 30), null); // cap is per restaurant
});
