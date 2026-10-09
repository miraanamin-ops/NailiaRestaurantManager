// Unit tests for reading the owner's WhatsApp messages, and the shared helpers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAction, parseButtonPayload, parseCommand, parseTargetedAction } from "../src/lib/bot/parse.ts";
import { londonLongDate, londonWeekday, londonYmd, startOfLondonDay } from "../src/lib/clock.ts";
import { clip, plural, shorten } from "../src/lib/text.ts";

const ID = "87662f7a-3c7e-43de-ab69-331cdd15e767";
const FRIDAY = 5;

test("brief buttons and typed item numbers target one draft", () => {
  assert.deepEqual(parseButtonPayload(`approve:${ID}`), { action: "approve", draftId: ID });
  assert.equal(parseButtonPayload("approve"), null); // the plain on-screen button
  assert.equal(parseButtonPayload("approve:not-an-id"), null);
  assert.deepEqual(parseTargetedAction(`skip:${ID}`, "Skip"), { action: "skip", draftId: ID });
  assert.deepEqual(parseTargetedAction(undefined, "APPROVE 2"), { action: "approve", briefNumber: 2 });
  assert.deepEqual(parseTargetedAction(undefined, "edit #3"), { action: "edit", briefNumber: 3 });
  assert.equal(parseTargetedAction(undefined, "approve"), null);
  assert.equal(parseTargetedAction(undefined, "approve all"), null);
});

test("on-screen decisions: buttons, 1/2/3 and words", () => {
  assert.equal(parseAction("approve", "Approve"), "approve");
  assert.equal(parseAction(undefined, "1"), "approve");
  assert.equal(parseAction(undefined, "Edit."), "edit");
  assert.equal(parseAction(undefined, "3"), "skip");
  assert.equal(parseAction(undefined, "approve it please"), null); // that's chat
});

test("commands are exact; everything else is chat", () => {
  assert.deepEqual(parseCommand("approve all", FRIDAY), { name: "approve_all" });
  assert.deepEqual(parseCommand("Run Brief", FRIDAY), { name: "run_brief" });
  assert.deepEqual(parseCommand("weekly", FRIDAY), { name: "run_report" });
  assert.deepEqual(parseCommand("NEW REVIEW 2 stars", FRIDAY), { name: "new_review", rating: 2 });
  assert.deepEqual(parseCommand("cap 25%", FRIDAY), { name: "cap", percent: 25 });
  assert.equal(parseCommand("cap 250", FRIDAY), null);
  assert.deepEqual(parseCommand("set sign-up reward to a free mango lassi!", FRIDAY), { name: "set_reward", reward: "a free mango lassi" });
  assert.deepEqual(parseCommand("my email is Owner@Example.com", FRIDAY), { name: "my_email", email: "owner@example.com" });
  assert.equal(parseCommand("Thursday is quiet", FRIDAY), null);
  assert.deepEqual(parseCommand("campaign results", FRIDAY), { name: "campaign_results" });
  assert.deepEqual(parseCommand("REPORT", FRIDAY), { name: "which_report" });
});

test("TIME picks the next matching day", () => {
  assert.deepEqual(parseCommand("TIME 22:00", FRIDAY), { name: "time", hhmm: "22:00", plusDays: 0 });
  assert.deepEqual(parseCommand("time tomorrow 9.05", FRIDAY), { name: "time", hhmm: "9:05", plusDays: 1 });
  assert.deepEqual(parseCommand("TIME THURSDAY 18:00", FRIDAY), { name: "time", hhmm: "18:00", plusDays: 6 });
  assert.deepEqual(parseCommand("TIME FRIDAY 18:00", FRIDAY), { name: "time", hhmm: "18:00", plusDays: 0 });
  assert.equal(parseCommand("TIME 25:00", FRIDAY), null);
  assert.deepEqual(parseCommand("time off", FRIDAY), { name: "time_off" });
});

test("London dates (one helper per format)", () => {
  const lateFridayUk = new Date("2026-10-09T23:30:00Z"); // 00:30 on Saturday in London (BST)
  assert.equal(londonYmd(lateFridayUk), "2026-10-10");
  assert.equal(londonWeekday(lateFridayUk), 6);
  assert.equal(londonLongDate(lateFridayUk), "Saturday, 10 October 2026");
  assert.equal(startOfLondonDay(lateFridayUk).toISOString(), "2026-10-09T23:00:00.000Z");
  assert.equal(startOfLondonDay(new Date("2026-12-01T12:00:00Z")).toISOString(), "2026-12-01T00:00:00.000Z"); // GMT
});

test("text helpers", () => {
  assert.equal(plural(1, "review"), "1 review");
  assert.equal(plural(2, "reply", "replies"), "2 replies");
  assert.equal(clip("abcdef", 4), "abc…");
  assert.equal(clip("abc", 4), "abc");
  assert.equal(shorten("Warm kunafa with pistachio and cream", 20), "Warm kunafa with…");
  assert.equal(shorten("Two\n\nlines", 20), "Two lines");
});
