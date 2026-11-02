import "server-only";
import type { MetricsData } from "@/lib/agents/insights-metrics";
import { google } from "@/lib/google";
import { selectAll } from "@/lib/sales/store";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { canCompare, compareToPeers, peerMetrics, pickGroup, type Benchmark } from "./benchmark-rules";
import { monthlyFigures, type MonthlyFigures } from "./monthly-rules";

// "How you compare nearby" for one restaurant's monthly report (rules and privacy:
// benchmark-rules.ts). Reads other restaurants' figures on purpose, one restaurant
// at a time, and only ever returns medians. null: no comparison to show.

const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nextMonthFirst = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

// A restaurant's month from its daily takings only (enough for the comparison).
async function figuresFor(restaurantId: string, month: string): Promise<MonthlyFigures | null> {
  const today = nextMonthFirst(month);
  const days = await selectAll<{ day: string; net_sales: number; transactions: number | null; source: string; net_estimated: boolean; is_dummy: boolean }>((from, to) =>
    getSupabase()
      .from("sales_days")
      .select("day, net_sales, transactions, source, net_estimated, is_dummy")
      .eq("restaurant_id", restaurantId)
      .gte("day", addDays(today, -400))
      .lt("day", today)
      .order("day")
      .range(from, to),
  );
  const data = {
    today,
    sales_days: days.map((d) => ({ day: d.day, net: Number(d.net_sales), gross: null, transactions: d.transactions, source: d.source, net_estimated: d.net_estimated, dummy: d.is_dummy })),
    sales_hours: [],
    sales_items: [],
    weather: [],
    reviews: [],
    signups: [],
    campaigns: [],
    sends: [],
    rewards: [],
    labour_weeks: [],
    labour_target_pct: null,
  } as unknown as MetricsData;
  return monthlyFigures({ data, month, calendar: [] });
}

async function reviewsFor(restaurantId: string) {
  return (await google().listReviews(restaurantId)).map((r) => ({ date: r.review_date, rating: r.rating, replied_at: r.reply_posted_at ?? null }));
}

export async function benchmarkFor(r: Restaurant, month: string, figures: MonthlyFigures): Promise<Benchmark | null> {
  if (r.benchmark_opt_out) return null; // a fair exchange: left out, so no comparison either
  const all = (check(await getSupabase().from("restaurants").select("*").eq("active", true)) ?? []) as Restaurant[];
  const group = pickGroup(r, all.filter((o) => canCompare(r, o)));
  if (!group) return null;
  const peers = [];
  for (const p of group.peers) {
    // One restaurant failing to load never stops the report: it's just left out.
    try {
      peers.push(peerMetrics(await figuresFor(p.id, month), await reviewsFor(p.id), p.google_rating, month));
    } catch (err) {
      console.error("Benchmark: skipped a nearby restaurant", err);
    }
  }
  return compareToPeers(peerMetrics(figures, await reviewsFor(r.id), r.google_rating, month), peers, group.radius);
}
