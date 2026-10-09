// Unit tests for the weekly report's plain-code parts. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bars, weekTotals } from "../src/lib/report/chart.ts";
import { changeText, direction, formatValue, whatsappLink } from "../src/lib/report/types.ts";

test("comparisons say up, down or the same", () => {
  assert.equal(direction({ now: 18, before: 9 }), "up");
  assert.equal(direction({ now: 2, before: 5 }), "down");
  assert.equal(direction({ now: 4, before: 4 }), "same");
  assert.equal(changeText({ now: 18, before: 9 }), "+9 vs the week before");
  assert.equal(changeText({ now: 2, before: 5 }), "−3 vs the week before");
  assert.equal(changeText({ now: 4, before: 4 }), "same as the week before");
});

test("ratings compare to one decimal place", () => {
  assert.equal(direction({ now: 4.6, before: 4.4 }, "rating"), "up");
  assert.equal(direction({ now: 4.42, before: 4.4 }, "rating"), "same");
  assert.equal(changeText({ now: 4.1, before: 4.4 }, "rating"), "−0.3 vs the week before");
  assert.equal(formatValue(4.6, "rating"), "4.6");
  assert.equal(formatValue(0, "rating"), "–"); // no reviews yet
});

test("charts split 14 days into the week before and last week", () => {
  const daily = { days: Array.from({ length: 14 }, (_, i) => `Day ${i + 1}`), values: [1, 0, 2, 0, 0, 1, 1, 3, 2, 0, 4, 1, 2, 3] };
  assert.deepEqual(weekTotals(daily), { before: 5, now: 15 });
  const b = bars(daily);
  assert.equal(b.length, 14);
  assert.equal(b.filter((x) => x.lastWeek).length, 7);
  assert.ok(b[10].h > b[0].h, "the biggest day has the tallest bar");
  assert.ok(b[1].h > 0, "zero days still show a hairline");
});

test("action buttons open WhatsApp with the message filled in", () => {
  assert.equal(whatsappLink("14155238886", "Tuesday is quiet"), "https://wa.me/14155238886?text=Tuesday%20is%20quiet");
  assert.equal(whatsappLink(null, "anything"), null);
});
