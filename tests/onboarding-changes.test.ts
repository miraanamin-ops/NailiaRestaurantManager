// Onboarding on WhatsApp (link codes, numbers, replies) and changing details later
// ("change Friday hours to 11pm", "add lamb chops, £14", the settings page), with UNDO.
import { describe, expect, test } from "vitest";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import { planProfileChanges, type ProfileFields } from "@/lib/onboarding/profile-changes";
import { customerSafeMenu, parseHoursText, type MenuCategory } from "@/lib/onboarding/profile-data";
import { findLinkCode, normaliseWhatsApp, parseOnboardingReply, parseRewardReply, showNumber, splitMessage, whatsAppLink } from "@/lib/onboarding/steps";
import { undoPlan } from "@/lib/undo-plan";

describe("linking WhatsApp", () => {
  test("only the pre-filled message counts as a link code, never a word on its own", () => {
    expect(findLinkCode("Link my restaurant: K7Q2MZ")).toBe("K7Q2MZ");
    for (const word of ["STATUS", "THANKS", "K7Q2MZ", "approve all"]) expect(findLinkCode(word)).toBeNull();
  });
  test("UK numbers typed any usual way", () => {
    for (const typed of ["07700 900123", "+44 7700 900123", "0044 7700 900123", "(07700) 900-123"]) {
      expect(normaliseWhatsApp(typed)).toBe("whatsapp:+447700900123");
    }
    expect(normaliseWhatsApp("123")).toBeNull();
    expect(showNumber("whatsapp:+447700900123")).toBe("+44 7700 900123");
  });
  test("the WhatsApp button opens our number with the message ready", () => {
    expect(whatsAppLink("whatsapp:+14155238886", "Link my restaurant: K7Q2MZ")).toBe("https://wa.me/14155238886?text=Link%20my%20restaurant%3A%20K7Q2MZ");
  });
});

describe("replies during onboarding on WhatsApp", () => {
  test("yes / no / skip / done / web / numbers, and anything else is the owner's own words", () => {
    expect(parseOnboardingReply("Yes!").kind).toBe("yes");
    expect(parseOnboardingReply("nope").kind).toBe("no");
    expect(parseOnboardingReply("SKIP").kind).toBe("skip");
    expect(parseOnboardingReply("done").kind).toBe("done");
    expect(parseOnboardingReply("finish").kind).toBe("done");
    expect(parseOnboardingReply("web").kind).toBe("web");
    expect(parseOnboardingReply("Carry on setting up").kind).toBe("help");
    expect(parseOnboardingReply("2")).toEqual({ kind: "pick", n: 2 });
    expect(parseOnboardingReply("Lamb chops are £14")).toEqual({ kind: "text", text: "Lamb chops are £14" });
  });
  test("changing the reward or the cap in one message", () => {
    expect(parseRewardReply("cap 20%")).toEqual({ cap: 20 });
    expect(parseRewardReply("free samosa")).toEqual({ reward: "free samosa" });
    expect(parseRewardReply("mango lassi")).toEqual({ reward: "a mango lassi" });
    expect(parseRewardReply("a free chai, and 20%")).toEqual({ cap: 20, reward: "a free chai" });
  });
  test("long messages split on line breaks, under WhatsApp's limit", () => {
    const text = Array.from({ length: 100 }, (_, i) => `- Dish number ${i}: milk, eggs`).join("\n");
    const parts = splitMessage(text, 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});

const current: ProfileFields = {
  opening_hours: { Friday: "12:00 – 22:00", Saturday: "12:00 – 15:00, 18:00 – 23:00" },
  menu: [{ category: "Grills", items: [{ name: "Chicken Tikka", price: 9.5, description: null, allergens: ["milk"], allergens_confirmed: true }] }],
  signup_reward: "a free chai",
  discount_cap_percent: 15,
  phone: null,
  address: null,
  website: null,
};

describe("changing details by message", () => {
  test("change Friday hours to 11pm: only the closing time changes", () => {
    const plan = planProfileChanges(current, [{ change: "hours", day: "Friday", close: "23:00" }]);
    expect(plan.fields.opening_hours?.Friday).toBe("12:00 – 23:00");
    expect(plan.lines).toEqual(["Friday: 12:00 – 23:00"]);
  });
  test("split hours keep the lunch break; closed and every day work", () => {
    expect(planProfileChanges(current, [{ change: "hours", day: "Sat", close: "23:30" }]).fields.opening_hours?.Saturday).toBe("12:00 – 15:00, 18:00 – 23:30");
    expect(planProfileChanges(current, [{ change: "hours", day: "Sunday", closed: true }]).fields.opening_hours?.Sunday).toBe("Closed");
    const all = planProfileChanges(current, [{ change: "hours", day: "every day", open: "11:00", close: "22:00" }]).fields.opening_hours!;
    expect(Object.keys(all)).toHaveLength(7);
    expect(all.Monday).toBe("11:00 – 22:00");
    expect(all.Saturday).toBe("11:00 – 15:00, 18:00 – 22:00"); // the lunch break stays
  });
  test("a day that wasn't open needs both times; unclear days are asked about, not guessed", () => {
    expect(planProfileChanges(current, [{ change: "hours", day: "Monday", close: "22:00" }]).problems[0]).toMatch(/open and close on Monday/);
    expect(planProfileChanges(current, [{ change: "hours", day: "someday", close: "22:00" }]).problems[0]).toMatch(/which day/);
  });
  test("add lamb chops, £14: a new dish whose allergens aren't confirmed, so customers aren't told any", () => {
    const plan = planProfileChanges(current, [{ change: "add_dish", name: "Lamb Chops", price: 14 }]);
    const dish = plan.fields.menu![0].items[1];
    expect(dish).toMatchObject({ name: "Lamb Chops", price: 14, allergens_confirmed: false });
    expect(customerSafeMenu(plan.fields.menu!)[0].items[1]).not.toHaveProperty("allergens");
    expect(current.menu[0].items).toHaveLength(1); // nothing changed until it's saved
  });
  test("price changes and removals only for dishes that are on the menu", () => {
    expect(planProfileChanges(current, [{ change: "dish_price", name: "chicken tikka", price: 10 }]).lines).toEqual(["Chicken Tikka: now £10.00"]);
    expect(planProfileChanges(current, [{ change: "remove_dish", name: "Samosa" }]).problems[0]).toMatch(/couldn't find "Samosa"/);
  });
  test("reward, cap and contact details; nonsense refused", () => {
    const plan = planProfileChanges(current, [
      { change: "discount_cap", percent: 20 },
      { change: "website", value: "rosecafe.co.uk" },
      { change: "discount_cap", percent: 250 },
    ]);
    expect(plan.fields).toMatchObject({ discount_cap_percent: 20, website: "https://rosecafe.co.uk" });
    expect(plan.problems).toHaveLength(1);
  });
});

describe("the settings page", () => {
  test("hours typed the way people type them", () => {
    expect(parseHoursText("12:00 – 22:00")).toBe("12:00 – 22:00");
    expect(parseHoursText("12-10pm")).toBe("12:00 – 22:00");
    expect(parseHoursText("9am-5pm, 6pm - 11pm")).toBe("09:00 – 17:00, 18:00 – 23:00");
    expect(parseHoursText("closed")).toBe("Closed");
    expect(parseHoursText("whenever")).toBeNull();
  });
  test("editing the menu keeps confirmed allergens only for dishes whose allergens didn't change", () => {
    const saved: MenuCategory[] = current.menu;
    const edited = cleanMenu([{ category: "Grills", items: [{ name: "Chicken Tikka", price: 10 }, { name: "Seekh Kebab", price: 8 }] }], saved);
    expect(edited[0].items[0]).toMatchObject({ price: 10, allergens: ["milk"], allergens_confirmed: true });
    expect(edited[0].items[1]).toMatchObject({ allergens: [], allergens_confirmed: false });
    const changed = cleanMenu([{ category: "Grills", items: [{ name: "Chicken Tikka", price: 10, allergens: ["milk", "mustard"] }] }], saved);
    expect(changed[0].items[0].allergens_confirmed).toBe(false);
    expect(() => cleanMenu([{ category: "x", items: [{ name: "y", price: -1 }] }])).toThrow();
  });
});

describe("UNDO for details", () => {
  test("hours, menu, voice, phone, address and website can be put back", () => {
    for (const field of ["opening_hours", "menu", "brand_voice", "phone", "address", "website"]) {
      expect(undoPlan({ action: "setting", data: { field, before: "old" } }, null, "dummy")).toEqual({ type: "restore_setting", field, value: "old" });
    }
  });
});
