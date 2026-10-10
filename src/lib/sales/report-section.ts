// The weekly report's Sales section, from daily totals and item sales. Plain
// code (tests/sales.test.ts); lib/report/build.ts loads the rows.
import type { SalesSection } from "@/lib/report/types";
import { addDays, dayLabel, round2 } from "./format";

export type SalesDayRow = { day: string; net_sales: number; transactions: number | null; net_estimated: boolean; is_dummy: boolean };
export type SalesItemRow = { item: string; quantity: number; amount: number };

// weekStart: the first day of "last week" ("YYYY-MM-DD", London). The week
// before is the 7 days before it; "last month" is the same week 4 weeks earlier.
// Returns null when there's no sales data in the fortnight (the section is left out).
export function buildSalesSection(weekStart: string, days: SalesDayRow[], items: SalesItemRow[]): SalesSection | null {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const range = (from: string) => Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const now = range(weekStart);
  const before = range(addDays(weekStart, -7));
  const month = range(addDays(weekStart, -28));
  const rows = (list: string[]) => list.map((d) => byDay.get(d)).filter((d): d is SalesDayRow => Boolean(d));
  const [rNow, rBefore, rMonth] = [rows(now), rows(before), rows(month)];
  if (!rNow.length && !rBefore.length) return null;

  const sum = (list: SalesDayRow[]) => round2(list.reduce((s, d) => s + Number(d.net_sales), 0));
  const sales = (list: SalesDayRow[]) => {
    const known = list.filter((d) => d.transactions !== null);
    return known.length ? { count: known.reduce((s, d) => s + (d.transactions ?? 0), 0), net: sum(known) } : null;
  };
  const [tNow, tBefore] = [sales(rNow), sales(rBefore)];
  const avg = (t: { count: number; net: number } | null) => (t && t.count ? round2(t.net / t.count) : 0);

  const fortnight = [...before, ...now];
  const year = Number(weekStart.slice(0, 4));
  const sorted = [...rNow].sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
  const label = (d: SalesDayRow) => dayLabel(d.day, year);

  const top = new Map<string, { name: string; quantity: number; amount: number }>();
  for (const i of items) {
    const key = i.item.trim().toLowerCase();
    const t = top.get(key) ?? { name: i.item.trim(), quantity: 0, amount: 0 };
    t.quantity += Number(i.quantity);
    t.amount += Number(i.amount);
    top.set(key, t);
  }

  return {
    id: "sales",
    net: { now: sum(rNow), before: sum(rBefore) },
    // Only compare with a month ago if that week is (nearly) complete.
    lastMonth: rMonth.length >= 6 ? sum(rMonth) : null,
    daily: {
      days: fortnight.map((d) => dayLabel(d, year).replace(/ \w+$/, "")), // "Mon 28"
      values: fortnight.map((d) => Math.round(Number(byDay.get(d)?.net_sales ?? 0))),
    },
    daysWithData: { now: rNow.length, before: rBefore.length },
    transactions: tNow || tBefore ? { now: tNow?.count ?? 0, before: tBefore?.count ?? 0 } : null,
    avgSpend: tNow && tNow.count ? { now: avg(tNow), before: avg(tBefore) } : null,
    best: sorted.length >= 2 ? { day: label(sorted[0]), amount: round2(Number(sorted[0].net_sales)) } : null,
    worst: sorted.length >= 2 ? { day: label(sorted.at(-1)!), amount: round2(Number(sorted.at(-1)!.net_sales)) } : null,
    topItems: [...top.values()]
      .filter((t) => t.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((t) => ({ name: t.name, quantity: round2(t.quantity), amount: round2(t.amount) })),
    netEstimated: [...rNow, ...rBefore].some((d) => d.net_estimated),
    dummy: [...rNow, ...rBefore].some((d) => d.is_dummy),
  };
}

// The section's numbers in a few lines, for the AI that writes the summary and actions.
export function salesFacts(s: SalesSection) {
  const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "n/a");
  const parts = [
    `Net sales £${Math.round(s.net.now)} (week before £${Math.round(s.net.before)}, ${pct(s.net.now, s.net.before)}), from ${s.daysWithData.now} of 7 days with figures.`,
  ];
  if (s.lastMonth !== null) parts.push(`Same week last month: £${Math.round(s.lastMonth)} (${pct(s.net.now, s.lastMonth)}).`);
  if (s.avgSpend) parts.push(`Average net spend per sale £${s.avgSpend.now.toFixed(2)} (before £${s.avgSpend.before.toFixed(2)}).`);
  if (s.best && s.worst) parts.push(`Best day ${s.best.day} (£${Math.round(s.best.amount)}), quietest day ${s.worst.day} (£${Math.round(s.worst.amount)}).`);
  if (s.topItems.length) parts.push(`Top sellers: ${s.topItems.map((t) => `${t.name} (${t.quantity} sold)`).join(", ")}.`);
  return parts.join(" ");
}
