// Onboarding's plain-code parts: the steps, link codes, Google hours, menu edits,
// hiding unconfirmed allergens, the reward suggestion and website safety.
import { describe, expect, test } from "vitest";
import { suggestReward } from "@/lib/onboarding/ai";
import {
  addOrUpdateItem,
  customerSafeMenu,
  dayFrom,
  hoursFromGoogle,
  parsePrice,
  removeItem,
  setDayHours,
  to24h,
  type MenuCategory,
} from "@/lib/onboarding/profile-data";
import { canFinish, findLinkCode, linkMessage, mark, newLinkCode, nextStep, slugFor, STEPS, stepsDone } from "@/lib/onboarding/steps";
import { isPublicWebAddress, textFromHtml } from "@/lib/onboarding/website";

describe("the steps", () => {
  test("go in order, and skipped counts as dealt with", () => {
    let p = {};
    expect(nextStep(p)).toBe("google");
    p = mark(p, "google", "skipped");
    expect(nextStep(p)).toBe("menu");
    for (const s of STEPS) p = mark(p, s, "done");
    expect(nextStep(p)).toBeNull();
    expect(stepsDone(p)).toBe(6);
  });
  test("finishing needs WhatsApp linked, and every step done or skipped", () => {
    let p = {};
    for (const s of STEPS.filter((x) => x !== "finish")) p = mark(p, s, "skipped");
    expect(canFinish(p, false)).toBe(false);
    expect(canFinish(p, true)).toBe(true);
    expect(canFinish(mark({}, "google", "done"), true)).toBe(false);
  });
});

describe("WhatsApp link codes", () => {
  test("are 6 easy-to-read characters, found in the pre-filled message", () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(findLinkCode(linkMessage(code))).toBe(code);
    expect(findLinkCode(`link my restaurant: ${code.toLowerCase()}`)).toBe(code);
    expect(findLinkCode("Hello there")).toBeNull();
  });
  test("new restaurants get a tidy web address", () => {
    expect(slugFor("Rose & Thyme Café")).toBe("rose-and-thyme-cafe");
    expect(slugFor("!!!")).toBe("restaurant");
  });
});

describe("opening hours from Google", () => {
  test("12-hour times become 24-hour, closed days stay closed", () => {
    expect(to24h("9:00 AM")).toBe("09:00");
    expect(to24h("11:30 PM")).toBe("23:30");
    expect(to24h("12:00 AM")).toBe("00:00");
    const h = hoursFromGoogle([
      "Monday: 9:00 AM – 5:00 PM",
      "Tuesday: 9:00 AM – 11:00 PM",
      // Google leaves AM/PM off the opening time when it's the same as the closing time.
      "Wednesday: 12:00 – 3:00 PM, 6:00 – 11:00 PM",
      "Sunday: Closed",
    ]);
    expect(h).toEqual({ Monday: "09:00 – 17:00", Tuesday: "09:00 – 23:00", Wednesday: "12:00 – 15:00, 18:00 – 23:00", Sunday: "Closed" });
  });
  test("changing one day's hours", () => {
    expect(setDayHours({ Friday: "12:00 – 22:00" }, "Friday", { open: "12:00", close: "23:00" })).toEqual({ Friday: "12:00 – 23:00" });
    expect(dayFrom("fri")).toBe("Friday");
  });
});

describe("menu changes", () => {
  const menu: MenuCategory[] = [{ category: "Grills", items: [{ name: "Chicken Tikka", price: 9.5, description: null, allergens: ["milk"], allergens_confirmed: true }] }];
  test("add a dish, change a price, remove a dish", () => {
    const added = addOrUpdateItem(menu, { name: "Lamb Chops", price: 14 });
    expect(added[0].items.map((i) => i.name)).toEqual(["Chicken Tikka", "Lamb Chops"]);
    expect(added[0].items[1].allergens_confirmed).toBe(false); // a new dish's allergens are unknown
    expect(addOrUpdateItem(added, { name: "lamb chops", price: 15 })[0].items[1].price).toBe(15);
    expect(removeItem(added, "Chicken tikka")[0].items.map((i) => i.name)).toEqual(["Lamb Chops"]);
    expect(menu[0].items).toHaveLength(1); // the original isn't changed
  });
  test("prices from what the owner types", () => {
    expect(parsePrice("£14")).toBe(14);
    expect(parsePrice("7.95")).toBe(7.95);
    expect(parsePrice("no price")).toBeNull();
  });
  test("customers (and Claude writing for them) only ever see confirmed allergens", () => {
    const m: MenuCategory[] = [
      {
        category: "Cakes",
        items: [
          { name: "Pistachio Cake", price: 4.5, description: null, allergens: ["tree nuts", "eggs"], allergens_confirmed: false },
          { name: "Brownie", price: 3.5, description: null, allergens: ["eggs", "milk"], allergens_confirmed: true },
        ],
      },
    ];
    const safe = customerSafeMenu(m);
    expect(safe[0].items[0]).not.toHaveProperty("allergens");
    expect(safe[0].items[1]).toMatchObject({ allergens: ["eggs", "milk"] });
    expect(JSON.stringify(safe)).not.toContain("allergens_confirmed");
  });
});

describe("defaults and safety", () => {
  test("the sign-up reward suggestion is a cheap drink or treat from the menu", () => {
    expect(suggestReward([{ category: "Drinks", items: [{ name: "Cardamom Latte", price: 3.85, description: null }, { name: "Karak Chai", price: 2.95, description: null }] }])).toBe("a free Karak Chai");
    expect(suggestReward([])).toBe("a free drink on your next visit");
  });
  test("website reading only goes to ordinary public websites", () => {
    expect(isPublicWebAddress(new URL("https://www.example-cafe.co.uk"))).toBe(true);
    for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.10", "http://10.0.0.5", "http://169.254.169.254/latest", "ftp://example.com", "http://intranet"]) {
      expect(isPublicWebAddress(new URL(bad))).toBe(false);
    }
  });
  test("website text has no scripts or markup", () => {
    expect(textFromHtml("<html><script>evil()</script><h1>Rose &amp; Thyme</h1><p>Fresh&nbsp;bakes</p></html>")).toBe("Rose & Thyme Fresh bakes");
  });
});
