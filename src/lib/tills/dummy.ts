// Dummy mode: pretend till orders for a demo restaurant, made from its own
// menu, so the whole sync can be tried without a real till. The same restaurant
// and day always give the same orders. Pure, unit-tested.
import { londonTime, londonWeekday } from "@/lib/clock";
import { addDays } from "./rules";
import type { TillOrder } from "./types";

export type DummyDish = { name: string; price: number };

const FALLBACK: DummyDish[] = [
  { name: "Mixed grill", price: 14.5 },
  { name: "Chicken wrap", price: 7.5 },
  { name: "Lamb chops", price: 14 },
  { name: "Chips", price: 3 },
  { name: "Mango lassi", price: 3.5 },
];

// A small seeded random number generator (mulberry32).
function seeded(text: string) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
  let a = (h = (h << 13) | (h >>> 19));
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Busier at weekends, quiet on Monday.
const ORDERS_BY_WEEKDAY = [38, 18, 22, 24, 30, 46, 52];
const HOURS = [12, 12, 13, 13, 14, 17, 18, 18, 19, 19, 19, 20, 20, 21];

export function dummyOrders(seed: string, dishes: DummyDish[], from: Date, to: Date): TillOrder[] {
  const menu = dishes.filter((d) => d.name && d.price > 0).slice(0, 60);
  const use = menu.length ? menu : FALLBACK;
  const out: TillOrder[] = [];
  const firstDay = from.toISOString().slice(0, 10);
  for (let day = addDays(firstDay, -1); ; day = addDays(day, 1)) {
    const [y, m, d] = day.split("-").map(Number);
    const midnight = londonTime(y, m, d, 0, 0);
    if (midnight >= to) break;
    const rand = seeded(`${seed}:${day}`);
    const count = Math.round(ORDERS_BY_WEEKDAY[londonWeekday(midnight)] * (0.8 + rand() * 0.4));
    for (let n = 0; n < count; n++) {
      const hour = HOURS[Math.floor(rand() * HOURS.length)];
      const closedAt = londonTime(y, m, d, hour, Math.floor(rand() * 60));
      if (closedAt < from || closedAt >= to) {
        rand();
        continue;
      }
      const lineCount = 1 + Math.floor(rand() * 3);
      const lines = Array.from({ length: lineCount }, () => {
        const dish = use[Math.floor(rand() * use.length)];
        const quantity = rand() < 0.2 ? 2 : 1;
        return { item: dish.name, quantity, amount: Math.round(dish.price * quantity * 100) / 100 };
      });
      out.push({ id: `dummy-${day}-${n}`, closedAt, lines, covers: lineCount + (rand() < 0.3 ? 1 : 0) });
    }
  }
  return out.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
}
