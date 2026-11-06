// A dummy till end to end against the REAL dev database (no Claude, no till
// company, free). It copies Ember & Spice into a throwaway demo restaurant (so
// Ember & Spice's own test sales are never replaced), connects a dummy till,
// syncs until caught up, syncs again (nothing doubles), disconnects (sync stops,
// sales stay), then deletes the throwaway restaurant. Never runs on live. Run with:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/tills.e2e.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const ID = randomUUID();
const SLUG = `till-test-${ID.slice(0, 8)}`;
const alerts: string[] = [];
const backfills: string[] = [];
type Sb = ReturnType<typeof import("@/lib/supabase").getSupabase>;
let sb: Sb;

beforeAll(async () => {
  if (process.env.VERCEL_ENV === "production" || !/nfphswknczyovnmnxjfa/.test(process.env.SUPABASE_URL ?? "")) throw new Error("Only runs on the dev database");
  process.env.TEST_TOOLS = "true";
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async (rid: string, why: string) => backfills.push(`${rid}:${why}`) }));
  sb = (await import("@/lib/supabase")).getSupabase();
  const { data: ember } = await sb.from("restaurants").select("*").eq("slug", "ember-spice").single();
  expect(ember, "Ember & Spice on dev").toBeTruthy();
  const copy = { ...ember, id: ID, slug: SLUG, name: "Till Test Grill", owner_whatsapp: `+4477009004${String(Math.floor(Math.random() * 90) + 10)}`, owner_email: null, active: false, is_demo: true };
  for (const k of ["created_at", "updated_at", "stripe_customer_id", "stripe_subscription_id"]) delete (copy as Record<string, unknown>)[k];
  const { error } = await sb.from("restaurants").insert(copy);
  if (error) throw new Error(`Couldn't make the test restaurant: ${error.message}`);
});

afterAll(async () => {
  if (!sb) return;
  await sb.from("restaurants").delete().eq("id", ID).eq("is_demo", true);
  const { data } = await sb.from("restaurants").select("id").eq("id", ID);
  console.log(data?.length ? "!! test restaurant NOT deleted" : "test restaurant deleted");
});

const restaurant = async () => (await sb.from("restaurants").select("*").eq("id", ID).single()).data!;
const lines = async () => {
  const all: { day: string; row_key: string; amount: number; till_connection_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("sales_items").select("day, row_key, amount, till_connection_id").eq("restaurant_id", ID).order("row_key").range(from, from + 999);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return all;
  }
};

test("dummy till: connect, backfill, re-sync without doubling, disconnect", async () => {
  const { saveTill, tillFor, disconnectTill } = await import("@/lib/tills/store");
  const { syncTill } = await import("@/lib/tills/sync");
  const r0 = await restaurant();
  const dishes = (r0.menu ?? []).flatMap((s: { items: unknown[] }) => s.items).length;
  console.log(`menu dishes: ${dishes}`);
  expect(dishes).toBeGreaterThan(0);

  const c = await saveTill({ restaurantId: ID, provider: "square", mode: "dummy", credentials: null, account: null, location: null, locationName: "Dummy till", connectedBy: "e2e", actor: "builder" });
  expect((await tillFor(ID))?.id).toBe(c.id);

  // Backfill: 90 days in runs of up to 31, like the queue does.
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const out = await syncTill(await restaurant());
    runs.push(out);
    console.log(`sync ${i + 1}: ${JSON.stringify(out)}`);
    if (out.status !== "synced" || out.caughtUp) break;
  }
  const last = runs.at(-1)!;
  expect(last.status).toBe("synced");
  expect(last.status === "synced" && last.caughtUp).toBe(true);
  expect(runs.length).toBeGreaterThanOrEqual(3);

  const after1 = await lines();
  const days1 = new Set(after1.map((l) => l.day));
  const keys1 = new Set(after1.map((l) => l.row_key));
  console.log(`after backfill: ${after1.length} sale lines over ${days1.size} days`);
  expect(after1.length).toBeGreaterThan(5000);
  expect(days1.size).toBeGreaterThanOrEqual(85);
  expect(keys1.size).toBe(after1.length);
  expect(after1.every((l) => l.till_connection_id === c.id)).toBe(true);

  const { data: dayRows } = await sb.from("sales_days").select("day, source, net_sales, transactions").eq("restaurant_id", ID).eq("source", "pos").order("day", { ascending: false }).limit(3);
  console.log(`latest day totals: ${JSON.stringify(dayRows)}`);
  expect(dayRows?.length).toBeGreaterThan(0);

  // Sync again: the last two days are read again and replaced, not added twice.
  const again = await syncTill(await restaurant());
  console.log(`re-sync: ${JSON.stringify(again)}`);
  const after2 = await lines();
  const keys2 = new Set(after2.map((l) => l.row_key));
  expect(keys2.size).toBe(after2.length);
  const doubled = after2.length - keys1.size - [...keys2].filter((k) => !keys1.has(k)).length;
  expect(doubled).toBe(0);
  console.log(`after re-sync: ${after2.length} lines (${after2.length - after1.length} new from orders since)`);

  // Disconnect: sync stops, sales stay.
  await disconnectTill(ID, "builder");
  const stopped = await syncTill(await restaurant());
  console.log(`after disconnect: ${JSON.stringify(stopped)}`);
  expect(stopped.status).toBe("skipped");
  expect((await lines()).length).toBe(after2.length);

  const { data: log } = await sb.from("audit_log").select("detail").eq("restaurant_id", ID).eq("action", "till").order("created_at");
  console.log(`audit log: ${JSON.stringify(log?.map((l) => l.detail))}`);
  expect(log?.length).toBe(2);
  expect(alerts).toEqual([]);
  console.log(`outside-data backfill queued: ${backfills.length}`);
});
