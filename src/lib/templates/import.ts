import "server-only";
import { applyCosts, menuProfit } from "@/lib/menu-engineering";
import type { MenuCategory } from "@/lib/onboarding/profile-data";
import { saveProfileFields } from "@/lib/profile-edits";
import type { Restaurant } from "@/lib/supabase";
import { readMenuCosts, readStaff } from "./read";
import type { Table } from "@/lib/sales/pos-table";

// Saving one of our sheets once the owner sends it back (settings, WhatsApp, or
// setup with Dina). Plain code, no AI. The daily takings sheet is a sales file:
// the sales importer recognises it (lib/sales/pos-import.ts) and imports it
// straight away, so it isn't handled here.

export type SheetResult = { ok: boolean; message: string };

// The menu costs sheet: costs onto the dishes (by name), and one share of the
// price for the rest ("All other dishes"). Dishes and prices aren't changed here.
export async function saveCostsSheet(restaurant: Restaurant, table: Table | null): Promise<SheetResult> {
  const read = readMenuCosts(table);
  const menu = (restaurant.menu ?? []) as MenuCategory[];
  if (!menu.flatMap((c) => c.items).length) return { ok: false, message: "There's no menu saved yet, so there's nothing to put costs on. Add your menu first." };
  if (!read.costs.length && read.rest_percent === null) return { ok: false, message: `I couldn't use that sheet: ${read.problems.join("; ")}.` };
  const { menu: next, problems, set } = applyCosts(menu, { costs: read.costs, rest_percent: read.rest_percent });
  if (!set) return { ok: false, message: `I couldn't use any of those costs: ${[...read.problems, ...problems].join("; ")}.` };
  await saveProfileFields(restaurant, { menu: next }, "Dish costs from the menu costs sheet");
  const profit = menuProfit(next);
  const best = [...profit.dishes].sort((a, b) => b.margin - a.margin)[0];
  const lines = [
    `✅ Saved costs for ${profit.dishes.length} of ${profit.total} dishes.`,
    best ? `Your most profitable is ${best.name}, at about ${best.margin}% profit.` : "",
    [...read.problems, ...problems].length ? `Not used: ${[...read.problems, ...problems].join("; ")}.` : "",
    profit.uncosted.length ? `Still without a cost: ${profit.uncosted.slice(0, 5).join(", ")}${profit.uncosted.length > 5 ? "…" : ""}.` : "",
  ];
  return { ok: true, message: lines.filter(Boolean).join(" ") };
}

// The team sheet: everyone into the rota's team (people already there by the same
// name are updated, not added twice).
export async function saveTeamSheet(restaurantId: string, table: Table | null): Promise<SheetResult> {
  const read = readStaff(table);
  if (!read.staff.length) return { ok: false, message: `I couldn't use that sheet: ${read.problems.join("; ")}.` };
  const { saveTeamMembers } = await import("@/lib/onboarding/dina/ops-step");
  await saveTeamMembers(restaurantId, read.staff, null);
  return {
    ok: true,
    message: [`✅ Saved ${read.staff.length} ${read.staff.length === 1 ? "person" : "people"} to your team: ${read.staff.map((s) => s.name).join(", ")}.`, read.problems.length ? `Not saved: ${read.problems.join("; ")}.` : ""].filter(Boolean).join(" "),
  };
}
