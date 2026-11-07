import "server-only";
import { londonYmd } from "@/lib/clock";
import { savedWeekAhead } from "@/lib/forecast/snapshot";
import { addDays } from "@/lib/sales/format";
import { selectAll } from "@/lib/sales/store";
import { getSupabase } from "@/lib/supabase";
import { busyness, compare, heatmap, salesHeadline, topDishes, type Change } from "./rules";

// The top half of the owner's Sales page: the period's takings against the one
// before, day by day against the forecast, busiest hours, best sellers, next week.
// Numbers only from the restaurant's own sales_days / sales_hours / sales_items.

export type SalesPeriod = "week" | "month";

const nextMonday = (ymd: string) => addDays(ymd, 8 - (((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1));

async function safe<T>(label: string, p: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error(`Sales overview: ${label} failed`, err);
    return fallback;
  }
}

function rows<T>(res: { data: T[] | null; error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

export type SalesOverview = {
  period: SalesPeriod;
  start: string;
  end: string;
  hasData: boolean;
  takings: Change;
  orders: Change | null;
  avgSpend: Change | null;
  headline: string | null;
  days: { day: string; net: number; forecast: number | null; temp: number | null }[];
  heat: ReturnType<typeof heatmap>;
  dishes: { item: string; sold: number; amount: number }[];
  slowDishes: { item: string; sold: number; amount: number }[];
  next: { total: number | null; quiet: { day: string; orders: number } | null };
};

export async function salesOverview(restaurantId: string, now: Date, period: SalesPeriod): Promise<SalesOverview> {
  const supabase = getSupabase();
  const n = period === "week" ? 7 : 28;
  const end = addDays(londonYmd(now), -1); // yesterday: the last whole day
  const start = addDays(end, -(n - 1));
  const priorStart = addDays(start, -n);

  const [days, forecasts, weather, hours, items, ahead] = await Promise.all([
    safe(
      "sales days",
      supabase
        .from("sales_days")
        .select("day, net_sales, transactions")
        .eq("restaurant_id", restaurantId)
        .gte("day", priorStart)
        .lte("day", end)
        .order("day")
        .then(rows<{ day: string; net_sales: number | string; transactions: number | null }>),
      [],
    ),
    safe(
      "forecasts",
      supabase
        .from("forecast_briefs")
        .select("day, sales_likely")
        .eq("restaurant_id", restaurantId)
        .eq("status", "shown")
        .gte("day", start)
        .lte("day", end)
        .then(rows<{ day: string; sales_likely: number | null }>),
      [],
    ),
    safe(
      "weather",
      supabase.from("weather_days").select("day, temp_max").eq("restaurant_id", restaurantId).gte("day", start).lte("day", end).then(rows<{ day: string; temp_max: number | string | null }>),
      [],
    ),
    safe(
      "sales hours",
      selectAll<{ day: string; hour: number; sales: number | string }>((a, b) =>
        supabase.from("sales_hours").select("day, hour, sales").eq("restaurant_id", restaurantId).gte("day", addDays(end, -27)).lte("day", end).range(a, b),
      ),
      [],
    ),
    safe(
      "sales items",
      selectAll<{ item: string; quantity: number | string; amount: number | string }>((a, b) =>
        supabase.from("sales_items").select("item, quantity, amount").eq("restaurant_id", restaurantId).gte("day", start).lte("day", end).range(a, b),
      ),
      [],
    ),
    safe("next week", savedWeekAhead(restaurantId, nextMonday(londonYmd(now)), now), null),
  ]);

  const current = days.filter((d) => d.day >= start);
  const prior = days.filter((d) => d.day < start);
  const net = (ds: typeof days) => ds.reduce((s, d) => s + (Number(d.net_sales) || 0), 0);
  const ord = (ds: typeof days) => ds.reduce((s, d) => s + (d.transactions ?? 0), 0);
  const hasOrders = current.some((d) => d.transactions !== null) && prior.some((d) => d.transactions !== null);
  const fc = new Map(forecasts.map((f) => [f.day, f.sales_likely === null ? null : f.sales_likely / 100]));
  const temps = new Map(weather.map((w) => [w.day, w.temp_max === null ? null : Math.round(Number(w.temp_max))]));
  const byDay = new Map(current.map((d) => [d.day, Number(d.net_sales) || 0]));
  const series = Array.from({ length: n }, (_, i) => {
    const day = addDays(start, i);
    return { day, net: byDay.get(day) ?? 0, forecast: fc.get(day) ?? null, temp: temps.get(day) ?? null };
  });
  const spend = (ds: typeof days) => (ord(ds) ? net(ds) / ord(ds) : 0);
  const dishes = topDishes(
    items.map((i) => ({ item: i.item, quantity: Number(i.quantity), amount: Number(i.amount) })),
    100,
  );
  const quietDay =
    ahead && (ahead.status === "ok" || ahead.status === "held_back")
      ? (ahead.days
          .filter((d) => d.orders !== null && busyness(d.orders, d.normal_orders) === "quiet")
          .sort((a, b) => (a.orders ?? 0) - (b.orders ?? 0))[0] ?? null)
      : null;
  const nextTotal =
    ahead && ahead.status === "ok" && ahead.days.every((d) => d.sales_mid !== null) ? ahead.days.reduce((s, d) => s + (d.sales_mid ?? 0), 0) / 100 : null;

  return {
    period,
    start,
    end,
    hasData: current.length > 0,
    takings: compare(Math.round(net(current)), Math.round(net(prior))),
    orders: hasOrders ? compare(ord(current), ord(prior)) : null,
    avgSpend: hasOrders ? compare(Math.round(spend(current) * 100) / 100, Math.round(spend(prior) * 100) / 100) : null,
    headline: period === "week" ? salesHeadline(series) : null,
    days: series,
    heat: heatmap(
      hours.map((h) => ({ weekday: (new Date(`${h.day}T12:00:00Z`).getUTCDay() + 6) % 7, hour: Number(h.hour), value: Number(h.sales) || 0 })),
    ),
    dishes: dishes.slice(0, 5),
    slowDishes: dishes.length > 8 ? [...dishes].sort((a, b) => a.sold - b.sold).slice(0, 3) : [],
    next: { total: nextTotal, quiet: quietDay ? { day: quietDay.date, orders: quietDay.orders ?? 0 } : null },
  };
}
