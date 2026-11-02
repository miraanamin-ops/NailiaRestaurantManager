// Writes the daily-takings sample files for tests/daily-sales.test.ts (70 days, 1 Aug to 9 Oct 2026).
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const days = [];
for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2026, 9, 9); t += 86_400_000) days.push(new Date(t));
const gross = (i) => 900 + ((i * 137) % 700) + (days[i].getUTCDay() === 5 || days[i].getUTCDay() === 6 ? 650 : 0) + 0.5;
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const iso = (d) => d.toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (n) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const q = (s) => `"${s}"`;

// Square: Sales summary, by day.
writeFileSync(`${out}/square-sales-summary.csv`, [
  ["Date", "Gross Sales", "Returns", "Discounts & Comps", "Net Sales", "Tax", "Tips", "Total Collected"].map(q).join(","),
  ...days.map((d, i) => { const g = gross(i); const net = Math.round(((g - 10) / 1.2) * 100) / 100; return [`${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, money(g), "£0.00", "-£10.00", money(net), money(g - 10 - net), "£0.00", money(g - 10)].map(q).join(","); }),
].join("\r\n") + "\r\n");

// Lightspeed K-Series: Monthly Turnover, one row per day.
writeFileSync(`${out}/lightspeed-monthly-turnover.csv`, [
  "Date,Receipts,Turnover excl. VAT,VAT,Turnover incl. VAT",
  ...days.map((d, i) => { const g = gross(i); return `${iso(d)},${40 + (i % 30)},${(g / 1.2).toFixed(2)},${(g - g / 1.2).toFixed(2)},${g.toFixed(2)}`; }),
].join("\n") + "\n");

// Epos Now: Sales Report, Time Period, by day, with its title lines and a total row.
writeFileSync(`${out}/epos-now-sales-report.csv`, [
  "Sales Report",
  `Time Period: ${dmy(days[0])} - ${dmy(days.at(-1))}`,
  "",
  "Time Interval,Transactions,Gross Sales,Discount,Net Sales,Tax,Total",
  ...days.map((d, i) => { const g = gross(i); return `${dmy(d)} 00:00 - ${dmy(d)} 23:59,${40 + (i % 30)},${g.toFixed(2)},0.00,${(g / 1.2).toFixed(2)},${(g - g / 1.2).toFixed(2)},${g.toFixed(2)}`; }),
  `Total,,${days.reduce((s, _, i) => s + gross(i), 0).toFixed(2)},,,,`,
].join("\r\n") + "\r\n");

// Messy: title rows, a "Period:" line, £ signs, commas in numbers, a blank line and a totals row.
const rows = days.map((d, i) => `${dmy(d)},${DOW[d.getUTCDay()]},${q(money(gross(i)))}`);
rows.splice(30, 0, "");
writeFileSync(`${out}/messy-daily-takings.csv`, [
  "Ember & Spice Grill - Takings",
  "Generated: 01/11/2026 09:14",
  `Period:,${dmy(days[0])} - ${dmy(days.at(-1))}`,
  "",
  "Date,Day,Takings",
  ...rows,
  `Total,,${q(money(days.reduce((s, _, i) => s + gross(i), 0)))}`,
].join("\n") + "\n");
// Square: Transactions export, one row per payment (and one refund), no item column.
{
  const head = ["Date","Time","Time Zone","Gross Sales","Discounts","Service Charges","Net Sales","Gift Card Sales","Tax","Tip","Partial Refunds","Total Collected","Source","Card","Card Entry Methods","Cash","Fees","Net Total","Transaction ID","Payment ID","Card Brand","PAN Suffix","Device Name","Staff Name","Details","Description","Event Type","Location","Dining Option","Customer ID","Customer Name"];
  const rows = [head.map(q).join(",")];
  days.forEach((d, i) => {
    const n = 10 + (i % 7);
    for (let k = 0; k < n; k++) {
      const net = 18 + ((i * 7 + k * 13) % 40) + 0.5;
      const tax = Math.round(net * 0.2 * 100) / 100;
      const tip = k % 4 === 0 ? 2 : 0;
      const id = `TX${String(i).padStart(3, "0")}${String(k).padStart(2, "0")}AbC`;
      rows.push([dmy(d), `${String(12 + (k % 10)).padStart(2, "0")}:${String((k * 7) % 60).padStart(2, "0")}:00`, "Europe/London", money(net + tax), "£0.00", "£0.00", money(net), "£0.00", money(tax), money(tip), "£0.00", money(net + tax + tip), "Point of Sale", money(net + tax + tip), "Contactless", "£0.00", `-${money(0.3)}`, money(net + tax + tip - 0.3), id, `P${id}`, "Visa", "4242", "Counter iPad", "Sam", "", k % 2 ? "Mixed Grill, Chips" : "2 x Lamb Chops", "Payment", "Ember & Spice Grill", "Eat in", "", ""].map(q).join(","));
    }
    if (i === 4) rows.push([dmy(d), "21:10:00", "Europe/London", "-£15.00", "£0.00", "£0.00", "-£12.50", "£0.00", "-£2.50", "£0.00", "£0.00", "-£15.00", "Point of Sale", "-£15.00", "Contactless", "£0.00", "£0.00", "-£15.00", "RF00400AbC", "PRF00400AbC", "Visa", "4242", "Counter iPad", "Sam", "", "Refund: Mixed Grill", "Refund", "Ember & Spice Grill", "Eat in", "", ""].map(q).join(","));
  });
  writeFileSync(`${out}/square-transactions.csv`, rows.join("\r\n") + "\r\n");
}

console.log("total", days.reduce((s, _, i) => s + gross(i), 0).toFixed(2), "first", gross(0), "days", days.length);
