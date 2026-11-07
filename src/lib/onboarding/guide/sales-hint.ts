// From the takings already imported (the sales step comes just before): the
// average week, and the quietest and busiest days, offered for the owner to
// confirm (setup, 7 Nov 2026). Pure code plus one read (tests/guide-catalog.test.ts).

export type SalesHint = { weeklyAverage: number | null; quietDays: string[]; busyDays: string[] };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// rows: the last 8 weeks or so of daily net takings (pounds).
export function salesHintFrom(rows: { day: string; net_sales: number | string }[]): SalesHint {
  const days = rows.map((r) => ({ day: r.day, net: Number(r.net_sales) })).filter((r) => Number.isFinite(r.net) && r.net > 0);
  if (days.length < 14) return { weeklyAverage: null, quietDays: [], busyDays: [] };
  const total = days.reduce((s, d) => s + d.net, 0);
  const weeklyAverage = Math.round((total / days.length) * 7);
  const byDay = new Map<string, number[]>();
  for (const d of days) {
    const name = DAYS[new Date(`${d.day}T12:00:00Z`).getUTCDay()];
    byDay.set(name, [...(byDay.get(name) ?? []), d.net]);
  }
  const avg = [...byDay].map(([name, v]) => ({ name, avg: v.reduce((s, x) => s + x, 0) / v.length })).sort((a, b) => a.avg - b.avg);
  return { weeklyAverage, quietDays: avg.slice(0, 2).map((d) => d.name), busyDays: avg.slice(-2).map((d) => d.name).reverse() };
}

// One read of the last 56 days' takings (an error or no table: no hint).
export async function salesHintFor(client: { from: (t: string) => unknown }, restaurantId: string, now = new Date()): Promise<SalesHint | null> {
  try {
    const since = new Date(now.getTime() - 56 * 86_400_000).toISOString().slice(0, 10);
    const q = client.from("sales_days") as { select: (c: string) => { eq: (a: string, b: string) => { gte: (a: string, b: string) => Promise<{ data: { day: string; net_sales: number }[] | null; error: unknown }> } } };
    const { data, error } = await q.select("day, net_sales").eq("restaurant_id", restaurantId).gte("day", since);
    if (error || !data?.length) return null;
    return salesHintFrom(data);
  } catch {
    return null;
  }
}
