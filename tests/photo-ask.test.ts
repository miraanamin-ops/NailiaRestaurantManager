// The weekly photo ask (4 Nov): Tuesdays, one dish for Thursday's Google post,
// rotating, favouring dishes with no photo yet and the dishes to push.
import { describe, expect, test } from "vitest";
import { photoAskBriefSection, photoAskDish, photoAskLine } from "@/lib/agents/photo-ask";
import type { Restaurant } from "@/lib/supabase";

const menu = [
  { category: "Grills", items: [{ name: "Lamb Chops" }, { name: "Mixed Grill" }, { name: "Chicken Tikka" }] },
  { category: "Drinks", items: [{ name: "Mango Lassi" }] },
];

describe("which dish", () => {
  test("never drinks or sides; rotates week by week", () => {
    const weeks = ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"].map((today) => photoAskDish({ menu, library: [], today }));
    expect(weeks).not.toContain("Mango Lassi");
    expect(new Set(weeks.slice(0, 3)).size).toBe(3);
    expect(weeks[3]).toBe(weeks[0]);
  });

  test("dishes already in the library are asked for last", () => {
    const library = [{ caption: "Our lamb chops, fresh off the grill" }, { caption: "Mixed grill for two" }];
    for (const today of ["2026-11-03", "2026-11-10"]) expect(photoAskDish({ menu, library, today })).toBe("Chicken Tikka");
  });

  test("the dishes to push come first", () => {
    expect(photoAskDish({ menu, library: [], today: "2026-11-03", prefer: ["mixed grill"] })).toBe("Mixed Grill");
  });

  test("no menu, no ask", () => {
    expect(photoAskDish({ menu: [], library: [], today: "2026-11-03" })).toBeNull();
    expect(photoAskDish({ menu: [{ category: "Drinks", items: [{ name: "Tea" }] }], library: [], today: "2026-11-03" })).toBeNull();
  });
});

describe("the brief's block", () => {
  const restaurant = { id: "r1", menu, photo_library: [] } as unknown as Restaurant;
  test("Tuesdays only", async () => {
    // Tuesday 10 Nov 2026, 9am London.
    expect(await photoAskBriefSection.block({ restaurant, now: new Date("2026-11-10T09:00:00Z") })).toMatch(/^📸 \*Photo for Thursday's Google post:\* could you send me a photo of your /);
    expect(await photoAskBriefSection.block({ restaurant, now: new Date("2026-11-11T09:00:00Z") })).toBeNull();
  });
  test("the wording", () => {
    expect(photoAskLine("Lamb Chops")).toBe("📸 *Photo for Thursday's Google post:* could you send me a photo of your Lamb Chops? Just reply here with it and I'll write the post around it.");
  });
});
