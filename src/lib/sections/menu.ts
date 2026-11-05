import "server-only";
import { check } from "@/lib/drafts";
import { menuProfit, menuReportLines, profitFromSales } from "@/lib/menu-engineering";
import { getSupabase } from "@/lib/supabase";
import type { ReportSectionDef } from "./types";

// The Monday report's "Your menu" (menu engineering, lib/menu-engineering.ts):
// which dishes make the most money and which sell, once the owner has given dish
// costs. With the till's sales by item: popularity from the 8 weeks to the end of
// the report's week, and the profit those dishes made, last week against the week before.

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

export const menuReportSection: ReportSectionDef = {
  id: "menu",
  order: 35,
  async build({ restaurant, period }) {
    const costed = menuProfit(restaurant.menu);
    if (!costed.dishes.length) return null;
    const since = ymd(new Date(period.end.getTime() - 56 * 86_400_000));
    const rows = (check(
      await getSupabase().from("sales_items").select("day, item, quantity").eq("restaurant_id", restaurant.id).gte("day", since).lt("day", ymd(period.end)).limit(20000),
    ) ?? []) as { day: string; item: string; quantity: number }[];
    const sum = (from: string, to: string) => {
      const out: Record<string, number> = {};
      for (const r of rows) if (r.day >= from && r.day < to) out[r.item] = (out[r.item] ?? 0) + (Number(r.quantity) || 0);
      return out;
    };
    const profit = menuProfit(restaurant.menu, { sales: sum(since, ymd(period.end)) });
    const week = profitFromSales(profit, sum(ymd(period.start), ymd(period.end)));
    const before = profitFromSales(profit, sum(ymd(period.prevStart), ymd(period.start)));
    return {
      title: "Your menu",
      stats: profit.popularity === "sales" && (week || before) ? [{ label: "Profit from dishes sold (costed dishes, ex VAT)", value: { now: Math.round(week), before: Math.round(before) }, format: "money" }] : [],
      lines: menuReportLines(profit),
      footnote: `From your dish costs${profit.dishes.some((d) => d.estimated) ? " (estimates)" : ""}${profit.popularity === "sales" ? " and your till's sales by item over the last 8 weeks" : profit.popularity === "owner" ? " and your own say on what sells best" : ""}. Profit is per plate, on the price without VAT.`,
    };
  },
  facts: (s) => `Menu: ${s.lines.join(" ")}`,
};
