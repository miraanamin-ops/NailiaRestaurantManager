// Makes public/samples/pos-export-sample.csv: three days of item sales for
// Ember & Spice Grill (Mon 5 to Wed 7 Oct 2026) in the style of a till export,
// with a title line before the headings, staff and customer columns (which are
// never shown to the AI) and a totals row at the end. Same file every time.
// Usage: node scripts/make-sample-pos-csv.mjs
import { writeFileSync } from "node:fs";

let seed = 20261005;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];

const MENU = [
  ["Grills", "Mixed Grill Platter", 18.5, 5],
  ["Grills", "Lamb Chops (4 pcs)", 13.95, 6],
  ["Grills", "Chicken Tikka", 9.5, 7],
  ["Grills", "Seekh Kebab (2 pcs)", 7.95, 5],
  ["Grills", "Peri Peri Wings (8)", 7.5, 6],
  ["Burgers & Wraps", "Smash Burger", 8.95, 7],
  ["Burgers & Wraps", "Chicken Tikka Wrap", 7.5, 5],
  ["Sides", "Garlic Naan", 2.95, 9],
  ["Sides", "Masala Chips", 3.5, 8],
  ["Sides", "Rice", 2.95, 6],
  ["Drinks & Desserts", "Mango Lassi", 3.95, 6],
  ["Drinks & Desserts", "Karak Chai", 2.5, 5],
  ["Drinks & Desserts", "Kunafa", 5.95, 3],
];
const weighted = MENU.flatMap((m) => Array(m[3]).fill(m));
const STAFF = ["Yusuf", "Amira", "Dan", "Priya"];
const PAY = ["Card", "Card", "Card", "Card", "Cash"];
// Receipts per hour, 12:00 to 22:00 (Monday afternoons are quiet).
const HOURS = { 12: 7, 13: 9, 14: 4, 15: 3, 16: 3, 17: 6, 18: 10, 19: 12, 20: 10, 21: 7, 22: 4 };
const DAYS = [
  ["05/10/2026", 0.8],
  ["06/10/2026", 0.95],
  ["07/10/2026", 1.0],
];

const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const rows = [];
let receipt = 50211;
let total = 0;
for (const [date, busy] of DAYS) {
  for (const [hour, perHour] of Object.entries(HOURS)) {
    const n = Math.round(perHour * busy * (0.75 + rand() * 0.5));
    for (let r = 0; r < n; r++) {
      receipt++;
      const minute = String(Math.floor(rand() * 60)).padStart(2, "0");
      const staff = pick(STAFF);
      const pay = pick(PAY);
      const customer = rand() < 0.2 ? pick(["A. Khan", "J. Smith", "R. Patel", "S. Ahmed"]) : "";
      const lines = 1 + Math.floor(rand() * 4);
      for (let l = 0; l < lines; l++) {
        const [category, item, price] = pick(weighted);
        const qty = rand() < 0.8 ? 1 : 2;
        const line = Math.round(price * qty * 100) / 100;
        total += line;
        rows.push([date, `${hour}:${minute}`, receipt, category, item, qty, price.toFixed(2), line.toFixed(2), "0.00", staff, customer, pay]);
      }
    }
  }
}

const out = [
  "TillPoint - Item Sales Export",
  "Ember & Spice Grill,Period: 05/10/2026 - 07/10/2026",
  "",
  ["Date", "Time", "Receipt No", "Category", "Item", "Qty", "Unit Price", "Line Total", "Discount", "Staff", "Customer", "Payment"].join(","),
  ...rows.map((r) => r.map(q).join(",")),
  ["Total", "", "", "", "", rows.reduce((s, r) => s + r[5], 0), "", total.toFixed(2), "0.00", "", "", ""].join(","),
].join("\r\n");
writeFileSync(new URL("../public/samples/pos-export-sample.csv", import.meta.url), out + "\r\n");
console.log(`made public/samples/pos-export-sample.csv: ${rows.length} lines, ${receipt - 50211} receipts, £${total.toFixed(2)}`);
