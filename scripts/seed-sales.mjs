// Adds 12 months of dummy daily, hourly and item sales to both demo restaurants
// (Ember & Spice Grill and Cardamom Corner Café), with patterns built in:
//   - Friday and Saturday evening peaks, quiet Monday afternoons
//   - rainy days (1mm or more, from the REAL stored weather) about 20% lower
//   - Ramadan 2026 (18 Feb to 19 Mar): quieter days, a spike around iftar (sunset)
//   - a little seasonality, slow growth and day-to-day noise
// Everything is marked dummy (is_dummy = true, source 'seed'), so --remove or
// scripts/clear-dummy-data.mjs takes it out. Days that already have real figures
// (a till report or POS file) are left alone. Running it again replaces the dummy data.
// If a restaurant has no stored weather yet, the last 12 months are fetched first
// (Open-Meteo, the same as the app's weather job).
// Usage: node --env-file=.env.local scripts/seed-sales.mjs [--remove]
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const SLUGS = ["ember-spice", "cardamom-corner"];
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

// ---------- Dates (London) ----------
const londonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()); // YYYY-MM-DD
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------- Random numbers that are the same every run ----------
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const wobble = (pct) => 1 + (rand() * 2 - 1) * pct;
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Ramadan 2026 and iftar ----------
const RAMADAN = { start: "2026-02-18", end: "2026-03-19" };
const inRamadan = (ymd) => ymd >= RAMADAN.start && ymd <= RAMADAN.end;
// London sunset (GMT) moves from about 17:15 to 18:13 across Ramadan 2026.
function iftarHour(ymd) {
  const progress = (new Date(`${ymd}T00:00:00Z`) - new Date(`${RAMADAN.start}T00:00:00Z`)) / (29 * 86_400_000);
  return Math.floor(17.25 + progress * 0.97);
}

// ---------- How each restaurant trades ----------
const PROFILES = {
  "ember-spice": {
    base: 2350, // gross takings on an average day
    avgSpend: 22.5,
    weekday: [1.05, 0.72, 0.8, 0.85, 0.95, 1.3, 1.45], // Sun..Sat
    hourWeight: (h) => ({ 12: 6, 13: 7, 14: 5, 15: 3, 16: 3, 17: 6, 18: 10, 19: 13, 20: 12, 21: 9, 22: 6, 23: 3 })[h] ?? 1,
    eveningFrom: 18,
    ramadan: { daytime: 0.55, iftar: 2.3 },
    popular: { "Mixed Grill Platter": 5, "Lamb Chops (4 pcs)": 6, "Chicken Tikka": 6, "Smash Burger": 6, "Garlic Naan": 9, "Masala Chips": 8, "Mango Lassi": 6 },
  },
  "cardamom-corner": {
    base: 880,
    avgSpend: 8.6,
    weekday: [0, 0.85, 0.9, 0.92, 1.0, 1.15, 1.3],
    hourWeight: (h) => ({ 7: 4, 8: 9, 9: 10, 10: 7, 11: 6, 12: 9, 13: 9, 14: 6, 15: 5, 16: 4, 17: 3, 18: 2 })[h] ?? 1,
    eveningFrom: 16,
    ramadan: { daytime: 0.75, iftar: 1.8 },
    popular: { "Cardamom Latte": 9, "Karak Chai": 8, "Flat White": 7, "Almond Croissant": 6, "Halloumi Wrap": 5, "Pistachio Rose Cake": 5 },
  },
};
const MONTH = [0.88, 0.92, 0.97, 1.0, 1.03, 1.05, 1.06, 1.04, 1.0, 1.0, 0.98, 1.12];

// "12:00 – 23:00" -> hours 12..22; "Closed" -> none. (Midnight closing counts as 24.)
function openHours(text) {
  if (!text || /closed/i.test(text)) return [];
  const times = [...String(text).matchAll(/(\d{1,2})[:.](\d{2})/g)].map((m) => Number(m[1]) + Number(m[2]) / 60);
  if (times.length < 2) return [];
  const [from, to] = [times[0], times[1] <= times[0] ? times[1] + 24 : times[1]];
  const hours = [];
  for (let h = Math.floor(from); h < Math.min(24, Math.ceil(to)); h++) hours.push(h);
  return hours;
}

// ---------- Weather (the real thing, stored by the app's weather job) ----------
async function ensureWeather(r) {
  const have = ok(await s.from("weather_days").select("day, rain_mm").eq("restaurant_id", r.id).gte("day", addDays(londonToday, -366)), "weather");
  if (have.length >= 300) return new Map(have.map((w) => [w.day, Number(w.rain_mm ?? 0)]));
  console.log(`  No stored weather for ${r.name} yet: fetching the last 12 months from Open-Meteo…`);
  let { latitude: lat, longitude: lon } = r;
  if (lat == null) {
    const pc = (r.address ?? "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
    if (!pc) throw new Error(`${r.name} has no postcode in its address, so its weather can't be found`);
    const res = await (await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(`${pc[1]} ${pc[2]}`)}`)).json();
    ({ latitude: lat, longitude: lon } = res.result);
    ok(await s.from("restaurants").update({ latitude: lat, longitude: lon }).eq("id", r.id), "save location");
  }
  const daily = "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code";
  const archive = await (
    await fetch(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${addDays(londonToday, -365)}&end_date=${addDays(londonToday, -8)}&daily=${daily}&timezone=Europe%2FLondon`,
    )
  ).json();
  const recent = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${daily}&past_days=7&forecast_days=1&timezone=Europe%2FLondon`)).json();
  const rows = [];
  for (const [json, kind] of [[archive, "archive"], [recent, "recent"]]) {
    const d = json.daily;
    if (!d?.time) throw new Error(`Open-Meteo: ${JSON.stringify(json).slice(0, 200)}`);
    d.time.forEach((day, i) =>
      rows.push({
        restaurant_id: r.id,
        day,
        temp_max: d.temperature_2m_max[i],
        temp_min: d.temperature_2m_min[i],
        temp_mean: d.temperature_2m_mean?.[i] ?? null,
        rain_mm: d.precipitation_sum[i],
        weather_code: d.weather_code[i],
        conditions: null,
        source: kind === "archive" ? "archive" : day >= londonToday ? "forecast" : "recent",
      }),
    );
  }
  for (let i = 0; i < rows.length; i += 500) ok(await s.from("weather_days").upsert(rows.slice(i, i + 500), { onConflict: "restaurant_id,day" }), "store weather");
  ok(await s.from("restaurants").update({ weather_backfilled_at: new Date().toISOString(), last_weather_on: londonToday }).eq("id", r.id), "mark weather");
  return new Map(rows.map((w) => [w.day, Number(w.rain_mm ?? 0)]));
}

async function removeDummy(rid) {
  for (const table of ["sales_items", "sales_hours", "sales_days"]) ok(await s.from(table).delete().eq("restaurant_id", rid).eq("is_dummy", true), `remove ${table}`);
}

async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += 500) ok(await s.from(table).insert(rows.slice(i, i + 500)), `insert ${table}`);
}

// ---------- Main ----------
const restaurants = ok(await s.from("restaurants").select("*").in("slug", SLUGS).eq("is_demo", true), "restaurants");
if (!restaurants.length) throw new Error("No demo restaurants found. Dummy data is never added to a real restaurant.");

for (const r of restaurants) {
  await removeDummy(r.id);
  if (process.argv.includes("--remove")) {
    console.log(`Removed dummy sales from ${r.name}.`);
    continue;
  }
  console.log(`${r.name}:`);
  seed = r.slug === "ember-spice" ? 11 : 22;
  const p = PROFILES[r.slug];
  const rain = await ensureWeather(r);
  const real = new Set(ok(await s.from("sales_days").select("day").eq("restaurant_id", r.id).eq("is_dummy", false), "real days").map((d) => d.day));
  const items = (r.menu ?? []).flatMap((c) => c.items).filter((i) => i.price > 0);
  const weightOf = (i) => p.popular[i.name] ?? 3;

  const days = [];
  const hours = [];
  const lines = [];
  let rainy = { n: 0, total: 0 };
  let dry = { n: 0, total: 0 };
  const first = addDays(londonToday, -365);
  for (let day = first; day < londonToday; day = addDays(day, 1)) {
    const wd = weekday(day);
    const open = openHours(r.opening_hours?.[DAY_NAMES[wd]]);
    if (!open.length || !p.weekday[wd] || real.has(day)) continue;
    const progress = (new Date(day) - new Date(first)) / (365 * 86_400_000);
    const wet = (rain.get(day) ?? 0) >= 1;
    const ramadan = inRamadan(day);
    const iftar = iftarHour(day);

    // Each hour's takings: the usual shape, then the day's patterns.
    const shape = open.map((h) => {
      let w = p.hourWeight(h);
      if ((wd === 5 || wd === 6) && h >= p.eveningFrom) w *= 1.6; // Friday and Saturday evenings
      if (wd === 1 && h >= 14 && h < 17) w *= 0.45; // quiet Monday afternoons
      if (ramadan) w *= h < iftar - 1 ? p.ramadan.daytime : h <= iftar + 1 ? p.ramadan.iftar : 1;
      return { h, w: w * wobble(0.12) };
    });
    const normalWeight = open.reduce((sum, h) => sum + p.hourWeight(h) * ((wd === 5 || wd === 6) && h >= p.eveningFrom ? 1.6 : 1) * (wd === 1 && h >= 14 && h < 17 ? 0.45 : 1), 0);
    const shapeWeight = shape.reduce((sum, x) => sum + x.w, 0);
    let target = p.base * p.weekday[wd] * MONTH[Number(day.slice(5, 7)) - 1] * (0.97 + progress * 0.06) * wobble(0.07);
    target *= shapeWeight / normalWeight; // Ramadan changes the day's total, not just its shape
    if (wet) target *= 0.8; // rainy days about 20% lower

    // Items that add up to the day, then hours scaled to the same total.
    const totalW = items.reduce((sum, i) => sum + weightOf(i) * i.price, 0);
    let gross = 0;
    for (const i of items) {
      const qty = Math.max(0, Math.round(((target * weightOf(i) * i.price) / totalW / i.price) * wobble(0.15)));
      if (!qty) continue;
      const amount = round2(qty * i.price);
      gross += amount;
      lines.push({ restaurant_id: r.id, day, hour: null, item: i.name, quantity: qty, amount, row_key: `seed:${day}:${i.name}`, is_dummy: true });
    }
    gross = round2(gross);
    for (const x of shape) {
      hours.push({ restaurant_id: r.id, day, hour: x.h, sales: round2((gross * x.w) / shapeWeight), source: "seed", is_dummy: true });
    }
    const net = round2(gross / 1.2);
    const card = round2(gross * (0.8 + rand() * 0.08));
    days.push({
      restaurant_id: r.id,
      day,
      net_sales: net,
      gross_sales: gross,
      vat: round2(gross - net),
      transactions: Math.max(1, Math.round((gross / p.avgSpend) * wobble(0.08))),
      card,
      cash: round2(gross - card),
      discounts: round2(gross * 0.015 * wobble(0.5)),
      refunds: 0,
      net_estimated: false,
      source: "seed",
      is_dummy: true,
    });
    if (!ramadan) {
      const bucket = wet ? rainy : dry;
      bucket.n++;
      bucket.total += gross / p.weekday[wd];
    }
  }
  await insertAll("sales_days", days);
  await insertAll("sales_hours", hours);
  await insertAll("sales_items", lines);
  const avg = (x) => (x.n ? x.total / x.n : 0);
  console.log(
    `  ${days.length} days, ${hours.length} hourly rows, ${lines.length} item rows. Rainy days (${rainy.n}) averaged ${Math.round((1 - avg(rainy) / avg(dry)) * 100)}% below dry days (allowing for the weekday).`,
  );
}
if (!process.argv.includes("--remove")) console.log("\nDone. Text RUN REPORT on WhatsApp to see the Sales section. Remove with --remove (or scripts/clear-dummy-data.mjs).");
