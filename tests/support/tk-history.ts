// Test Kitchen-style sales history for tests: the seed's pattern
// (supabase/seed/test-kitchen.sql: Fri and Sat busiest, about £20 net an order,
// a small wobble that's the same every run), as sales_days and sales_hours rows.

export const TK_ORDERS = [62, 58, 66, 78, 118, 132, 96]; // Monday first
const HOURS: [number, number][] = [[12, 6], [13, 8], [14, 4], [15, 2], [16, 2], [17, 5], [18, 10], [19, 13], [20, 12], [21, 8], [22, 4]];

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

// Well mixed (FNV-1a and a final shuffle, like the seed's hashtext), so nearby days aren't alike.
function wobble(key: string, spread: number) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return 1 - spread + ((h >>> 0) / 4294967296) * 2 * spread;
}

// days of history ending the day before `today`. bump: extra multiplier per date (event effects).
export function tkHistory(restaurantId: string, today: string, days: number, bump: Record<string, number> = {}) {
  const salesDays: Record<string, unknown>[] = [];
  const salesHours: Record<string, unknown>[] = [];
  for (let i = days; i >= 1; i--) {
    const day = addDays(today, -i);
    const wd = weekday(day);
    const orders = Math.max(1, Math.round(TK_ORDERS[wd - 1] * wobble(`o${day}`, 0.08) * (bump[day] ?? 1)));
    const netPerOrder = 20 * wobble(`s${day}`, 0.04);
    salesDays.push({ restaurant_id: restaurantId, day, transactions: orders, net_sales: Math.round(orders * netPerOrder * 100) / 100, is_dummy: true, source: "seed" });
    const open = HOURS.filter(([h]) => h < 22 || wd === 5 || wd === 6);
    const total = open.reduce((n, [, w]) => n + w, 0);
    for (const [hour, w] of open) salesHours.push({ restaurant_id: restaurantId, day, hour, transactions: Math.round((orders * w) / total), is_dummy: true });
  }
  return { salesDays, salesHours };
}
