import { describe, expect, test } from "vitest";
import { parseDeviceCookie, refusalMessage, usedHereByAnother, withEntry } from "@/lib/reward-device-rules";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const SAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAM2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// One welcome reward per person per restaurant (review G1).
describe("a phone remembers the welcome reward it used", () => {
  test("a second sign-up's reward at the same restaurant is refused on that phone", () => {
    const device = parseDeviceCookie(withEntry([], { restaurantId: R1, customerId: SAM }));
    expect(usedHereByAnother(device, R1, SAM2)).toBe(true);
  });

  test("the same person reopening their own reward is fine", () => {
    const device = parseDeviceCookie(withEntry([], { restaurantId: R1, customerId: SAM }));
    expect(usedHereByAnother(device, R1, SAM)).toBe(false);
  });

  test("another restaurant's welcome reward is fine", () => {
    const device = parseDeviceCookie(withEntry([], { restaurantId: R1, customerId: SAM }));
    expect(usedHereByAnother(device, R2, SAM2)).toBe(false);
  });

  test("a junk or tampered cookie is ignored", () => {
    expect(parseDeviceCookie("rubbish")).toEqual([]);
    expect(parseDeviceCookie(`${R1}~not-an-id`)).toEqual([]);
    expect(parseDeviceCookie(undefined)).toEqual([]);
  });

  test("entries add up without repeating", () => {
    let raw = withEntry([], { restaurantId: R1, customerId: SAM });
    raw = withEntry(parseDeviceCookie(raw), { restaurantId: R2, customerId: SAM2 });
    raw = withEntry(parseDeviceCookie(raw), { restaurantId: R1, customerId: SAM });
    expect(parseDeviceCookie(raw)).toEqual([
      { restaurantId: R2, customerId: SAM2 },
      { restaurantId: R1, customerId: SAM },
    ]);
  });

  test("the customer's words are plain, with no dashes", () => {
    expect(refusalMessage("Ember & Spice")).toBe("This phone has already used a welcome reward at Ember & Spice. It's one per person, but you'll still get their offers by email.");
  });
});
