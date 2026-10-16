import "server-only";
import { valueOn } from "./history";
import { db, must } from "./db";
import type { DishPriceRow, DishRow, IngredientRow, OpsSource, RecipeLineRow, RecipeVersionRow, StdUnit, TillItemMatchRow, MatchMethod } from "./types";

// Menu detail beyond what the menu copy shows: dishes with their ids and price
// history, ingredients, recipes and till item matches. Changing the menu itself
// goes through saveMenu (./menu.ts).

export async function listDishes(restaurantId: string, opts: { includeOff?: boolean } = {}) {
  let q = db().from("dishes").select("*").eq("restaurant_id", restaurantId).order("position");
  if (!opts.includeOff) q = q.is("active_to", null);
  return must(await q, "dishes") as DishRow[];
}

export async function dishPrices(restaurantId: string, dishId: string) {
  return must(await db().from("dish_prices").select("*").eq("restaurant_id", restaurantId).eq("dish_id", dishId), "dish prices") as DishPriceRow[];
}

// A dish's price in pence on a day, as known at a moment (empty = now).
export async function dishPriceOn(restaurantId: string, dishId: string, day: string, knownAt?: string | Date) {
  return valueOn(await dishPrices(restaurantId, dishId), day, { knownAt })?.price_pence ?? null;
}

export async function addIngredient(restaurantId: string, input: { name: string; unit: StdUnit; category?: string | null; source: OpsSource }) {
  return must(
    await db()
      .from("ingredients")
      .insert({ restaurant_id: restaurantId, name: input.name.trim(), unit: input.unit, category: input.category ?? null, source: input.source })
      .select("*")
      .single(),
    "add ingredient",
  ) as IngredientRow;
}

export async function listIngredients(restaurantId: string) {
  return must(await db().from("ingredients").select("*").eq("restaurant_id", restaurantId).order("name"), "ingredients") as IngredientRow[];
}

// A new recipe version for a dish from a day (the old one stays for history).
export async function saveRecipe(
  restaurantId: string,
  input: { dishId: string; effectiveFrom: string; portions?: number; lines: { ingredientId: string; quantity: number; wastePct?: number }[]; source: OpsSource },
) {
  const version = must(
    await db()
      .from("recipe_versions")
      .insert({ restaurant_id: restaurantId, dish_id: input.dishId, effective_from: input.effectiveFrom, portions: input.portions ?? 1, source: input.source })
      .select("*")
      .single(),
    "save recipe",
  ) as RecipeVersionRow;
  if (input.lines.length) {
    must(
      await db()
        .from("recipe_lines")
        .insert(
          input.lines.map((l, i) => ({
            restaurant_id: restaurantId,
            recipe_version_id: version.id,
            ingredient_id: l.ingredientId,
            quantity: l.quantity,
            waste_pct: l.wastePct ?? 0,
            position: i,
          })),
        ),
      "save recipe lines",
    );
  }
  return version;
}

// The recipe for a dish on a day (as known at a moment), with its lines.
export async function recipeOn(restaurantId: string, dishId: string, day: string, knownAt?: string | Date) {
  const versions = must(await db().from("recipe_versions").select("*").eq("restaurant_id", restaurantId).eq("dish_id", dishId), "recipes") as RecipeVersionRow[];
  const version = valueOn(versions, day, { knownAt });
  if (!version) return null;
  const lines = must(
    await db().from("recipe_lines").select("*").eq("restaurant_id", restaurantId).eq("recipe_version_id", version.id).order("position"),
    "recipe lines",
  ) as RecipeLineRow[];
  return { version, lines };
}

// Till item names to dishes. One row per name the till uses; matching again replaces it.
export async function matchTillItem(
  restaurantId: string,
  input: { tillName: string; dishId: string | null; confidence?: number | null; method: MatchMethod; confirmedBy?: string | null; source?: OpsSource },
) {
  const now = new Date().toISOString();
  return must(
    await db()
      .from("till_item_matches")
      .upsert(
        {
          restaurant_id: restaurantId,
          till_name: input.tillName,
          dish_id: input.dishId,
          is_dish: input.dishId !== null,
          confidence: input.confidence ?? null,
          method: input.method,
          source: input.source ?? (input.method === "owner" ? "manual" : "model"),
          confirmed_at: input.confirmedBy ? now : null,
          confirmed_by: input.confirmedBy ?? null,
          updated_at: now,
        },
        { onConflict: "restaurant_id,till_key" },
      )
      .select("*")
      .single(),
    "match till item",
  ) as TillItemMatchRow;
}

export async function tillMatches(restaurantId: string) {
  return must(await db().from("till_item_matches").select("*").eq("restaurant_id", restaurantId), "till matches") as TillItemMatchRow[];
}
