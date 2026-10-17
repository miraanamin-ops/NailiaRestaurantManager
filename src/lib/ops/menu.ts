import "server-only";
import { getSupabase, type MenuCategory } from "@/lib/supabase";
import type { OpsSource } from "./types";

// The menu lives in dishes (menu_sections, dishes, dish_prices; 031_ops_menu.sql).
// restaurants.menu is only a copy made from them, which every reader still uses.
// saveMenu is the one way to change the menu: it works out what changed (new
// dishes, new prices, dishes taken off, renames), keeps each dish's id so its
// price history, recipe and till matches stay with it, and makes the copy again.
// Matching (in the database, save_menu): an item's id (settings), an explicit
// rename, the same name on the menu, a dish that used to have that name (UNDO
// of a rename), a dish with that name taken off before, else a new dish.

export type MenuRename = { from: string; to: string };

export async function saveMenu(
  restaurantId: string,
  menu: MenuCategory[],
  opts: { source?: OpsSource; renames?: MenuRename[] } = {},
): Promise<MenuCategory[]> {
  const { data, error } = await getSupabase().rpc("save_menu", {
    p_restaurant_id: restaurantId,
    p_menu: menu,
    p_source: opts.source ?? "manual",
    p_renames: opts.renames ?? [],
  });
  if (error) throw new Error(`Saving the menu failed: ${error.message}`);
  return (data ?? []) as MenuCategory[];
}

// Changes restaurant columns, with the menu (if among them) going through
// saveMenu. Every code path that used to write restaurants.menu uses this.
export async function updateRestaurantColumns(
  restaurantId: string,
  fields: Record<string, unknown>,
  opts: { source?: OpsSource; renames?: MenuRename[] } = {},
) {
  const { menu, ...rest } = fields;
  if (menu !== undefined) await saveMenu(restaurantId, menu as MenuCategory[], opts);
  if (Object.keys(rest).length) {
    const { error } = await getSupabase().from("restaurants").update(rest).eq("id", restaurantId);
    if (error) throw new Error(error.message);
  }
}

// The menu with each section's and dish's id, for the settings page's editors:
// an edit sent back with the ids keeps the same dishes, even when renamed.
export async function menuWithIds(restaurantId: string): Promise<MenuCategory[]> {
  const { data, error } = await getSupabase().rpc("menu_json", { p_restaurant_id: restaurantId, p_with_ids: true });
  if (error) throw new Error(`Reading the menu failed: ${error.message}`);
  return (data ?? []) as MenuCategory[];
}
