// Fills one demo restaurant with a full, believable set of dummy data, so every
// owner page (home, approvals, sales, team, customers, reviews, activity) can be
// seen "populated": a Turkish charcoal grill in Dalston with a menu, 12 months of
// sales, ~40 Google reviews, ~85 customers, campaigns, Google posts, a team of 8
// with past rotas and next week's suggested rota, and things waiting for approval.
// Everything it adds is tagged, so running it again replaces it and --remove
// takes it out. Profile fields (menu, hours, address...) are only filled if empty
// and are left in place by --remove.
// Usage: node --env-file=<dev project env file> scripts/seed-showcase.mjs [slug] [--remove]
//   slug defaults to dina-test-grill; it must be a demo restaurant (is_demo). Refuses the live database.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { refuseLive } from "./lib/live-guard.mjs";

refuseLive(process.env, "seed-showcase.mjs");

const TAG = "showcase-seed";
const REVIEW_SOURCE = "seed_showcase";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "dina-test-grill";
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (d, h = 0) => new Date(now - d * DAY - h * HOUR).toISOString();
const token = () => randomBytes(24).toString("base64url");
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
async function insertAll(table, rows, what = table) {
  for (let i = 0; i < rows.length; i += 500) ok(await s.from(table).insert(rows.slice(i, i + 500)), `insert ${what}`);
}

// Same random numbers every run.
let seed = 77;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const wobble = (pct) => 1 + (rand() * 2 - 1) * pct;
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- London dates ----------
const londonYmd = (t = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(t);
const today = londonYmd();
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isoWeekday = (ymd) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// "d days ago at this London hour" (e.g. 10.5 = 10:30am) as an ISO time.
const clockAt = (d, hour) => londonInstant(addDays(today, -d), Math.round(hour * 60)).toISOString();
// "minutes after midnight on a London date" as an instant.
function londonInstant(ymd, minutes) {
  const guess = new Date(`${ymd}T00:00:00Z`).getTime() + minutes * 60_000;
  const wall = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "Europe/London" })).getTime();
  const utcWall = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess - (wall - utcWall));
}

// ---------- The restaurant ----------
const { data: restaurant } = await s.from("restaurants").select("*").eq("slug", slug).eq("is_demo", true).maybeSingle();
if (!restaurant) throw new Error(`No demo restaurant with slug "${slug}". Dummy data is never added to a real restaurant.`);
const rid = restaurant.id;

async function remove() {
  // Rota first: its shifts point at the staff.
  ok(await s.from("rota_weeks").delete().eq("restaurant_id", rid).eq("source", "synthetic"), "delete rota weeks");
  ok(await s.from("staff").delete().eq("restaurant_id", rid).eq("source", "synthetic"), "delete staff"); // cascades pay and availability
  ok(await s.from("rota_rules").delete().eq("restaurant_id", rid).eq("source", "synthetic"), "delete rota rules");
  const drafts = ok(await s.from("drafts").select("id").eq("restaurant_id", rid).eq("request", TAG), "find drafts");
  ok(await s.from("audit_log").delete().eq("restaurant_id", rid).eq("data->>seed", TAG), "delete audit log");
  for (let i = 0; i < drafts.length; i += 200) ok(await s.from("drafts").delete().in("id", drafts.slice(i, i + 200).map((d) => d.id)), "delete drafts"); // cascades campaigns, sends, posts
  ok(await s.from("consents").delete().eq("restaurant_id", rid).eq("source", TAG), "delete consents");
  ok(await s.from("customer_events").delete().eq("restaurant_id", rid).eq("detail", TAG), "delete events");
  ok(await s.from("customers").delete().eq("restaurant_id", rid).eq("notes", TAG), "delete customers"); // cascades rewards
  ok(await s.from("reviews").delete().eq("restaurant_id", rid).eq("source", REVIEW_SOURCE), "delete reviews");
  for (const t of ["sales_items", "sales_hours", "sales_days"]) ok(await s.from(t).delete().eq("restaurant_id", rid).eq("is_dummy", true), `delete ${t}`);
  // Saved forecasts were worked out from the dummy sales, so they go too.
  for (const t of ["forecast_snapshots", "forecast_briefs"]) {
    const res = await s.from(t).delete().eq("restaurant_id", rid);
    if (res.error && !/does not exist|schema cache/.test(res.error.message)) throw new Error(`delete ${t}: ${res.error.message}`);
  }
}

await remove();
if (args.includes("--remove")) {
  console.log(`Removed the showcase dummy data from ${restaurant.name}. (Its menu, hours and other details were left as they are.)`);
  process.exit(0);
}

// ---------- Profile (only what's empty) ----------
const A = (list) => list; // allergens, UK names
const MENU = [
  {
    category: "Charcoal grills",
    items: [
      { name: "Adana Kebab", price: 15.5, description: "Hand-minced lamb with red pepper and chilli, on the mangal", allergens: A(["Gluten"]) },
      { name: "Lamb Shish", price: 17.5, description: "Marinated leg of lamb, grilled over charcoal", allergens: A(["Milk"]) },
      { name: "Chicken Shish", price: 14.5, description: "Chicken thigh in yoghurt, garlic and paprika", allergens: A(["Milk"]) },
      { name: "Lamb Ribs", price: 18.95, description: "Slow-marinated and finished on the grill", allergens: A([]) },
      { name: "Mixed Mangal for Two", price: 39.0, description: "Adana, lamb and chicken shish, ribs, wings, bulgur and salad", allergens: A(["Gluten", "Milk"]) },
      { name: "Chicken Wings (8)", price: 9.5, description: "Charcoal wings with pul biber", allergens: A([]) },
    ],
  },
  {
    category: "Meze",
    items: [
      { name: "Hummus", price: 6.5, description: "With warm pide", allergens: A(["Sesame", "Gluten"]) },
      { name: "Halloumi", price: 7.5, description: "Grilled, with honey and thyme", allergens: A(["Milk"]) },
      { name: "Falafel (5)", price: 6.95, description: "With tahini", allergens: A(["Sesame"]) },
      { name: "Sigara Böreği", price: 7.25, description: "Crispy feta and parsley rolls", allergens: A(["Gluten", "Milk", "Eggs"]) },
      { name: "Ezme Salad", price: 5.5, description: "Chopped tomato, pepper and pomegranate", allergens: A([]) },
    ],
  },
  {
    category: "Sides",
    items: [
      { name: "Bulgur Pilav", price: 3.95, description: null, allergens: A(["Gluten"]) },
      { name: "Fresh Pide", price: 2.95, description: "Baked to order", allergens: A(["Gluten", "Sesame"]) },
      { name: "Chips", price: 3.5, description: null, allergens: A([]) },
    ],
  },
  {
    category: "Desserts & drinks",
    items: [
      { name: "Künefe", price: 7.95, description: "Warm, with pistachio and clotted cream", allergens: A(["Gluten", "Milk", "Nuts"]) },
      { name: "Baklava (4)", price: 6.5, description: "Pistachio", allergens: A(["Gluten", "Nuts", "Milk"]) },
      { name: "Ayran", price: 2.95, description: "Salted yoghurt drink", allergens: A(["Milk"]) },
      { name: "Turkish Tea", price: 2.0, description: null, allergens: A([]) },
      { name: "Soft Drinks", price: 2.75, description: null, allergens: A([]) },
    ],
  },
];
// Three new dishes still waiting for the owner to confirm their allergens.
const UNCONFIRMED = new Set(["Lamb Ribs", "Sigara Böreği", "Baklava (4)"]);
for (const c of MENU) for (const i of c.items) i.allergens_confirmed = !UNCONFIRMED.has(i.name);

const HOURS = {
  Monday: "17:00 – 23:00",
  Tuesday: "12:00 – 23:00",
  Wednesday: "12:00 – 23:00",
  Thursday: "12:00 – 23:00",
  Friday: "12:00 – 00:00",
  Saturday: "12:00 – 00:00",
  Sunday: "12:00 – 22:00",
};
const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const PROFILE = {
  cuisine: "Turkish charcoal grill (ocakbaşı)",
  address: "88 Kingsland High Street, London E8 2NS",
  phone: "+44 20 7946 0456",
  opening_hours: HOURS,
  menu: MENU,
  brand_voice: "Warm and generous, like a family ocakbaşı. Short, confident sentences about fire, fresh bread and good company. A touch of Turkish hospitality (\"afiyet olsun\"), never over the top.",
  signup_reward: "a free portion of Künefe",
  tagline: "Charcoal grill · Dalston",
  owner_name: "Dina",
  labour_target_pct: 28,
  latitude: 51.5476,
  longitude: -0.0756,
  council_name: "Hackney",
  council_code: "E09000012",
  google_rating: 4.5,
  google_rating_count: 312,
};
const fill = Object.fromEntries(Object.entries(PROFILE).filter(([k]) => empty(restaurant[k])));
// The menu is stored as dishes; restaurants.menu is a copy that save_menu() makes.
if (fill.menu) ok(await s.rpc("save_menu", { p_restaurant_id: rid, p_menu: fill.menu, p_source: "synthetic", p_renames: [] }), "save menu");
const columns = { ...fill };
delete columns.menu;
if (Object.keys(columns).length) ok(await s.from("restaurants").update(columns).eq("id", rid), "fill profile");
const r = { ...restaurant, ...fill };
const menuItems = (r.menu ?? []).flatMap((c) => c.items).filter((i) => i.price > 0);
const first = (name) => name.split(" ")[0];

// ---------- 12 months of sales ----------
const P = {
  base: 1950,
  avgSpend: 24.5,
  weekday: [0, 0.55, 0.78, 0.82, 0.95, 1.4, 1.55, 1.15], // index = ISO weekday
  hourWeight: (h) => ({ 12: 5, 13: 6, 14: 4, 15: 2, 16: 2, 17: 5, 18: 9, 19: 13, 20: 13, 21: 10, 22: 6, 23: 3 })[h] ?? 1,
  popular: { "Adana Kebab": 7, "Mixed Mangal for Two": 5, "Lamb Shish": 6, "Chicken Shish": 7, "Fresh Pide": 9, "Hummus": 7, "Ayran": 6, "Künefe": 5, Chips: 6 },
  slow: new Set(["Sigara Böreği", "Ezme Salad"]),
};
const MONTH = [0.88, 0.92, 0.97, 1.0, 1.03, 1.05, 1.06, 1.04, 1.0, 1.0, 0.98, 1.12];
function openHours(text) {
  if (!text || /closed/i.test(text)) return [];
  const t = [...String(text).matchAll(/(\d{1,2})[:.](\d{2})/g)].map((m) => Number(m[1]) + Number(m[2]) / 60);
  if (t.length < 2) return [];
  const to = t[1] <= t[0] ? t[1] + 24 : t[1];
  const hours = [];
  for (let h = Math.floor(t[0]); h < Math.min(24, Math.ceil(to)); h++) hours.push(h);
  return hours;
}
const real = new Set(ok(await s.from("sales_days").select("day").eq("restaurant_id", rid).eq("is_dummy", false), "real days").map((d) => d.day));
const salesDays = [];
const salesHours = [];
const salesLines = [];
const startDay = addDays(today, -365);
for (let day = startDay; day < today; day = addDays(day, 1)) {
  const wd = isoWeekday(day);
  const open = openHours(r.opening_hours?.[DAY_NAMES[wd]]);
  if (!open.length || real.has(day)) continue;
  const progress = (new Date(day) - new Date(startDay)) / (365 * DAY);
  let target = P.base * P.weekday[wd] * MONTH[Number(day.slice(5, 7)) - 1] * (0.94 + progress * 0.12) * wobble(0.08);
  // The last week a little better than the one before, so the home page has good news.
  if (day >= addDays(today, -7)) target *= 1.06;
  const shape = open.map((h) => ({ h, w: P.hourWeight(h) * ((wd === 5 || wd === 6) && h >= 18 ? 1.5 : 1) * wobble(0.12) }));
  const shapeW = shape.reduce((a, x) => a + x.w, 0);
  const weightOf = (i) => (P.popular[i.name] ?? 3) * (P.slow.has(i.name) ? 0.35 : 1);
  const totalW = menuItems.reduce((a, i) => a + weightOf(i) * i.price, 0);
  let gross = 0;
  for (const i of menuItems) {
    const qty = Math.max(0, Math.round(((target * weightOf(i)) / totalW) * wobble(0.18)));
    if (!qty) continue;
    const amount = round2(qty * i.price);
    gross += amount;
    salesLines.push({ restaurant_id: rid, day, hour: null, item: i.name, quantity: qty, amount, row_key: `seed:${day}:${i.name}`, is_dummy: true });
  }
  gross = round2(gross);
  const transactions = Math.max(1, Math.round((gross / P.avgSpend) * wobble(0.08)));
  for (const x of shape) {
    salesHours.push({ restaurant_id: rid, day, hour: x.h, sales: round2((gross * x.w) / shapeW), transactions: Math.max(0, Math.round((transactions * x.w) / shapeW)), source: "seed", is_dummy: true });
  }
  const net = round2(gross / 1.2);
  const card = round2(gross * (0.84 + rand() * 0.08));
  salesDays.push({
    restaurant_id: rid, day, net_sales: net, gross_sales: gross, vat: round2(gross - net), transactions, card, cash: round2(gross - card),
    discounts: round2(gross * 0.015 * wobble(0.5)), refunds: 0, net_estimated: false, source: "seed", is_dummy: true,
  });
}
await insertAll("sales_days", salesDays);
await insertAll("sales_hours", salesHours);
await insertAll("sales_items", salesLines);

// ---------- Weather (the real thing, from Open-Meteo, if none is stored yet) ----------
let weatherNote = "weather already stored";
const haveWeather = ok(await s.from("weather_days").select("day").eq("restaurant_id", rid).gte("day", addDays(today, -366)), "weather");
if (haveWeather.length < 300) {
  try {
    const daily = "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code";
    const ll = `latitude=${r.latitude}&longitude=${r.longitude}`;
    const archive = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?${ll}&start_date=${addDays(today, -365)}&end_date=${addDays(today, -8)}&daily=${daily}&timezone=Europe%2FLondon`)).json();
    const recent = await (await fetch(`https://api.open-meteo.com/v1/forecast?${ll}&daily=${daily}&past_days=7&forecast_days=1&timezone=Europe%2FLondon`)).json();
    const rows = [];
    for (const [json, kind] of [[archive, "archive"], [recent, "recent"]]) {
      const d = json.daily;
      if (!d?.time) throw new Error("no daily weather");
      d.time.forEach((day, i) =>
        rows.push({
          restaurant_id: rid, day, temp_max: d.temperature_2m_max[i], temp_min: d.temperature_2m_min[i], temp_mean: d.temperature_2m_mean?.[i] ?? null,
          rain_mm: d.precipitation_sum[i], weather_code: d.weather_code[i], conditions: null, source: kind === "archive" ? "archive" : day >= today ? "forecast" : "recent",
        }),
      );
    }
    for (let i = 0; i < rows.length; i += 500) ok(await s.from("weather_days").upsert(rows.slice(i, i + 500), { onConflict: "restaurant_id,day" }), "store weather");
    ok(await s.from("restaurants").update({ weather_backfilled_at: new Date().toISOString(), last_weather_on: today }).eq("id", rid), "mark weather");
    weatherNote = `${rows.length} days of real weather`;
  } catch (err) {
    weatherNote = `weather skipped (${err.message})`;
  }
}

// ---------- Google reviews ----------
// [days ago, hours, author, stars, text, replied]
const REVIEWS = [
  [66, 4, "Gareth W.", 5, "Best adana in Dalston, no contest. The pide comes out puffed and hot.", true],
  [63, 6, "Ece T.", 5, "Tastes like Istanbul. The künefe alone is worth the trip.", true],
  [60, 3, "Marcus L.", 4, "Great lamb shish, a bit of a wait on a Saturday night.", true],
  [57, 5, "Priya N.", 5, "Brought my parents for their anniversary and the staff were so kind.", true],
  [53, 2, "Tom H.", 4, "Generous portions and the hummus is excellent. Music a bit loud.", true],
  [50, 7, "Leyla A.", 5, "Proper ocakbaşı. You can smell the charcoal from the street!", true],
  [47, 4, "Jonah B.", 3, "Food was good but our starters came after the mains.", true],
  [44, 6, "Sofia R.", 5, "Mixed mangal for two fed three of us. Amazing value.", true],
  [41, 3, "Hakan D.", 5, "My go-to for a Friday. The team always remember my order.", true],
  [38, 5, "Ellie M.", 4, "Lovely halloumi with honey. Would come back for the wings.", true],
  [35, 2, "Callum F.", 5, "Fast, friendly and the chicken shish is perfectly charred.", true],
  [32, 8, "Nadia K.", 5, "Celebrated a birthday here and they brought out künefe with a candle.", true],
  [29, 4, "Will P.", 4, "Really tasty, slightly pricey for the sides.", true],
  [27, 6, "Aylin S.", 5, "Ayran and adana, the perfect combination. Lovely staff.", true],
  [24, 3, "Ben C.", 5, "Booked last minute for 8 and they sorted us out. Brilliant night.", true],
  [22, 5, "Grace O.", 4, "Good food, a bit cold by the door in the evening.", true],
  [19, 2, "Mehmet Y.", 5, "Lamb ribs were incredible. Real charcoal flavour.", true],
  [17, 7, "Zoe A.", 5, "Vegetarian meze platter was a treat. Falafel super crispy.", true],
  [15, 4, "Ravi S.", 5, "Wonderful service from Jess. The baklava is homemade and you can tell.", true],
  [13, 6, "Hannah E.", 3, "Lovely food but we waited 25 minutes for the bill.", true],
  [11, 3, "Oscar T.", 5, "Brought friends from out of town and they loved it.", true],
  [10, 5, "Selma B.", 5, "The bread! The grill! Everything is so fresh.", true],
  [8, 2, "Daniel V.", 4, "Great food and atmosphere, quite busy on a Friday.", true],
  [7, 6, "Lucy G.", 5, "Ordered the mixed mangal for two. Generous, smoky and delicious.", true],
  [6, 4, "Kemal I.", 5, "Feels like eating at my uncle's house. Afiyet olsun!", true],
  [5, 3, "Amy J.", 5, "Fantastic adana and a lovely warm welcome.", true],
  [4, 7, "Chris N.", 4, "Really good wings and halloumi. Will be back.", true],
  [3, 5, "Fatima Z.", 5, "Took my kids for lunch and the staff were so patient with them.", true],
  [2, 2, "Josh K.", 5, "Best chicken shish I've had in London.", false],
  [1, 6, "Rosa M.", 4, "Lovely meal. The künefe was the highlight.", false],
  [0, 5, "Imran H.", 5, "Came for the adana, stayed for the baklava. Great service from Ayla.", false],
  [0, 2, "Steve R.", 2, "Waited 40 minutes for our mains on Saturday and nobody told us why. Food was good when it came.", false],
];
const replyFor = (author, stars) =>
  stars >= 4
    ? `Thank you so much, ${first(author)}! We're so glad you enjoyed it. Afiyet olsun, and see you again soon.`
    : `Thank you for the honest feedback, ${first(author)}. We're sorry about the wait and we've talked it through as a team. We'd love to welcome you back.`;
const reviewRows = REVIEWS.map(([d, h, author, rating, text, replied]) => {
  const date = at(d, h);
  return {
    restaurant_id: rid, source: REVIEW_SOURCE, author_name: author, rating, text, review_date: date, created_at: date,
    handled_at: date, // already seen, so the review check doesn't draft its own replies
    replied, reply_text: replied ? replyFor(author, rating) : null,
    reply_posted_at: replied ? new Date(Math.min(now - HOUR, new Date(date).getTime() + 4 * HOUR)).toISOString() : null,
  };
});
const reviews = ok(await s.from("reviews").insert(reviewRows).select("id, author_name, rating, created_at, replied"), "insert reviews");

// ---------- Customers ----------
const NAMES = [
  "Aaliyah", "Adam", "Aisha", "Alfie", "Amara", "Arda", "Ava", "Bilal", "Bella", "Burak", "Chloe", "Cem", "Daisy", "Deniz", "Eda", "Elif", "Ella",
  "Emir", "Ethan", "Eva", "Farah", "Freddie", "Freya", "George", "Hana", "Harry", "Ibrahim", "Isla", "Ivy", "Jack", "Jade", "Kaan", "Kai", "Lara",
  "Leo", "Lily", "Luca", "Maya", "Melis", "Mia", "Mila", "Musa", "Nadia", "Noah", "Nora", "Olivia", "Omar", "Oscar", "Poppy", "Rania", "Reuben",
  "Rosie", "Ruby", "Sami", "Sara", "Selin", "Sienna", "Sofia", "Theo", "Tilly", "Umut", "Willow", "Yara", "Yusuf", "Zara", "Zeynep", "Alex",
  "Ben", "Cara", "Dan", "Emma", "Finn", "Gemma", "Hugo", "Iris", "Jake", "Kira", "Liam", "Megan", "Nina", "Owen", "Pia", "Quinn", "Ryan", "Tara",
];
const SURNAME = ["Yilmaz", "Smith", "Kaya", "Jones", "Demir", "Brown", "Celik", "Taylor", "Sahin", "Wilson", "Khan", "Evans", "Aydin", "Patel", "Ozturk"];
// Sign-ups spread over five months, busier lately: 9 in the last 7 days, 6 the week before.
const signupDays = NAMES.map((_, i) => {
  if (i < 9) return 0.3 + i * 0.7;
  if (i < 15) return 7.5 + (i - 9) * 1.1;
  return 14 + Math.round(((i - 15) / (NAMES.length - 15)) ** 0.8 * 136);
});
const md = (plus) => {
  const d = new Date(now + plus * DAY);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const customerRows = NAMES.map((name, i) => {
  const created = at(signupDays[i], (i * 5) % 9);
  const confirmed = i % 11 !== 5; // a few never tapped "confirm your email"
  const visits = 1 + Math.floor(rand() * (signupDays[i] > 30 ? 9 : 3));
  return {
    restaurant_id: rid, name: `${name} ${SURNAME[i % SURNAME.length]}`, email: `${name.toLowerCase()}.${SURNAME[i % SURNAME.length].toLowerCase()}${i}@example.com`,
    // Three birthdays in the next week, for the birthday email.
    birthday: i === 20 ? `1991-${md(2)}` : i === 33 ? `1988-${md(4)}` : i === 47 ? `1995-${md(6)}` : `19${80 + (i % 20)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
    visit_count: visits, last_visit: addDays(today, -Math.min(Math.floor(signupDays[i]), Math.floor(rand() * 40))),
    marketing_opt_in: i % 9 !== 8, source: "signup", unsubscribe_token: token(), notes: TAG, created_at: created,
    email_confirmed_at: confirmed ? new Date(new Date(created).getTime() + 20 * 60_000).toISOString() : null,
    unsubscribed_at: i === 60 ? at(20) : null,
  };
});
const customers = ok(await s.from("customers").insert(customerRows).select("id, name, email, marketing_opt_in, created_at, email_confirmed_at"), "insert customers");
await insertAll("customer_events", customers.map((c) => ({ restaurant_id: rid, customer_id: c.id, type: "signup", detail: TAG, created_at: c.created_at })), "events");
await insertAll(
  "consents",
  customers.map((c) => ({
    restaurant_id: rid, customer_id: c.id, email: c.email, granted: c.marketing_opt_in, wording: `Send me offers and news from ${r.name} by email.`,
    form_version: "signup-v1", privacy_version: "privacy-v1", source: TAG, created_at: c.created_at, confirmed_at: c.email_confirmed_at,
  })),
);
// Welcome rewards for confirmed customers; about 60% used, a day or two after signing up.
await insertAll(
  "rewards",
  customers
    .filter((c) => c.email_confirmed_at)
    .map((c, i) => {
      const created = new Date(c.created_at).getTime();
      const used = i % 5 !== 1 && i % 5 !== 3 ? Math.min(now - 2 * HOUR, created + (18 + (i % 4) * 14) * HOUR) : null;
      return {
        restaurant_id: rid, customer_id: c.id, token: token(), reward: r.signup_reward ?? "a free portion of Künefe", created_at: c.created_at,
        redeemed_at: used && used > created ? new Date(used).toISOString() : null, expires_at: used && used > created ? new Date(used + 10 * 60_000).toISOString() : null,
      };
    }),
);

// ---------- Audit log helper ----------
const log = [];
const audit = (when, action, detail, draftId = null, actor = "owner") => log.push({ restaurant_id: rid, draft_id: draftId, actor, action, detail, data: { seed: TAG }, created_at: when });

// ---------- Sent email campaigns ----------
const marketable = customers.filter((c) => c.email_confirmed_at && c.marketing_opt_in);
async function campaign({ d, name, subject, body, offer, segment = "everyone", openRate, clickRate, redeemRate }) {
  const sentAt = clockAt(d, 10); // about 10am
  const recipients = marketable.filter((c) => new Date(c.created_at).getTime() < new Date(sentAt).getTime());
  const draft = ok(
    await s.from("drafts").insert({
      restaurant_id: rid, kind: "email_campaign", content: `*${name}*\n*Subject:* ${subject}\n\n${body}\n\n🎁 *Offer:* ${offer}`,
      audience: `Everyone (${recipients.length} with consent)`, request: TAG, status: "sent", approved_at: clockAt(d, 9.5), sent_at: sentAt, created_at: clockAt(d, 9), updated_at: sentAt,
    }).select("id").single(),
    "campaign draft",
  );
  const c = ok(
    await s.from("campaigns").insert({
      restaurant_id: rid, draft_id: draft.id, name, subject, body, offer, valid_from: sentAt.slice(0, 10),
      valid_until: new Date(new Date(sentAt).getTime() + 4 * DAY).toISOString().slice(0, 10), segment, sent_at: sentAt,
      eligible_count: recipients.length, excluded_count: customers.length - recipients.length, created_at: sentAt,
    }).select("id").single(),
    "campaign",
  );
  const t0 = new Date(sentAt).getTime();
  const later = (hrs) => new Date(Math.min(now - HOUR, t0 + hrs * HOUR)).toISOString();
  const n = recipients.length;
  await insertAll(
    "campaign_sends",
    recipients.map((x, i) => ({
      campaign_id: c.id, restaurant_id: rid, customer_id: x.id, email: x.email, token: token(), kind: "customer", delivery: "email", created_at: sentAt,
      opened_at: i < n * openRate ? later(0.5 + i * 0.2) : null, clicked_at: i < n * clickRate ? later(1 + i * 0.3) : null,
      redeemed_at: i < n * redeemRate ? later(20 + i * 4) : null, expires_at: i < n * redeemRate ? later(20 + i * 4 + 0.17) : null,
    })),
    "campaign sends",
  );
  audit(clockAt(d, 9.5), "approved", `Approved email campaign "${name}"`, draft.id);
  audit(sentAt, "sent", `Sent "${name}" to ${n} customers`, draft.id, "safety rules");
}
await campaign({ d: 40, name: "Monday mangal night", subject: "Mondays just got smokier 🔥", body: "Hi {first_name},\n\nMondays are quiet here, so we're lighting the mangal for you: 15% off all grills, every Monday evening.\n\nAfiyet olsun!", offer: "15% off all grills on Monday evenings", openRate: 0.52, clickRate: 0.2, redeemRate: 0.09 });
await campaign({ d: 26, name: "Künefe week", subject: "Warm künefe, on us", body: "Hi {first_name},\n\nThis week only: order any grill and we'll bring you a warm künefe to finish.\n\nSee you soon!", offer: "Free künefe with any grill", openRate: 0.58, clickRate: 0.24, redeemRate: 0.12 });
await campaign({ d: 12, name: "Tuesday lunch deal", subject: "Lunch for £12 this Tuesday", body: "Hi {first_name},\n\nAdana or chicken shish with bulgur, salad and a drink for £12, every Tuesday lunchtime.\n\nCome hungry!", offer: "Lunch deal for £12", openRate: 0.55, clickRate: 0.22, redeemRate: 0.1 });
await campaign({ d: 4, name: "Mangal for two weekend", subject: "Bring someone hungry this weekend", body: "Hi {first_name},\n\nOur Mixed Mangal for Two comes with free ayran for both of you this Friday to Sunday.\n\nSee you at the grill!", offer: "Free ayran with every Mixed Mangal for Two", openRate: 0.61, clickRate: 0.27, redeemRate: 0.13 });

// ---------- Google posts ----------
const POSTS = [
  [20, "update", "Our adana is hand-minced every morning and grilled over real charcoal. Pop in tonight! 🔥"],
  [16, "offer", "Tuesday lunch: adana or chicken shish with bulgur, salad and a drink for £12."],
  [13, "update", "Fresh pide, straight from the oven to your table. Nothing beats it."],
  [9, "update", "New on the menu: slow-marinated lamb ribs, finished on the mangal."],
  [5, "offer", "This weekend: free ayran with every Mixed Mangal for Two."],
  [2, "update", "Warm künefe with pistachio and clotted cream. The perfect end to any grill. 😋"],
];
for (const [d, topic, text] of POSTS) {
  const when = clockAt(d, 11);
  const draft = ok(
    await s.from("drafts").insert({ restaurant_id: rid, kind: "google_post", content: text, audience: "your Google listing", request: TAG, status: "sent", approved_at: when, sent_at: when, created_at: clockAt(d, 9), updated_at: when }).select("id").single(),
    "post draft",
  );
  ok(await s.from("google_posts").insert({ restaurant_id: rid, draft_id: draft.id, topic, text, published_at: when, google_post_id: `dummy-showcase-${d}`, created_at: when }), "post");
  audit(when, "approved", "Approved a Google post", draft.id);
  audit(when, "sent", "Published a Google post", draft.id, "safety rules");
}
// Past review replies in the log.
for (const rv of reviews.filter((x) => x.replied).slice(-8)) audit(new Date(new Date(rv.created_at).getTime() + 4 * HOUR).toISOString(), "sent", `Replied to ${rv.author_name}'s ${rv.rating}-star review`, null, "safety rules");
// A couple of skips and changes, so every filter on the activity page has something.
audit(clockAt(18, 12), "skipped", "Skipped a Google post (\"we're closed that Sunday\")");
audit(clockAt(9, 13), "edited", "Edited the Tuesday lunch email: \"make it £12 not £13\"");
audit(clockAt(6, 15), "setting", "Changed Sunday hours to 12:00 – 22:00");
audit(clockAt(3, 14), "profile_changed", "Added Lamb Ribs (£18.95) to the menu");
audit(clockAt(1, 23.5), "sales_saved", `Saved ${DAY_NAMES[isoWeekday(addDays(today, -1))]}'s till report`);

// ---------- Waiting for you ----------
const pending = [];
const unanswered = reviews.filter((x) => !x.replied);
for (const rv of unanswered) {
  pending.push({
    kind: "review_reply", review_id: rv.id, audience: rv.author_name, created_at: new Date(new Date(rv.created_at).getTime() + 15 * 60_000).toISOString(),
    content:
      rv.rating <= 3
        ? `Hi ${first(rv.author_name)}, thank you for telling us, and we're really sorry about the wait on Saturday. The grill was flat out and we should have kept you updated. Next time, ask for Ayla and dessert is on us. We'd love the chance to put it right.`
        : `Thank you so much, ${first(rv.author_name)}! We're so happy you enjoyed it. Afiyet olsun, and see you again soon.`,
    check_notes: rv.rating <= 3 ? { flags: ["Offers free dessert: within your recovery offers."] } : null,
  });
}
pending.push({ kind: "google_post", audience: "your Google listing", created_at: at(0, 3), content: "Cold outside, warm by the mangal. 🔥 Our lamb shish is marinated overnight and grilled over real charcoal. See you tonight!" });
const birthdayCount = 3;
pending.push({
  kind: "email_campaign", audience: `Birthdays in the next 7 days (${birthdayCount} customers)`, created_at: at(0, 4),
  content: "*Happy birthday from Dina's*\n*Subject:* A birthday treat, on us 🎂\n\nHi {first_name},\n\nHappy birthday from all of us at the grill! Come in this week and your künefe is on the house.\n\n🎁 *Offer:* Free künefe in your birthday week",
});
// Passed checks, as a real draft carries them (the app's "Approve all" only takes checked ones);
// a draft with a flag note gets a flagged tone check.
const passed = (flags = []) => {
  const r = (status, fl = []) => ({ status, fixes: [], flags: fl, at: new Date().toISOString() });
  return { tone: flags.length ? r("flagged", flags) : r("pass"), facts: r("pass"), compliance: r("pass"), money: r("pass") };
};
const pendingRows = pending.map((p, i) => ({ restaurant_id: rid, status: "pending", request: TAG, version: 1, brief_number: i + 1, updated_at: p.created_at, checks: passed(p.check_notes?.flags), ...p }));
const pendingDrafts = ok(await s.from("drafts").insert(pendingRows).select("id, kind, created_at"), "pending drafts");
const birthdayDraft = pendingDrafts.find((d) => d.kind === "email_campaign");
ok(
  await s.from("campaigns").insert({
    restaurant_id: rid, draft_id: birthdayDraft.id, name: "Birthday week treat", subject: "A birthday treat, on us 🎂",
    body: "Hi {first_name},\n\nHappy birthday from all of us at the grill! Come in this week and your künefe is on the house.", offer: "Free künefe in your birthday week",
    valid_from: today, valid_until: addDays(today, 7), segment: "birthdays_7d", eligible_count: birthdayCount, excluded_count: 0, created_at: birthdayDraft.created_at,
  }),
  "birthday campaign",
);

// ---------- Team, past rotas and next week's suggested rota ----------
const ALL = [1, 2, 3, 4, 5, 6, 7];
const TEAM = [
  { key: "kerem", name: "Kerem (head chef)", roles: ["kitchen"], pence: 1700, max: 45, contracted: 40, days: [2, 3, 4, 5, 6, 7], from: "11:00", to: "23:59" },
  { key: "selin", name: "Selin", roles: ["kitchen"], pence: 1350, max: 40, contracted: 35, days: ALL, from: "11:00", to: "23:59" },
  { key: "baran", name: "Baran", roles: ["kitchen"], pence: 1250, max: 30, contracted: null, days: [1, 2, 3, 4], from: "16:00", to: "23:59" },
  { key: "emre", name: "Emre", roles: ["kitchen"], pence: 1300, max: 24, contracted: null, days: [5, 6, 7], from: "11:00", to: "23:59" },
  { key: "ayla", name: "Ayla (manager)", roles: ["front"], pence: 1550, max: 45, contracted: 40, days: [1, 2, 3, 4, 5, 6], from: "11:00", to: "23:59" },
  { key: "jess", name: "Jess", roles: ["front"], pence: 1250, max: 35, contracted: 30, days: ALL, from: "11:30", to: "23:30" },
  { key: "mert", name: "Mert", roles: ["front"], pence: 1221, max: 16, contracted: null, days: [4, 5, 6], from: "17:00", to: "23:59" },
  { key: "zara", name: "Zara", roles: ["front", "kitchen"], pence: 1221, max: 24, contracted: null, days: [1, 3, 5, 6, 7], from: "12:00", to: "23:00" },
];
const staffRows = ok(
  await s.from("staff").insert(TEAM.map((t) => ({
    restaurant_id: rid, display_name: t.name, roles: t.roles, contracted_hours: t.contracted, max_hours_week: t.max, employment_start: addDays(today, -400),
    age_band: "21_plus", age_band_set_on: addDays(today, -400), source: "synthetic",
  }))).select("id, display_name"),
  "insert staff",
);
const idOf = Object.fromEntries(TEAM.map((t) => [t.key, staffRows.find((x) => x.display_name === t.name).id]));
const byKey = Object.fromEntries(TEAM.map((t) => [t.key, t]));
await insertAll("staff_pay_rates", TEAM.map((t) => ({ restaurant_id: rid, staff_id: idOf[t.key], hourly_pence: t.pence, effective_from: addDays(today, -365), source: "synthetic" })), "pay rates");
await insertAll(
  "staff_availability",
  TEAM.flatMap((t) => t.days.map((wd) => ({ restaurant_id: rid, staff_id: idOf[t.key], weekday: wd, starts: t.from, ends: t.to, kind: "available", effective_from: addDays(today, -365), source: "synthetic" }))),
  "availability",
);
for (const rule of [
  { role: "kitchen", min_on_shift: 2, orders_per_extra_staff: 12 },
  { role: "front", min_on_shift: 1, orders_per_extra_staff: 15 },
]) {
  const res = await s.from("rota_rules").upsert({ restaurant_id: rid, ...rule, source: "synthetic" }, { onConflict: "restaurant_id,role" });
  if (res.error) throw new Error(`rota rules: ${res.error.message}`);
}

// The usual week (ISO weekday -> [person, role, from, to] in minutes).
const h = (x) => Math.round(x * 60);
const PATTERN = {
  1: [["selin", "kitchen", 17, 23], ["baran", "kitchen", 17, 23], ["ayla", "front", 17, 23], ["zara", "front", 18, 23]],
  2: [["kerem", "kitchen", 11.5, 21.5], ["baran", "kitchen", 16, 23], ["ayla", "front", 11.5, 21.5], ["jess", "front", 17, 23]],
  3: [["kerem", "kitchen", 11.5, 21.5], ["selin", "kitchen", 16, 23], ["ayla", "front", 11.5, 21.5], ["jess", "front", 17, 23], ["zara", "front", 18, 22]],
  4: [["kerem", "kitchen", 11.5, 21.5], ["baran", "kitchen", 16, 23], ["selin", "kitchen", 18, 23], ["jess", "front", 11.5, 19.5], ["ayla", "front", 15, 23], ["mert", "front", 18, 23]],
  5: [["kerem", "kitchen", 13, 23.5], ["selin", "kitchen", 11.5, 19.5], ["emre", "kitchen", 17, 23.5], ["ayla", "front", 13, 23.5], ["jess", "front", 11.5, 19.5], ["mert", "front", 17.5, 23.5], ["zara", "front", 18, 23]],
  6: [["kerem", "kitchen", 13, 23.5], ["selin", "kitchen", 11.5, 21.5], ["emre", "kitchen", 16, 23.5], ["zara", "kitchen", 18, 23], ["ayla", "front", 13, 23.5], ["jess", "front", 11.5, 21], ["mert", "front", 17.5, 23.5], [null, "front", 18, 23]],
  7: [["kerem", "kitchen", 11.5, 21.5], ["emre", "kitchen", 12, 22], ["jess", "front", 11.5, 21.5], ["zara", "front", 13, 21]],
};
// The most recent Monday on or before today, then four approved weeks before next week.
const thisMonday = addDays(today, 1 - isoWeekday(today));
const nextMonday = addDays(thisMonday, 7);
const shiftRow = (weekId, date, [k, role, from, to]) => ({
  restaurant_id: rid, rota_week_id: weekId, staff_id: k ? idOf[k] : null, role, business_date: date,
  starts_at: londonInstant(date, h(from)).toISOString(), ends_at: londonInstant(date, h(to)).toISOString(), break_minutes: 0, source: "synthetic",
});
for (let w = 4; w >= 0; w--) {
  const ws = addDays(thisMonday, -7 * w);
  const week = ok(
    await s.from("rota_weeks").insert({ restaurant_id: rid, week_start: ws, status: "published", approved_at: at(7 * w + 3), approved_by: "owner", published_at: at(7 * w + 3), source: "synthetic" }).select("id").single(),
    "past rota week",
  );
  const rows = [];
  for (let i = 0; i < 7; i++) for (const sft of PATTERN[i + 1]) if (sft[0]) rows.push(shiftRow(week.id, addDays(ws, i), sft));
  await insertAll("rota_shifts", rows, "past shifts");
}

// Next week's forecast per day, from the same weekday over the last four weeks.
const dayNet = new Map(salesDays.map((d) => [d.day, d]));
const hourRows = new Map();
for (const x of salesHours) {
  if (!hourRows.has(x.day)) hourRows.set(x.day, []);
  hourRows.get(x.day).push(x);
}
const avgRate = (role) => {
  const p = TEAM.filter((t) => t.roles.includes(role));
  return Math.round(p.reduce((a, t) => a + t.pence, 0) / p.length);
};
const flags = [];
const days = Array.from({ length: 7 }, (_, i) => {
  const date = addDays(nextMonday, i);
  const wd = i + 1;
  const past = [1, 2, 3, 4].map((n) => addDays(date, -7 * n)).filter((d) => dayNet.has(d));
  const salesPence = past.length ? Math.round((past.reduce((a, d) => a + dayNet.get(d).net_sales, 0) / past.length) * 100) : null;
  const orders = past.length ? Math.round(past.reduce((a, d) => a + dayNet.get(d).transactions, 0) / past.length) : null;
  const open = openHours(HOURS[DAY_NAMES[wd]]).length ? [{ start: openHours(HOURS[DAY_NAMES[wd]])[0] * 60, end: (openHours(HOURS[DAY_NAMES[wd]]).at(-1) + 1) * 60 }] : [];
  const shifts = PATTERN[wd].map(([k, role, from, to]) => {
    const hours = Math.round((to - from) * 10) / 10;
    const rate = k ? byKey[k].pence : avgRate(role);
    return { staffId: k ? idOf[k] : null, role, date, start: h(from), end: h(to), name: k ? byKey[k].name : null, hours, costPence: Math.round(hours * rate), ...(k ? {} : { estimated: true }) };
  });
  for (const x of shifts.filter((x) => !x.staffId)) flags.push({ kind: "open_shift", text: `Saturday evening front of house (6pm–11pm) has nobody free yet.`, date: x.date });
  const hoursSum = Math.round(shifts.reduce((a, x) => a + x.hours, 0) * 10) / 10;
  const cost = shifts.reduce((a, x) => a + x.costPence, 0);
  return { date, weekday: wd, open, orders, salesPence, shifts, hours: hoursSum, costPence: cost, labourPct: salesPence ? Math.round((cost / salesPence) * 1000) / 10 : null };
});
const totalCost = days.reduce((a, d) => a + d.costPence, 0);
const totalSales = days.reduce((a, d) => a + (d.salesPence ?? 0), 0);
const byStaff = TEAM.map((t) => {
  const mine = days.flatMap((d) => d.shifts).filter((x) => x.staffId === idOf[t.key]);
  const hrs = Math.round(mine.reduce((a, x) => a + x.hours, 0) * 10) / 10;
  return { staffId: idOf[t.key], name: t.name, hours: hrs, costPence: Math.round(hrs * t.pence), shifts: mine.length };
}).filter((x) => x.shifts);
const plan = {
  basis: "forecast",
  days,
  totals: {
    hours: Math.round(days.reduce((a, d) => a + d.hours, 0) * 10) / 10, costPence: totalCost, salesPence: totalSales, labourPct: Math.round((totalCost / totalSales) * 1000) / 10,
    salesDays: days.filter((d) => d.salesPence).length, openDays: days.filter((d) => d.open.length).length,
    openShiftHours: days.flatMap((d) => d.shifts).filter((x) => !x.staffId).reduce((a, x) => a + x.hours, 0),
  },
  byStaff,
  flags,
  notes: [],
  weekStart: nextMonday,
  restaurant: { name: r.name, brand_color: r.brand_color ?? null },
  builtAt: new Date().toISOString(),
};
const fmt = (p) => `£${(p / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const rotaDraft = ok(
  await s.from("drafts").insert({
    restaurant_id: rid, kind: "rota", status: "pending", request: TAG, version: 1, brief_number: pendingRows.length + 1, created_at: at(0, 2), updated_at: at(0, 2),
    audience: "your team",
    content: `*Rota for next week*\n${plan.totals.hours} hours, about ${fmt(totalCost)} (${plan.totals.labourPct}% of forecast sales, your target is ${r.labour_target_pct ?? 28}%).\nOne open shift: Saturday evening front of house.\n\nApprove to send everyone their shifts, or tell me what to change ("Jess can't do Friday").`,
  }).select("id").single(),
  "rota draft",
);
const rotaShifts = [];
const week = ok(
  await s.from("rota_weeks").insert({ restaurant_id: rid, week_start: nextMonday, status: "draft", source: "synthetic", summary: plan, adjustments: [], draft_id: rotaDraft.id, share_token: randomBytes(18).toString("base64url") }).select("id").single(),
  "next rota week",
);
for (const d of days) for (const x of d.shifts) rotaShifts.push(shiftRow(week.id, d.date, [x.staffId ? TEAM.find((t) => idOf[t.key] === x.staffId).key : null, x.role, x.start / 60, x.end / 60]));
await insertAll("rota_shifts", rotaShifts, "next week's shifts");

await insertAll("audit_log", log, "audit log");

console.log(`${r.name} is filled in:`);
console.log(`  profile: ${Object.keys(fill).length ? Object.keys(fill).join(", ") : "already set, left alone"}`);
console.log(`  sales: ${salesDays.length} days, ${salesHours.length} hourly rows, ${salesLines.length} dish rows; ${weatherNote}`);
console.log(`  ${reviews.length} reviews, ${customers.length} customers, 4 sent campaigns, ${POSTS.length} Google posts`);
console.log(`  team of ${TEAM.length}, 5 past rotas, next week's rota waiting; ${pendingDrafts.length + 1} things waiting for approval; ${log.length} activity entries`);
console.log(`Remove with: node --env-file=.env.local scripts/seed-showcase.mjs ${slug} --remove`);
