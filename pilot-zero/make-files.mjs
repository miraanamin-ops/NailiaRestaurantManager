// Makes the Pilot Zero test files (pilot-zero/README.md): a year of daily sales
// and six weeks of transactions for a made-up halal food hall in Ilford, in the
// layout of Square's exports, plus a staff sheet and the WhatsApp lines that set
// each person's availability. Always the same output (a fixed random seed), so
// tests/pilot-zero-files.test.ts can check them.
//   node pilot-zero/make-files.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const NAME = "Pilot Zero Food Hall";

// A small seeded random number generator (mulberry32).
let seed = 20261101;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const jitter = (spread) => 1 + (rand() * 2 - 1) * spread;

const DAY = 86_400_000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const weekday = (t) => ((new Date(t).getUTCDay() + 6) % 7) + 1; // Monday = 1
const inRange = (d, from, to) => d >= from && d <= to;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n) => `${n < 0 ? "-" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- The year: 1 Nov 2025 to 31 Oct 2026 ----------

const FIRST = Date.UTC(2025, 10, 1);
const LAST = Date.UTC(2026, 9, 31);

// A usual week (net sales, excluding VAT): quiet Monday to Thursday, Friday
// prayers and the evening, the weekend busiest.
const WEEK = { 1: 1050, 2: 1000, 3: 1100, 4: 1250, 5: 2250, 6: 2650, 7: 2150 };
const SEASON = { 0: 0.88, 1: 0.95, 2: 1.0, 3: 1.02, 4: 1.04, 5: 1.06, 6: 1.08, 7: 1.1, 8: 1.0, 9: 1.0, 10: 1.0, 11: 1.05 };

// Redbridge school holidays 2025/26 (as published for the year; check before relying on them).
const SCHOOL_HOLIDAYS = [
  ["2025-12-22", "2026-01-02"],
  ["2026-02-16", "2026-02-20"],
  ["2026-03-30", "2026-04-10"],
  ["2026-05-25", "2026-05-29"],
  ["2026-07-22", "2026-09-02"],
  ["2026-10-26", "2026-10-30"],
];
// Ramadan 1447 and the two Eids (expected dates; the real ones follow the moon by a day or so).
const RAMADAN = ["2026-02-18", "2026-03-19"];
const LAST_TEN_NIGHTS = "2026-03-10";
const SPECIAL = {
  "2025-12-24": 0.8,
  "2025-12-26": 1.3,
  "2025-12-31": 1.2,
  "2026-01-01": 0.9,
  "2026-03-20": 2.3, // Eid al-Fitr
  "2026-03-21": 1.6,
  "2026-05-27": 2.0, // Eid al-Adha
  "2026-05-28": 1.4,
  "2026-06-13": 1.85, // a big local event: a festival in the park nearby (made up)
};
// Closed: Christmas Day, and three days for a kitchen refit.
export const CLOSED = ["2025-12-25", "2026-07-13", "2026-07-14", "2026-07-15"];

function dayNet(t) {
  const d = ymd(t);
  const wd = weekday(t);
  const month = new Date(t).getUTCMonth();
  const trend = 1 + 0.06 * ((t - FIRST) / (LAST - FIRST)); // 6% growth over the year
  let net = WEEK[wd] * SEASON[month] * trend;
  if (wd <= 5 && SCHOOL_HOLIDAYS.some(([a, b]) => inRange(d, a, b))) net *= 1.15;
  if (inRange(d, RAMADAN[0], RAMADAN[1])) net *= d >= LAST_TEN_NIGHTS ? 1.25 : 1.12;
  net *= SPECIAL[d] ?? 1;
  return round2(net * jitter(0.07));
}

// ---------- Six weeks of transactions: 20 Sep to 31 Oct 2026 ----------

const TX_FIRST = Date.UTC(2026, 8, 20);
const MENU = [
  ["Lamb Shawarma Wrap", 8.5],
  ["Chicken Tikka Box", 9.5],
  ["Mixed Grill Platter", 16.5],
  ["Peri Peri Half Chicken", 10.5],
  ["Lamb Biryani", 11.0],
  ["Falafel Wrap", 7.5],
  ["Smash Burger", 9.0],
  ["Masala Chips", 4.0],
  ["Mango Lassi", 3.5],
  ["Karak Chai", 2.5],
  ["Kunafa", 6.0],
];
// When orders come in (12:00 to 23:00): a lunch bump, the evening peak; on Friday a
// bigger lunch after prayers; in half term, more families in the afternoon.
function hourWeights(t) {
  const wd = weekday(t);
  const halfTerm = inRange(ymd(t), "2026-10-26", "2026-10-30");
  return Array.from({ length: 11 }, (_, i) => {
    const h = 12 + i;
    let w = { 12: 6, 13: 9, 14: 6, 15: 3, 16: 3, 17: 6, 18: 11, 19: 13, 20: 12, 21: 8, 22: 4 }[h];
    if (wd === 5 && (h === 13 || h === 14)) w *= 2;
    if (halfTerm && h >= 12 && h <= 16) w *= 1.5;
    return w;
  });
}
const pickHour = (weights) => {
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return 12 + i;
  return 22;
};

const TX_HEAD = ["Date", "Time", "Time Zone", "Gross Sales", "Discounts", "Service Charges", "Net Sales", "Gift Card Sales", "Tax", "Tip", "Partial Refunds", "Total Collected", "Source", "Card", "Card Entry Methods", "Cash", "Fees", "Net Total", "Transaction ID", "Payment ID", "Card Brand", "PAN Suffix", "Device Name", "Staff Name", "Details", "Description", "Event Type", "Location", "Dining Option", "Customer ID", "Customer Name"];
const TILL_STAFF = ["Aisha", "Daniel", "Zara", "Sana"];
const dmy = (t) => {
  const [y, m, d] = ymd(t).split("-");
  return `${d}/${m}/${y}`;
};

const txRows = [TX_HEAD.map(q).join(",")];
// Square's Item sales export: one row per dish line of each payment.
const ITEM_HEAD = ["Date", "Time", "Time Zone", "Category", "Item", "Qty", "Price Point Name", "Gross Sales", "Discounts", "Net Sales", "Tax", "Transaction ID", "Payment ID", "Device Name", "Event Type", "Location", "Dining Option"];
const itemRows = [ITEM_HEAD.map(q).join(",")];
// Which counter (the menu's sections, dummy-menu.pdf) each dish comes from.
const COUNTER_OF = {
  "Lamb Shawarma Wrap": "Shawarma Corner",
  "Falafel Wrap": "Shawarma Corner",
  "Chicken Tikka Box": "Charcoal Grill",
  "Mixed Grill Platter": "Charcoal Grill",
  "Peri Peri Half Chicken": "Charcoal Grill",
  "Lamb Biryani": "Biryani House",
  "Smash Burger": "Smash Burgers",
  "Masala Chips": "Smash Burgers",
  "Mango Lassi": "Sweets & Drinks",
  "Karak Chai": "Sweets & Drinks",
  Kunafa: "Sweets & Drinks",
};
const txNet = {}; // each day's net sales from its transactions (refunds included)
const txOrders = {};
let txId = 0;
const REFUNDS = { "2026-09-27": 14.5, "2026-10-10": 9.5, "2026-10-24": 21.0 };
for (let t = TX_FIRST; t <= LAST; t += DAY) {
  const d = ymd(t);
  if (CLOSED.includes(d)) continue;
  const target = dayNet(t);
  const weights = hourWeights(t);
  const orders = [];
  let net = 0;
  while (net < target) {
    const lines = 1 + Math.floor(rand() * 3);
    const items = Array.from({ length: lines }, () => MENU[Math.floor(rand() * MENU.length)]);
    const gross = items.reduce((s, [, p]) => s + p, 0);
    const n = round2(gross / 1.2);
    orders.push({ hour: pickHour(weights), minute: Math.floor(rand() * 60), items, gross: round2(gross), net: n });
    net += n;
  }
  orders.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  for (const o of orders) {
    const tax = round2(o.gross - o.net);
    const tip = rand() < 0.08 ? 1 : 0;
    const cash = rand() < 0.12;
    const total = round2(o.gross + tip);
    const id = `PZ${String(txId++).padStart(6, "0")}`;
    const time = `${String(o.hour).padStart(2, "0")}:${String(o.minute).padStart(2, "0")}:00`;
    const description = o.items.map(([name]) => name).join(", ");
    txRows.push(
      [dmy(t), time, "Europe/London", money(o.gross), "£0.00", "£0.00", money(o.net), "£0.00", money(tax), money(tip), "£0.00", money(total), "Point of Sale", cash ? "£0.00" : money(total), cash ? "" : "Contactless", cash ? money(total) : "£0.00", cash ? "£0.00" : money(-round2(total * 0.0175)), money(cash ? total : round2(total * 0.9825)), id, `P${id}`, cash ? "" : "Visa", cash ? "" : "4242", "Counter iPad", TILL_STAFF[txId % TILL_STAFF.length], "", description, "Payment", NAME, rand() < 0.6 ? "Eat in" : "Takeaway", "", ""]
        .map(q)
        .join(","),
    );
    // The same order, dish by dish, for the Item sales export (no extra random draws,
    // so the other files stay exactly as they were).
    const qty = new Map();
    for (const [name, price] of o.items) qty.set(name, { price, n: (qty.get(name)?.n ?? 0) + 1 });
    for (const [name, { price, n }] of qty) {
      const gross = round2(price * n);
      const itemNet = round2(gross / 1.2);
      itemRows.push([dmy(t), time, "Europe/London", COUNTER_OF[name], name, n, "Regular", money(gross), "£0.00", money(itemNet), money(round2(gross - itemNet)), id, `P${id}`, "Counter iPad", "Payment", NAME, "Eat in"].map(q).join(","));
    }
  }
  let dayTotal = round2(orders.reduce((s, o) => s + o.net, 0));
  if (REFUNDS[d]) {
    const gross = REFUNDS[d];
    const n = round2(gross / 1.2);
    const id = `RF${String(txId++).padStart(6, "0")}`;
    txRows.push([dmy(t), "21:40:00", "Europe/London", money(-gross), "£0.00", "£0.00", money(-n), "£0.00", money(-round2(gross - n)), "£0.00", "£0.00", money(-gross), "Point of Sale", money(-gross), "Contactless", "£0.00", "£0.00", money(-gross), id, `P${id}`, "Visa", "4242", "Counter iPad", "Sana", "", "Refund: wrong order", "Refund", NAME, "Takeaway", "", ""].map(q).join(","));
    dayTotal = round2(dayTotal - n);
  }
  txNet[d] = dayTotal;
  txOrders[d] = orders.length;
}
writeFileSync(join(OUT, "square-transactions-6-weeks.csv"), txRows.join("\r\n") + "\r\n");
writeFileSync(join(OUT, "square-item-sales-6-weeks.csv"), itemRows.join("\r\n") + "\r\n");

// ---------- The year's Sales summary (the last six weeks match the transactions) ----------

const sumRows = [["Date", "Gross Sales", "Returns", "Discounts & Comps", "Net Sales", "Tax", "Tips", "Total Collected"].map(q).join(",")];
let yearNet = 0;
for (let t = FIRST; t <= LAST; t += DAY) {
  const d = ymd(t);
  if (CLOSED.includes(d)) continue; // Square leaves out days with no sales
  const net = txNet[d] ?? dayNet(t);
  const discounts = round2(net * 0.01);
  const tax = round2(net * 0.2);
  const gross = round2(net + tax + discounts);
  yearNet += net;
  const date = new Date(t);
  sumRows.push([`${MON[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`, money(gross), "£0.00", money(-discounts), money(net), money(tax), "£0.00", money(round2(net + tax))].map(q).join(","));
}
writeFileSync(join(OUT, "square-sales-summary-12-months.csv"), sumRows.join("\r\n") + "\r\n");

// ---------- The team: 10 people, all at or above £12.71 an hour ----------
// The National Living Wage from April 2026 is £12.71 an hour (21 and over).

export const STAFF = [
  { name: "Yusuf Rahman", role: "Manager", rate: 15.5, hours: 40, days: "Mon-Fri", times: "", max: 45, notes: "Site manager" },
  { name: "Sana Akhtar", role: "Manager", rate: 14.2, hours: 30, days: "Thu-Sun", times: "12pm-11pm", max: 36, notes: "Assistant manager, covers weekends" },
  { name: "Bilal Hussain", role: "Kitchen", rate: 13.8, hours: 40, days: "Weekdays", times: "", max: 40, notes: "Head cook" },
  { name: "Imran Qureshi", role: "Kitchen", rate: 13.2, hours: 32, days: "Wed-Sun", times: "Evenings", max: 35, notes: "Grill" },
  { name: "Farah Begum", role: "Kitchen", rate: 12.71, hours: 16, days: "Weekends", times: "", max: 20, notes: "" },
  { name: "Tomasz Nowak", role: "Kitchen", rate: 13.0, hours: 24, days: "Mon Tue Wed Thu", times: "12pm-6pm", max: 25, notes: "Prep" },
  { name: "Aisha Patel", role: "Front of house", rate: 12.71, hours: 20, days: "Fri-Sun", times: "5pm-11pm", max: 20, notes: "" },
  { name: "Daniel Mensah", role: "Front of house", rate: 12.9, hours: 30, days: "Every day", times: "Lunchtimes", max: 30, notes: "" },
  { name: "Zara Ali", role: "Front of house", rate: 12.71, hours: 12, days: "Weekends", times: "", max: 12, notes: "Student, term time only" },
  { name: "Hamza Siddiqui", role: "Delivery", rate: 12.75, hours: 25, days: "Thu-Sun", times: "Evenings", max: 28, notes: "Own car" },
];
writeFileSync(
  join(OUT, "staff-sheet.csv"),
  [
    ["Name", "Role", "Hourly rate", "Contracted hours", "Days available", "Times available", "Max hours a week", "Notes"].map(q).join(","),
    ...STAFF.map((s) => [s.name, s.role, `£${s.rate.toFixed(2)}`, s.hours, s.days, s.times || "Any time", s.max, s.notes].map(q).join(",")),
  ].join("\r\n") + "\r\n",
);
writeFileSync(
  join(OUT, "staff-availability-messages.txt"),
  STAFF.map((s) => `add ${s.name}, ${s.role.toLowerCase()}, £${s.rate.toFixed(2)}, ${s.days.toLowerCase()}${s.times ? `, ${s.times.toLowerCase()}` : ""}, max ${s.max} hours`).join("\n") + "\n",
);

console.log(`${sumRows.length - 1} days of sales, £${yearNet.toFixed(2)} net; ${txRows.length - 1} transaction rows over ${Object.keys(txNet).length} days; ${STAFF.length} staff`);
