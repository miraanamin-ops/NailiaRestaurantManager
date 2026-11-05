import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { enqueueBackfill } from "@/lib/feeds/backfill";
import { historicImport } from "@/lib/feeds/config";
import { dayTotals } from "@/lib/sales/pos-table";
import { saveDaysFromPos, selectAll } from "@/lib/sales/store";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { environmentOf } from "@/lib/switches";
import { testToolsOn } from "@/lib/test-mode";
import { eposNowOrders, lightspeedOrders, lightspeedRefresh, squareOrders, squareRefresh, toastOrders } from "./clients";
import { dummyOrders } from "./dummy";
import { PROVIDERS } from "./providers";
import { coversByDay, syncWindow, tillRows, type SyncWindow } from "./rules";
import { credentialsOf, setTillCredentials, tillFor, updateTill } from "./store";
import { TillAuthError, type TillConnection, type TillOrder } from "./types";

// The till sync: reads the orders closed since the last run (plus the last two
// days again) and saves their lines as the restaurant's item sales, exactly
// like an imported POS file, so forecasts, menu engineering, the brief and the
// reports use them with no changes. A day the till has orders for replaces
// what a file (or dummy data) said for that day; a day it has none for (e.g.
// before the restaurant used this till) is left alone.

// Dummy tills: only for a demo restaurant with test tools on, never on the live site.
export function dummyTillAllowed(r: Pick<Restaurant, "is_demo" | "owner_whatsapp">) {
  return environmentOf(process.env) !== "production" && testToolsOn(r);
}

export type SyncResult =
  | { status: "skipped"; reason: string }
  | { status: "synced"; provider: string; days: number; lines: number; orders: number; caughtUp: boolean; through: string };

// An OAuth token that runs out within 5 minutes is refreshed (and saved) first.
async function accessToken(c: TillConnection) {
  const creds = credentialsOf(c);
  if (creds?.kind !== "oauth") throw new TillAuthError("No till login is stored");
  const soon = creds.expires_at ? Date.parse(creds.expires_at) < Date.now() + 5 * 60_000 : false;
  if (!soon || !creds.refresh_token) return creds.access_token;
  const fresh = c.provider === "square" ? await squareRefresh(creds.refresh_token) : await lightspeedRefresh(creds.refresh_token);
  await setTillCredentials(c, { kind: "oauth", access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? creds.refresh_token, expires_at: fresh.expires_at });
  return fresh.access_token;
}

async function fetchOrders(c: TillConnection, r: Restaurant, w: SyncWindow): Promise<TillOrder[]> {
  if (c.mode === "dummy") {
    if (!dummyTillAllowed(r)) throw new Error("Dummy tills only work for demo restaurants with test tools on, away from the live site");
    const dishes = (r.menu ?? []).flatMap((s) => s.items.map((i) => ({ name: i.name, price: Number(i.price) || 0 })));
    return dummyOrders(r.id, dishes, w.from, w.to);
  }
  switch (c.provider) {
    case "square":
      return squareOrders(await accessToken(c), c.external_location!, w.from, w.to);
    case "lightspeed":
      return lightspeedOrders(await accessToken(c), c.external_location!, w.from, w.to);
    case "eposnow": {
      const creds = credentialsOf(c);
      if (creds?.kind !== "api_key") throw new TillAuthError("No Epos Now API key is stored");
      return eposNowOrders(creds, w.from, w.to);
    }
    case "toast":
      return toastOrders(c.external_account!, w.days);
  }
}

// What still has to be chosen before a connection can sync.
export function notReady(c: TillConnection) {
  if (c.mode === "dummy") return null;
  if ((c.provider === "square" || c.provider === "lightspeed") && !c.external_location) return "pick which location to read on the settings page";
  if (c.provider === "toast" && !c.external_account) return "DinerAI still has to link the Toast restaurant";
  return null;
}

export async function syncTill(restaurant: Restaurant, now = new Date()): Promise<SyncResult> {
  const c = await tillFor(restaurant.id);
  if (!c) return { status: "skipped", reason: "no till connected" };
  if (c.status !== "ok") return { status: "skipped", reason: `till ${c.status}` };
  const waiting = notReady(c);
  if (waiting) return { status: "skipped", reason: waiting };

  const firstRun = !c.synced_through;
  const w = syncWindow(c.synced_through ? new Date(c.synced_through) : null, now);
  let orders: TillOrder[];
  try {
    orders = await fetchOrders(c, restaurant, w);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof TillAuthError) {
      await updateTill(restaurant.id, c.id, { status: "needs_reconnect", last_error: message.slice(0, 500), last_error_at: now.toISOString() });
      await alertBuilder(`till-reconnect:${c.id}`, `${restaurant.name}: ${PROVIDERS[c.provider].name} stopped accepting our login (${message}). The owner needs to connect it again on their settings page.`.slice(0, 500));
      return { status: "skipped", reason: "the till refused our login: needs connecting again" };
    }
    await updateTill(restaurant.id, c.id, { last_error: message.slice(0, 500), last_error_at: now.toISOString() });
    throw err;
  }

  const rows = tillRows(c.provider, c.id, orders, w);
  const covers = coversByDay(orders, w);
  const tillDays = new Set(rows.map((r) => r.day));
  await saveRows(restaurant.id, c, w, rows, tillDays, covers);

  // Older sales than before: the forecast's outside data (weather, prayer times...) is filled in for them.
  const first = rows.map((r) => r.day).sort()[0];
  if (firstRun && first && historicImport(first, londonYmd(now))) {
    try {
      await enqueueBackfill(restaurant.id, "pos_import");
    } catch (err) {
      console.error("Couldn't queue the outside data backfill", err);
    }
  }

  await updateTill(restaurant.id, c.id, { synced_through: w.to.toISOString(), last_synced_at: now.toISOString(), last_error: null, last_error_at: null });
  return { status: "synced", provider: c.provider, days: tillDays.size, lines: rows.length, orders: new Set(rows.map((r) => r.receipt)).size, caughtUp: w.caughtUp, through: w.to.toISOString() };
}

async function saveRows(rid: string, c: TillConnection, w: SyncWindow, rows: ReturnType<typeof tillRows>, tillDays: Set<string>, covers: Map<string, number>) {
  const supabase = getSupabase();
  const [first, last] = [w.days[0], w.days.at(-1)!];
  // This connection's own lines for the window are always read again.
  const own = await selectAll<{ day: string }>((from, to) =>
    supabase.from("sales_items").select("day").eq("restaurant_id", rid).eq("till_connection_id", c.id).gte("day", first).lte("day", last).range(from, to),
  );
  check(await supabase.from("sales_items").delete().eq("restaurant_id", rid).eq("till_connection_id", c.id).gte("day", first).lte("day", last));
  // A day the till has orders for: anything else for that day (a file, dummy data, an older till) goes.
  if (tillDays.size) {
    check(await supabase.from("sales_items").delete().eq("restaurant_id", rid).in("day", [...tillDays]));
    check(await supabase.from("sales_hours").delete().eq("restaurant_id", rid).eq("source", "seed").in("day", [...tillDays]));
  }
  for (let i = 0; i < rows.length; i += 1000) {
    check(
      await supabase.from("sales_items").insert(
        rows.slice(i, i + 1000).map((r) => ({ restaurant_id: rid, day: r.day, hour: r.hour, item: r.item, quantity: r.quantity, amount: r.amount, receipt: r.receipt, row_key: r.row_key, till_connection_id: c.id, import_id: null, is_dummy: false })),
      ),
    );
  }
  // Each touched day's totals from its item sales (a till report for the day still wins).
  const touched = [...new Set([...tillDays, ...own.map((o) => o.day)])];
  if (!touched.length) return;
  const lines = await selectAll<{ day: string; hour: number | null; amount: number; receipt: string | null }>((from, to) =>
    supabase.from("sales_items").select("day, hour, amount, receipt").eq("restaurant_id", rid).eq("is_dummy", false).in("day", touched).range(from, to),
  );
  const totals = dayTotals(lines.map((l) => ({ day: l.day, hour: l.hour, receipt: l.receipt, amount: Number(l.amount) })));
  await saveDaysFromPos(rid, totals);
  // A day whose till lines all went (e.g. orders refunded away) no longer has sales from items.
  const empty = touched.filter((d) => !totals.some((t) => t.day === d));
  if (empty.length) check(await supabase.from("sales_days").delete().eq("restaurant_id", rid).eq("source", "pos").in("day", empty));
  for (const [day, n] of covers) {
    if (!tillDays.has(day)) continue;
    check(await supabase.from("sales_days").update({ covers: Math.round(n), covers_source: "export" }).eq("restaurant_id", rid).eq("day", day).eq("source", "pos"));
  }
}
