// Saves a demo restaurant's numbers (dummy sales, weather, reviews, sign-ups,
// campaigns) as a test fixture for the Insights agent cases:
// agents/tests/insights/data/<slug>.json. Only figures and dates: no customer
// names, emails, review texts or ids that point at a person.
// Usage: node --env-file=.env.local scripts/export-insights-fixture.mjs [slug ...]
// (default: both demo restaurants). Re-running replaces the fixture, so the cases'
// expected answers must then be checked again (npm test does that).
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ["ember-spice", "cardamom-corner"];
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
// Supabase gives at most 1,000 rows at a time.
async function all(table, columns, rid, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await s.from(table).select(columns).eq("restaurant_id", rid).order(order).range(from, from + 999), table);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const num = (v) => (v == null ? null : Number(v));

mkdirSync("agents/tests/insights/data", { recursive: true });
for (const slug of slugs) {
  const r = ok(await s.from("restaurants").select("id, name, is_demo").eq("slug", slug).single(), "restaurant");
  if (!r.is_demo) throw new Error(`${slug} isn't a demo restaurant: only dummy data goes into test fixtures`);
  const [days, hours, items, weather, reviews, events, campaigns, sends, rewards] = await Promise.all([
    all("sales_days", "day, net_sales, gross_sales, transactions, source, net_estimated, is_dummy", r.id, "day"),
    all("sales_hours", "day, hour, sales", r.id, "day"),
    all("sales_items", "day, item, quantity, amount", r.id, "day"),
    all("weather_days", "day, temp_max, temp_min, rain_mm, conditions", r.id, "day"),
    all("reviews", "review_date, rating, reply_posted_at", r.id, "review_date"),
    all("customer_events", "type, created_at", r.id, "created_at"),
    all("campaigns", "id, name, offer, segment, is_birthday, sent_at, valid_from, valid_until", r.id, "created_at"),
    all("campaign_sends", "campaign_id, kind, delivery, created_at, opened_at, clicked_at, redeemed_at", r.id, "created_at"),
    all("rewards", "created_at, redeemed_at", r.id, "created_at"),
  ]);
  const fixture = {
    restaurant: r.name,
    exported_at: new Date().toISOString(),
    sales_days: days.map((d) => ({
      day: d.day,
      net: num(d.net_sales),
      gross: num(d.gross_sales),
      transactions: d.transactions,
      source: d.source,
      net_estimated: d.net_estimated,
      dummy: d.is_dummy,
    })),
    sales_hours: hours.map((h) => ({ day: h.day, hour: h.hour, sales: num(h.sales) })),
    sales_items: items.map((i) => ({ day: i.day, item: i.item, quantity: num(i.quantity), amount: num(i.amount) })),
    weather: weather.map((w) => ({ day: w.day, temp_max: num(w.temp_max), temp_min: num(w.temp_min), rain_mm: num(w.rain_mm), conditions: w.conditions })),
    reviews: reviews.map((x) => ({ date: x.review_date, rating: x.rating, replied_at: x.reply_posted_at })),
    signups: events.filter((e) => e.type === "signup").map((e) => e.created_at),
    campaigns: campaigns.map((c, i) => ({ id: `cmp_${i + 1}`, db_id: c.id, name: c.name, offer: c.offer, segment: c.segment, is_birthday: c.is_birthday, sent_at: c.sent_at, valid_from: c.valid_from, valid_until: c.valid_until })),
    sends: sends.filter((x) => x.kind === "customer").map((x) => ({ campaign_id: x.campaign_id, delivery: x.delivery, sent_at: x.created_at, opened_at: x.opened_at, clicked_at: x.clicked_at, redeemed_at: x.redeemed_at })),
    rewards: rewards.map((x) => ({ created_at: x.created_at, redeemed_at: x.redeemed_at })),
  };
  // Campaign ids in the fixture are short labels, not database ids.
  const label = new Map(fixture.campaigns.map((c) => [c.db_id, c.id]));
  fixture.sends = fixture.sends.map((x) => ({ ...x, campaign_id: label.get(x.campaign_id) ?? "cmp_unknown" }));
  fixture.campaigns = fixture.campaigns.map((c) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "db_id")));
  writeFileSync(`agents/tests/insights/data/${slug}.json`, `${JSON.stringify(fixture)}\n`);
  console.log(`${slug}: ${days.length} days, ${hours.length} hours, ${items.length} item rows, ${weather.length} weather days, ${reviews.length} reviews, ${fixture.signups.length} sign-ups, ${campaigns.length} campaigns`);
}
