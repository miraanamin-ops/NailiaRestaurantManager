// The app's menu changes now go through dishes (saveMenu). The real app code runs
// against the in-memory database, whose save_menu runs the real SQL in PGlite
// (support/menu-pg.ts). Renames from settings, from a message, and their UNDO
// keep the same dish, so its price history, recipe and till matches stay with it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import type { MenuCategory, Restaurant } from "@/lib/supabase";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const MENU: MenuCategory[] = [
  {
    category: "Grill",
    items: [
      { name: "Chicken Tikka", price: 11, description: "Six pieces", allergens: ["milk"], allergens_confirmed: true },
      { name: "Lamb Chops", price: 14, description: null, allergens: [], allergens_confirmed: false },
    ],
  },
];
const restaurant = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  menu: [],
  opening_hours: {},
  discount_cap_percent: 20,
  signup_reward: null,
  phone: null,
  address: null,
  website: null,
  active: false, // keeps Visibility's "menu changed" job out of these tests
  is_demo: true,
  profile_version: 0,
  created_at: "2026-01-01T00:00:00Z",
});

let db: ReturnType<typeof memoryDb>;
beforeEach(() => {
  vi.resetModules();
  db = memoryDb({ restaurants: [restaurant(A, "Ember"), restaurant(B, "Cardamom")], audit_log: [], profile_versions: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

// A copy, as the app gets from a query (the stand-in's own row changes as the menu is saved).
const row = (id: string) => structuredClone(db.tables.restaurants.find((r) => r.id === id)) as unknown as Restaurant;
const dish = (name: string, rid = A) => db.tables.dishes.find((d) => d.restaurant_id === rid && d.name === name && d.active_to === null);

async function setUp() {
  const { saveMenu } = await import("@/lib/ops/menu");
  await saveMenu(A, MENU, { source: "photo" });
  const tikka = dish("Chicken Tikka")!;
  // History that must stay with the dish: an older price, a recipe, a till match.
  db.tables.dish_prices.push({ id: "cccccccc-0000-0000-0000-00000000000a", restaurant_id: A, dish_id: tikka.id, price_pence: 1000, effective_from: "2025-01-01", recorded_at: "2025-01-01T00:00:00Z", source: "manual", created_at: "2025-01-01T00:00:00Z" });
  db.tables.recipe_versions = [{ id: "rv1", restaurant_id: A, dish_id: tikka.id, effective_from: "2026-01-01" }];
  db.tables.till_item_matches = [{ id: "m1", restaurant_id: A, till_name: "Chkn Tikka", dish_id: tikka.id }];
  return tikka.id as string;
}
const historyOf = (dishId: string) => ({
  prices: db.tables.dish_prices.filter((p) => p.dish_id === dishId).length,
  recipe: db.tables.recipe_versions.filter((r) => r.dish_id === dishId).length,
  till: db.tables.till_item_matches.filter((m) => m.dish_id === dishId).length,
});

describe("the menu copy", () => {
  test("saving makes dishes and the same menu copy readers have always had", async () => {
    await setUp();
    expect(row(A).menu).toEqual(MENU);
    expect(db.tables.dishes.filter((d) => d.restaurant_id === A).map((d) => [d.name, d.source])).toEqual([
      ["Chicken Tikka", "photo"],
      ["Lamb Chops", "photo"],
    ]);
    expect(row(B).menu).toEqual([]);
  });

  test("onboarding's menu step goes through dishes", async () => {
    const { updateRestaurantFields } = await import("@/lib/onboarding/store");
    const saved = await updateRestaurantFields(B, { menu: MENU });
    expect(saved.menu).toEqual(MENU);
    expect(db.tables.dishes.filter((d) => d.restaurant_id === B)).toHaveLength(2);
  });
});

describe("renames keep the same dish", () => {
  test("from settings: the editor sends the dish's id", async () => {
    const tikkaId = await setUp();
    const before = historyOf(tikkaId);
    const { menuWithIds } = await import("@/lib/ops/menu");
    const { cleanMenu } = await import("@/lib/onboarding/menu-input");
    const { saveProfileFields } = await import("@/lib/profile-edits");
    const edited = await menuWithIds(A);
    expect(edited[0].items[0].id).toBe(tikkaId);
    edited[0].items[0].name = "Chicken Tikka Masala";
    await saveProfileFields(row(A), { menu: cleanMenu(edited, await menuWithIds(A)) }, "Changed the menu in settings");
    expect(dish("Chicken Tikka Masala")?.id).toBe(tikkaId);
    expect(historyOf(tikkaId)).toEqual(before);
    expect(db.tables.dishes.filter((d) => d.restaurant_id === A)).toHaveLength(2);
    expect(db.tables.dish_renames.map((r) => [r.old_name, r.new_name])).toEqual([["Chicken Tikka", "Chicken Tikka Masala"]]);
    // Confirmed allergens stay confirmed (the dish didn't change), and no ids reach the copy or the log.
    expect(row(A).menu[0].items[0]).toEqual({ name: "Chicken Tikka Masala", price: 11, description: "Six pieces", allergens: ["milk"], allergens_confirmed: true });
    expect(JSON.stringify(db.tables.audit_log)).not.toContain(tikkaId);
  });

  test("by message, then UNDO puts the old name back on the same dish", async () => {
    const tikkaId = await setUp();
    const before = historyOf(tikkaId);
    const { applyProfileChanges } = await import("@/lib/profile-edits");
    const reply = await applyProfileChanges(row(A), [{ change: "rename_dish", name: "chicken tikka", value: "Chicken Tikka Masala" }]);
    expect(reply).toContain("Renamed Chicken Tikka to Chicken Tikka Masala");
    expect(dish("Chicken Tikka Masala")?.id).toBe(tikkaId);
    expect(db.tables.dish_renames.at(-1)).toMatchObject({ old_name: "Chicken Tikka", new_name: "Chicken Tikka Masala", source: "owner_message" });
    expect(db.tables.audit_log.at(-1)?.data).toMatchObject({ field: "menu", renames: [{ from: "Chicken Tikka", to: "Chicken Tikka Masala" }] });

    const { undoLast } = await import("@/lib/undo");
    const undone = await undoLast(row(A), new Date());
    expect(undone).toMatch(/menu is back/i);
    expect(dish("Chicken Tikka")?.id).toBe(tikkaId);
    expect(row(A).menu).toEqual(MENU);
    expect(historyOf(tikkaId)).toEqual(before);
    expect(db.tables.dishes.filter((d) => d.restaurant_id === A)).toHaveLength(2);
  });

  test("a price change by message is a new price row on the same dish", async () => {
    const tikkaId = await setUp();
    const { applyProfileChanges } = await import("@/lib/profile-edits");
    await applyProfileChanges(row(A), [{ change: "dish_price", name: "Chicken Tikka", price: 12.5 }]);
    expect(dish("Chicken Tikka")?.id).toBe(tikkaId);
    expect(db.tables.dish_prices.filter((p) => p.dish_id === tikkaId).map((p) => p.price_pence).sort()).toEqual([1000, 1100, 1250]);
    expect(row(A).menu[0].items[0].price).toBe(12.5);
  });
});

describe("one restaurant's menu never touches another's", () => {
  test("a dish id from another restaurant is ignored", async () => {
    const tikkaId = await setUp();
    const { saveMenu } = await import("@/lib/ops/menu");
    await saveMenu(B, [{ category: "Mains", items: [{ id: tikkaId, name: "Borrowed", price: 3, description: null }] }]);
    expect(dish("Chicken Tikka")?.id).toBe(tikkaId);
    expect(row(A).menu).toEqual(MENU);
    expect(dish("Borrowed", B)?.id).not.toBe(tikkaId);
  });
});
