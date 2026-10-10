// Makes the sample till report photos in public/samples/ (z-report-1.jpg, -2, -3
// and -bad). Each is drawn as a receipt in HTML, photographed with headless
// Chrome, then saved as a JPEG (the bad one blurred and cut off).
// Only needed again if you change the samples. Needs Chrome or Edge installed.
// Usage: node scripts/make-sample-z-reports.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error("Couldn't find Chrome or Edge");

const OUT = new URL("../public/samples/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "zrep-"));

const line = (l, r = "", cls = "") => `<div class="l ${cls}"><span>${l}</span><span>${r}</span></div>`;
const rule = (ch = "-") => `<div class="rule">${ch.repeat(40)}</div>`;

// 1. Ember & Spice Grill, Thursday: a classic cash register Z reading.
const one = [
  `<div class="c b big">EMBER &amp; SPICE GRILL</div>`,
  `<div class="c">214 Whitechapel Road, London E1 1BJ</div>`,
  `<div class="c">VAT No. GB 284 1937 62</div>`,
  rule("="),
  `<div class="c b">Z REPORT    No. 0412</div>`,
  line("DATE", "08/10/2026"),
  line("TIME", "23:41"),
  line("TERMINAL", "01"),
  rule(),
  line("GROSS SALES", "2,850.50"),
  line("DISCOUNTS", "-42.50"),
  line("REFUNDS", "0.00"),
  line("TOTAL SALES (INC VAT)", "2,808.00", "b"),
  line("VAT @ 20%", "468.00"),
  line("NET SALES", "2,340.00", "b"),
  rule(),
  line("TRANSACTIONS", "118"),
  line("AVG TRANSACTION", "23.80"),
  rule(),
  `<div class="b">PAYMENTS</div>`,
  line("CARD", "2,312.40"),
  line("CASH", "495.60"),
  line("TOTAL TAKEN", "2,808.00", "b"),
  rule(),
  line("NO SALE", "6"),
  line("VOIDS", "3  /  14.85"),
  rule("="),
  `<div class="c">*** Z COUNTERS RESET ***</div>`,
  `<div class="c small">Thank you</div>`,
].join("");

// 2. Ember & Spice Grill, Friday: an app-style end of day report with hours.
const hours = [
  ["14:00", "182.40"], ["15:00", "141.20"], ["16:00", "168.90"], ["17:00", "356.70"], ["18:00", "612.30"],
  ["19:00", "798.40"], ["20:00", "744.10"], ["21:00", "563.80"], ["22:00", "401.20"], ["23:00", "267.60"],
];
const two = [
  `<div class="c b big">Ember &amp; Spice Grill</div>`,
  `<div class="c">End of Day Report</div>`,
  `<div class="c">Friday 9 October 2026</div>`,
  `<div class="c small">Printed 10/10/2026 00:27 · Device: Front counter</div>`,
  rule(),
  `<div class="b">SALES SUMMARY</div>`,
  line("Gross sales", "£4,315.10"),
  line("Discounts", "-£61.00"),
  line("Refunds", "-£18.50"),
  line("Total collected", "£4,236.60", "b"),
  line("Tax (VAT 20%)", "£706.10"),
  line("Net sales", "£3,530.50", "b"),
  line("Transactions", "171"),
  rule(),
  `<div class="b">PAYMENT TYPES</div>`,
  line("Card", "£3,612.80"),
  line("Cash", "£489.30"),
  line("Deliveroo", "£134.50"),
  line("Total", "£4,236.60", "b"),
  rule(),
  `<div class="b">SALES BY HOUR</div>`,
  ...hours.map(([h, v]) => line(h, `£${v}`)),
  rule(),
  `<div class="c small">powered by TillPoint</div>`,
].join("");

// 3. Cardamom Corner Café, Wednesday: a card-terminal style daily report.
const three = [
  `<div class="c b big">CARDAMOM CORNER CAFE</div>`,
  `<div class="c">87 Cranbrook Road, Ilford IG1 4PG</div>`,
  rule("*"),
  `<div class="c b">DAILY REPORT (Z)</div>`,
  line("Business day", "07 Oct 2026"),
  line("Opened", "07:28"),
  line("Closed", "17:09"),
  rule("*"),
  line("Sales count", "112"),
  line("Total incl. VAT", "1,064.85", "b"),
  line("VAT", "177.47"),
  line("Total excl. VAT", "887.38", "b"),
  rule("*"),
  line("Card", "912.35"),
  line("Cash", "152.50"),
  line("Tips", "0.00"),
  rule("*"),
  line("Refunds", "0.00"),
  line("Discounts", "8.40"),
  rule("*"),
  `<div class="c small">End of report</div>`,
].join("");

// The bad one: an Ember & Spice report, blurred, tilted and cut off before the totals.
const bad = [
  `<div class="c b big">EMBER &amp; SPICE GRILL</div>`,
  `<div class="c">214 Whitechapel Road, London E1 1BJ</div>`,
  rule("="),
  `<div class="c b">Z REPORT    No. 0413</div>`,
  line("DATE", "09/10/2026"),
  line("TIME", "23:58"),
  rule(),
  line("GROSS SALES", "4,176.70"),
  line("DISCOUNTS", "-61.00"),
  line("REFUNDS", "-18.50"),
  line("TOTAL SALES (INC VAT)", "4,097.20", "b"),
  line("VAT @ 20%", "682.87"),
  line("NET SALES", "3,414.33", "b"),
].join("");

const page = (body, { tilt = -1.5, extra = "" } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%}
  body{background:radial-gradient(ellipse at 30% 20%,#7a5638,#3d2817 70%);display:flex;justify-content:center;align-items:flex-start;padding-top:60px;box-sizing:border-box}
  .r{width:520px;background:linear-gradient(180deg,#fbfaf6,#f1eee6 40%,#f6f3ec);padding:34px 30px 46px;transform:rotate(${tilt}deg);
     box-shadow:0 18px 40px rgba(0,0,0,.55),0 2px 4px rgba(0,0,0,.4);font:20px/1.42 "Courier New",Consolas,monospace;color:#2b2b2b;letter-spacing:.3px;${extra}}
  .l{display:flex;justify-content:space-between;gap:12px}.c{text-align:center}.b{font-weight:bold}.big{font-size:25px;margin-bottom:4px}
  .small{font-size:15px;color:#555}.rule{overflow:hidden;white-space:nowrap;color:#777;margin:6px 0}
  .r:after{content:"";display:block;height:14px;margin:30px -30px -46px;background:linear-gradient(-45deg,transparent 7px,#3d2817 0) 0 0/14px 14px repeat-x}
</style></head><body><div class="r">${body}</div></body></html>`;

const samples = [
  ["1", page(one, { tilt: -1.2 }), 1450],
  ["2", page(two, { tilt: 1.1 }), 1750],
  ["3", page(three, { tilt: -0.6 }), 1250],
  ["bad", page(bad, { tilt: -6, extra: "opacity:.92;" }), 1000],
];

for (const [name, html, height] of samples) {
  const htmlPath = join(tmp, `z-${name}.html`);
  const pngPath = join(tmp, `z-${name}.png`);
  writeFileSync(htmlPath, html);
  execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=760,${height}`, `--screenshot=${pngPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`], {
    stdio: "ignore",
  });
  // Crop off the empty table below the receipt (the last row with paper in it, plus a margin).
  const { data, info } = await sharp(pngPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bottom = info.height - 1;
  while (bottom > 0 && !data.subarray(bottom * info.width, (bottom + 1) * info.width).some((v) => v > 200)) bottom--;
  // The bad one is cut off just below the date, before any sales figures, and out of focus.
  const keep = name === "bad" ? 300 : Math.min(info.height, bottom + 70);
  let img = sharp(pngPath).extract({ left: 0, top: 0, width: info.width, height: keep });
  if (name === "bad") img = img.blur(3.2).modulate({ brightness: 0.8 });
  const out = new URL(`z-report-${name}.jpg`, OUT);
  await img.jpeg({ quality: 82 }).toFile(out.pathname.replace(/^\/([A-Z]:)/, "$1"));
  console.log(`made public/samples/z-report-${name}.jpg`);
}
