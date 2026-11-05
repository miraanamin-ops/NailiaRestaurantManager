// The sync rules: which days each run reads, and how orders become the same
// sale lines a POS file gives (sales_items). Pure, unit-tested (tests/tills.test.ts).
import { londonParts, londonTime, londonYmd } from "@/lib/clock";
import type { TillOrder, TillProvider } from "./types";

// A new connection reads this far back (forecasts and menu engineering want
// history); each run reads at most MAX_DAYS_PER_RUN days, so a backfill is a
// few runs, each well inside a job's time limit.
export const BACKFILL_DAYS = 90;
export const MAX_DAYS_PER_RUN = 31;
// Every run reads the last two days again: orders closed late, refunds and
// edits made the next morning are picked up.
export const REREAD_DAYS = 2;

const DAY = 86_400_000;
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return londonTime(y, m, d, 0, 0);
};

export type SyncWindow = {
  from: Date; // London midnight at the start of the first day
  to: Date; // now, or London midnight after the last day (a backfill still going)
  days: string[]; // every London day in the window: their till lines are replaced
  caughtUp: boolean; // false: there's more history to read next run
};

export function syncWindow(syncedThrough: Date | null, now: Date): SyncWindow {
  const today = londonYmd(now);
  const first = syncedThrough ? addDays(londonYmd(syncedThrough), -REREAD_DAYS) : addDays(today, -BACKFILL_DAYS);
  const start = first > today ? today : first;
  const days: string[] = [];
  for (let d = start; d <= today && days.length < MAX_DAYS_PER_RUN; d = addDays(d, 1)) days.push(d);
  const last = days.at(-1)!;
  const caughtUp = last === today;
  return { from: dayStart(start), to: caughtUp ? now : dayStart(addDays(last, 1)), days, caughtUp };
}

export type TillRow = {
  day: string;
  hour: number;
  item: string;
  quantity: number;
  amount: number;
  receipt: string;
  row_key: string;
};

// The sale lines of the orders closed inside the window. row_key is stable for
// an order's line, so reading a day again replaces it instead of adding it twice.
export function tillRows(provider: TillProvider, connectionId: string, orders: TillOrder[], window: Pick<SyncWindow, "from" | "to">): TillRow[] {
  const rows: TillRow[] = [];
  const seen = new Set<string>();
  for (const o of orders) {
    if (o.closedAt < window.from || o.closedAt >= window.to) continue;
    if (seen.has(o.id)) continue; // the same order on two pages
    seen.add(o.id);
    const day = londonYmd(o.closedAt);
    const hour = londonParts(o.closedAt).hour;
    o.lines.forEach((l, i) => {
      if (!l.item) return;
      rows.push({ day, hour, item: l.item.slice(0, 200), quantity: l.quantity, amount: l.amount, receipt: o.id.slice(0, 120), row_key: `till:${provider}:${connectionId.slice(0, 8)}:${o.id}:${i}`.slice(0, 250) });
    });
  }
  return rows;
}

// Guests per day, where the till records them.
export function coversByDay(orders: TillOrder[], window: Pick<SyncWindow, "from" | "to">) {
  const out = new Map<string, number>();
  for (const o of orders) {
    if (o.covers == null || o.closedAt < window.from || o.closedAt >= window.to) continue;
    const day = londonYmd(o.closedAt);
    out.set(day, (out.get(day) ?? 0) + o.covers);
  }
  return out;
}

// What the settings page says about the last sync.
export function syncStatusLine(c: { status: string; last_synced_at: string | null; last_error: string | null; synced_through: string | null }, now: Date) {
  if (c.status === "needs_reconnect") return "⚠️ The till stopped accepting our login. Please connect it again.";
  if (c.last_error) return `⚠️ The last sync didn't work (${c.last_error.slice(0, 120)}). It tries again every hour.`;
  if (!c.last_synced_at) return "Waiting for the first sync (within the hour).";
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(c.last_synced_at)) / 60_000));
  const ago = mins < 2 ? "just now" : mins < 120 ? `${mins} minutes ago` : `${Math.round(mins / 60)} hours ago`;
  const behind = c.synced_through && londonYmd(new Date(c.synced_through)) < londonYmd(now) ? " Still reading your history: this takes a few hours." : "";
  return `✅ Last synced ${ago}.${behind}`;
}
