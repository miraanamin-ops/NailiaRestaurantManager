// The spreadsheets we give owners (5 Nov, not yet part of onboarding: waiting for
// the user's sign-off): what each one holds, column by column, its example rows and
// its instructions. workbook.ts turns a spec into an Excel file; read.ts reads the
// filled-in ones back with plain code (no AI). No imports beyond types and plain
// rules, so it's unit-tested (tests/templates.test.ts).
//   menu_costs     pre-filled with the restaurant's own dishes and prices: the owner
//                  fills in what each costs to make (no sellers column: user, 5 Nov)
//   staff          blank, with two example rows: the team for the rota
//   sales_example  an example of the ideal till export (sales item by item), to show
//                  whoever runs their till; nothing to fill in
//   daily_takings  for tills that can't export: one row per day, dates filled in
import { POS_TIPS } from "@/lib/onboarding/dina/ops-content";
import type { MenuCategory } from "@/lib/onboarding/profile-data";
import type { PosMapping } from "@/lib/sales/pos-table";

export type TemplateKind = "menu_costs" | "staff" | "sales_example" | "daily_takings";

export type Column = {
  header: string;
  width: number;
  // A note on the heading cell (Excel shows it on hover).
  note?: string;
  // A dropdown of these values on every row.
  choices?: string[];
  format?: "money" | "number" | "date" | "text" | "time";
  // Pre-filled from our data: shown greyed, not for the owner to change.
  locked?: boolean;
};
export type Row = (string | number | Date | null)[];

export type TemplateSpec = {
  kind: TemplateKind;
  fileName: string;
  sheet: string; // the data tab, read back by this name
  title: string; // shown on the instructions tab
  columns: Column[];
  rows: Row[];
  // Rows shown as examples (grey, italic); read.ts skips them.
  exampleRows?: number[];
  // Empty rows left ready to type into (styled and with the dropdowns).
  blankRows: number;
  instructions: string[];
  brandColor: string; // the heading row's colour
};

const DEFAULT_COLOUR = "#1c1917";
const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "restaurant";
export const EXAMPLE_MARK = "(example)";

// ---------- Menu and costs ----------

export const MENU_COLUMNS = {
  section: "Section",
  dish: "Dish",
  price: "Price (£)",
  cost: "Cost to make (£)",
  exact: "Exact or estimate",
} as const;
export const EXACTNESS = { estimate: "Estimate", exact: "Exact" } as const;
// The last row: one share of the price for every dish left without a cost.
export const ALL_OTHER_DISHES = "All other dishes";

export function menuCostsSpec(r: { name: string; brand_color?: string | null; menu: MenuCategory[] | null }): TemplateSpec {
  const rows: Row[] = [];
  for (const c of r.menu ?? [])
    for (const i of c.items)
      rows.push([c.category, i.name, i.price, typeof i.cost === "number" ? i.cost : null, typeof i.cost === "number" ? (i.cost_estimated === false ? EXACTNESS.exact : EXACTNESS.estimate) : null]);
  rows.push(["", ALL_OTHER_DISHES, null, null, null]);
  return {
    kind: "menu_costs",
    fileName: `${safeName(r.name)}-menu-costs.xlsx`,
    sheet: "Your menu",
    title: `${r.name}: what your dishes cost to make`,
    columns: [
      { header: MENU_COLUMNS.section, width: 18, locked: true },
      { header: MENU_COLUMNS.dish, width: 32, locked: true },
      { header: MENU_COLUMNS.price, width: 11, format: "money", locked: true },
      // Text, so "30%" stays as typed (Excel would turn it into 0.3). read.ts reads £ and %.
      { header: MENU_COLUMNS.cost, width: 17, format: "text", note: "Roughly what the ingredients for one plate cost you. An estimate is fine. You can also write a % of the price, e.g. 30%." },
      { header: MENU_COLUMNS.exact, width: 17, choices: Object.values(EXACTNESS), note: "Leave it as Estimate unless you've worked the cost out properly." },
    ],
    rows,
    blankRows: 0,
    brandColor: r.brand_color || DEFAULT_COLOUR,
    instructions: [
      "Your dishes and prices are already filled in. You only need to fill in the coloured columns.",
      "Cost to make: roughly what the ingredients for one plate cost you. An estimate is fine. You can write £ (4.20) or a share of the price (30%).",
      `Short of time? Fill in your main dishes, then on the last row ("${ALL_OTHER_DISHES}") put one share of the price for the rest, e.g. 30%.`,
      "Exact or estimate: leave it as Estimate unless you've worked the cost out properly.",
      "Don't change the dish names or prices here: change those in your settings.",
      "When you're done, send this file back to me on WhatsApp or in the chat.",
      "Your costs are private: they're never shown to customers. They show which dishes make you the most money, so posts and offers push those and never the thin ones.",
    ],
  };
}

// ---------- Staff ----------

// "Role" keeps its old heading, so sheets downloaded before 12 Nov 2026 still read.
export const STAFF_COLUMNS = {
  name: "Name",
  role: "Role",
  also: "Can also do",
  rate: "Hourly rate (£)",
  contracted: "Contracted hours a week",
  days: "Days they can work",
  times: "Times they can work",
  max: "Most hours a week",
  keys: "Can open and close",
} as const;
// The roles to pick from (lib/rota/rules.ts), plus the all-round ones for anyone who does a bit of everything.
export const ROLE_CHOICES = ["Manager", "Head chef", "Chef", "Kitchen porter", "Server", "Host", "Bar", "Runner", "Counter", "Driver", "Kitchen (all-round)", "Front of house (all-round)"];
export const YES_NO = ["Yes", "No"];

export function staffSpec(r: { name: string; brand_color?: string | null }): TemplateSpec {
  return {
    kind: "staff",
    fileName: `${safeName(r.name)}-team.xlsx`,
    sheet: "Your team",
    title: `${r.name}: your team`,
    columns: [
      { header: STAFF_COLUMNS.name, width: 22 },
      { header: STAFF_COLUMNS.role, width: 22, choices: ROLE_CHOICES, note: "Their main job. Kitchen porter = KP or dishwasher; Counter = takeaway counter, till or phones; Driver = your own drivers only." },
      { header: STAFF_COLUMNS.also, width: 22, note: "Any other roles they can cover, e.g. Counter, Bar. Leave blank if none." },
      { header: STAFF_COLUMNS.rate, width: 15, format: "money" },
      { header: STAFF_COLUMNS.contracted, width: 14, format: "number", note: "Leave blank for zero-hours staff." },
      { header: STAFF_COLUMNS.days, width: 22, note: "In your words: Mon-Fri, weekends, Fri-Sun, Mon Wed Fri. Blank means any day." },
      { header: STAFF_COLUMNS.times, width: 22, note: "In your words: 5pm-11pm, evenings, lunchtimes. Blank means any time." },
      { header: STAFF_COLUMNS.max, width: 13, format: "number", note: "The most hours a week they want, if there's a limit (e.g. students)." },
      { header: STAFF_COLUMNS.keys, width: 14, choices: YES_NO, note: "Yes if they can open up and lock up (they have keys). The rota puts one on every opening and closing shift." },
    ],
    rows: [
      [`Aisha ${EXAMPLE_MARK}`, "Head chef", null, 14.5, 40, "Tue-Sat", null, null, "Yes"],
      [`Tom ${EXAMPLE_MARK}`, "Kitchen porter", null, 12.21, null, "Fri-Sun", "5pm-11pm", 20, "No"],
      [`Sam ${EXAMPLE_MARK}`, "Server", "Counter, Bar", 12.5, null, "Weekends", "Evenings", 16, "No"],
    ],
    exampleRows: [0, 1, 2],
    blankRows: 30,
    brandColor: r.brand_color || DEFAULT_COLOUR,
    instructions: [
      "One row per person. The grey rows are examples: type over them or leave them, they're ignored.",
      "Role: their main job, picked from the list. Manager (or supervisor); Head chef; Chef (cook, sous chef, grill, tandoor); Kitchen porter (KP, dishwasher, pot wash); Server (waiter or waitress); Host (greets and seats); Bar (drinks, barista); Runner (takes food to tables); Counter (takeaway counter, till, phones); Driver (your own delivery drivers, not app riders). Kitchen or Front of house (all-round) for someone who does a bit of everything.",
      "Can also do: any other roles they can cover when you're short, e.g. Counter, Bar. The rota only uses them for it when nobody whose main job it is is free.",
      "Hourly rate: what you pay them an hour, in pounds.",
      "Contracted hours: their hours a week. Leave blank for zero-hours staff.",
      "Days and times they can work: in your own words, e.g. Mon-Fri, weekends, 5pm-11pm, evenings. Blank means any day or any time.",
      "Most hours a week: only if there's a limit (students, second jobs).",
      "Can open and close: Yes for anyone with keys who can open up and lock up.",
      "When you're done, send this file back to me on WhatsApp or in the chat. I use it to suggest your rotas and track labour %.",
    ],
  };
}

// ---------- The ideal till export (an example) ----------

export const SALES_EXAMPLE_COLUMNS = ["Date", "Time", "Receipt no.", "Item", "Quantity", "Net sales (£)", "VAT (£)", "Gross sales (£)"] as const;

export function salesExampleSpec(): TemplateSpec {
  // Two evenings at a made-up grill: what a good "sales by item" export looks like.
  const lines: [string, string, string, string, number, number][] = [
    ["03/11/2026", "12:14", "1001", "Lamb Chops", 1, 14.4],
    ["03/11/2026", "12:14", "1001", "Mango Lassi", 2, 3.6],
    ["03/11/2026", "12:40", "1002", "Mixed Grill", 1, 18],
    ["03/11/2026", "18:05", "1003", "Chicken Wings", 2, 6],
    ["03/11/2026", "18:05", "1003", "Masala Chips", 1, 3.5],
    ["03/11/2026", "19:22", "1004", "Lamb Chops", 2, 14.4],
    ["03/11/2026", "19:22", "1004", "Paneer Tikka", 1, 9.6],
    ["03/11/2026", "20:48", "1005", "Mixed Grill", 1, 18],
    ["04/11/2026", "12:31", "1006", "Chicken Wings", 1, 6],
    ["04/11/2026", "18:47", "1007", "Lamb Chops", 1, 14.4],
    ["04/11/2026", "18:47", "1007", "Mango Lassi", 1, 3.6],
    ["04/11/2026", "19:55", "1008", "Veg Curry", 2, 7.2],
  ];
  const rows: Row[] = lines.map(([date, time, receipt, item, qty, price]) => {
    const gross = Math.round(qty * price * 100) / 100;
    const net = Math.round((gross / 1.2) * 100) / 100;
    return [date, time, receipt, item, qty, net, Math.round((gross - net) * 100) / 100, gross];
  });
  return {
    kind: "sales_example",
    fileName: "example-till-export.xlsx",
    sheet: "Example export",
    title: "What a good till export looks like",
    columns: SALES_EXAMPLE_COLUMNS.map((h) => ({ header: h, width: h === "Item" ? 22 : 14, format: /£/.test(h) ? ("money" as const) : h === "Quantity" ? ("number" as const) : ("text" as const) })),
    rows,
    blankRows: 0,
    brandColor: DEFAULT_COLOUR,
    instructions: [
      "This is an example, not a form: there's nothing to fill in. Show it to whoever runs your till, or use it to find the right report.",
      "The best export has one row per dish sold, with the date and time: it shows which dishes make you the most money and when you're busy.",
      "Ask for the last 12 months, as a CSV or Excel file. Your till's column names will be different, and that's fine: I'll read them.",
      "Net sales (without VAT, tips and service charge) is best. If your till only gives the total with VAT, that's fine too.",
      "The receipt or order number lets me count your orders each day, which makes forecasts more accurate.",
      "If your till can't do sales by item, sales by the hour is next best, then one total per day. One total for the whole year can't be used.",
      "Where to find it on some tills:",
      ...Object.entries(POS_TIPS).map(([till, tip]) => `${till}: ${tip}`),
      "No export at all? Use the daily takings sheet instead: one row per day.",
    ],
  };
}

// ---------- Daily takings (no till export) ----------

export const TAKINGS_COLUMNS = { date: "Date", takings: "Takings, without VAT (£)", orders: "Orders" } as const;

// The importer's mapping for this sheet: a daily summary, net takings, orders as the day's count.
export const DAILY_TAKINGS_MAPPING: PosMapping = {
  date: TAKINGS_COLUMNS.date,
  time: null,
  item: null,
  quantity: TAKINGS_COLUMNS.orders,
  price: TAKINGS_COLUMNS.takings,
  price_is: "line_total",
  receipt: null,
  date_order: "dmy",
  amount_basis: "net",
};

// today: "YYYY-MM-DD" (London). Dates filled in for the last 12 months, newest first.
export function dailyTakingsSpec(r: { name: string; brand_color?: string | null }, today: string): TemplateSpec {
  const rows: Row[] = [];
  const end = Date.parse(`${today}T12:00:00Z`);
  for (let i = 1; i <= 365; i++) rows.push([new Date(end - i * 86_400_000), null, null]);
  return {
    kind: "daily_takings",
    fileName: `${safeName(r.name)}-daily-takings.xlsx`,
    sheet: "Daily takings",
    title: `${r.name}: daily takings`,
    columns: [
      { header: TAKINGS_COLUMNS.date, width: 14, format: "date", locked: true },
      { header: TAKINGS_COLUMNS.takings, width: 24, format: "money", note: "What you took that day, without VAT, tips or service charge. Leave blank if you were closed." },
      { header: TAKINGS_COLUMNS.orders, width: 10, format: "number", note: "How many orders or bills that day, if you know. It makes forecasts more accurate." },
    ],
    rows,
    blankRows: 0,
    brandColor: r.brand_color || DEFAULT_COLOUR,
    instructions: [
      "Only for when your till can't export your sales. If it can, send me that export instead: it has more detail.",
      "The dates are filled in for the last 12 months, newest first. Type what you took each day.",
      "Takings: without VAT, tips or service charge. Leave a day blank if you were closed or don't know.",
      "Orders: how many orders or bills that day, if you know. It makes forecasts more accurate. Fine to leave blank.",
      "Even 8 weeks is enough to start forecasting your quiet and busy days; more is better.",
      "When you're done, send this file back to me on WhatsApp or in the chat.",
    ],
  };
}
