import "server-only";
import { applyCosts, menuProfit, type CostInput } from "@/lib/menu-engineering";
import { saveProfileFields } from "@/lib/profile-edits";
import { patchStepData } from "../sessions";
import { getRestaurant } from "../store";
import type { MenuCategory } from "../profile-data";

// Menu engineering at setup (menu step, after the allergens): what each dish costs
// to make, an estimate being fine, and which dishes sell best and least (the
// owner's say, used until the till's sales by item arrive). Dina's save_menu_costs
// tool calls this; code checks every cost (lib/menu-engineering.ts applyCosts).

export async function saveMenuCosts(restaurantId: string, input: { costs: CostInput[]; rest_percent: number | null; top_sellers: string[]; slow_sellers: string[] }) {
  const r = await getRestaurant(restaurantId);
  const menu = (r.menu ?? []) as MenuCategory[];
  if (!menu.flatMap((c) => c.items).length) return { ok: false as const, text: "There's no menu saved yet, so there's nothing to cost. Carry on with the step." };
  const { menu: next, problems, set } = applyCosts(menu, { costs: input.costs, rest_percent: input.rest_percent, top: input.top_sellers, slow: input.slow_sellers });
  if (!set && !input.top_sellers.length && !input.slow_sellers.length)
    return { ok: false as const, text: `Not saved: ${problems.join("; ") || "no costs were given"}. Ask the owner about exactly that.` };
  await saveProfileFields(r, { menu: next }, "Dish costs, with Dina at setup");
  const profit = menuProfit(next);
  const without = profit.uncosted.length;
  await patchStepData(restaurantId, "menu", { costs: { costed: profit.dishes.length, total: profit.total } }).catch(() => {});
  const best = [...profit.dishes].sort((a, b) => b.margin - a.margin)[0];
  return {
    ok: true as const,
    text: [
      `Saved: costs for ${profit.dishes.length} of ${profit.total} dishes${without ? ` (${without} still without one: ${profit.uncosted.slice(0, 5).join(", ")}${without > 5 ? "…" : ""})` : ""}.`,
      best ? `The most profitable is ${best.name}, at about ${best.margin}% profit.` : "",
      problems.length ? `Not used: ${problems.join("; ")}. Ask about those, one at a time.` : "",
      "Costs are private: they're never shown to customers.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
