// Reading a POS export (CSV or Excel) into a table, and turning its rows into
// sale lines with a column mapping. Plain code apart from node:crypto, so it's
// unit-tested (tests/sales.test.ts). Reading .xlsx files is in ./pos-file.ts.
import { createHash } from "node:crypto";
import { londonParts } from "@/lib/clock";
import { round2 } from "./format";

export type Cell = string | number | boolean | Date | null;
export type Table = { headers: string[]; rows: Cell[][] };

// Which column means what. Columns are named by their heading, so a file with
// the same headings in a different order still works.
export type PosMapping = {
  date: string; // may also hold the time ("09/10/2026 18:42")
  time: string | null;
  item: string;
  quantity: string | null; // none: each line is one item
  price: string;
  price_is: "line_total" | "unit_price";
  receipt: string | null; // order or receipt number, to count sales
  date_order: "dmy" | "mdy" | "ymd";
};

export type SaleLine = { day: string; hour: number | null; item: string; quantity: number; amount: number; receipt: string | null };

export const MAX_ROWS = 50_000;

// ---------- CSV ----------

// A small CSV reader: quotes, "" inside quotes, commas/semicolons/tabs, CRLF.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- Finding the table ----------

const filled = (r: Cell[]) => r.filter((c) => c !== null && String(c).trim() !== "").length;
const isNumberish = (c: Cell) => typeof c === "number" || (typeof c === "string" && /^[-£$€(]*[\d,.]+\)?$/.test(c.trim()));

// Many exports start with a title and a date range before the real headings. The
// heading row is the first with 3+ filled cells, mostly words, followed by data.
export function toTable(raw: Cell[][]): Table | null {
  for (let i = 0; i < Math.min(raw.length - 1, 30); i++) {
    const r = raw[i];
    if (filled(r) < 3 || filled(raw[i + 1] ?? []) < 2) continue;
    const words = r.filter((c) => c !== null && String(c).trim() !== "" && !isNumberish(c) && !(c instanceof Date)).length;
    if (words < filled(r) * 0.7) continue;
    const headers = r.map((c, j) => (c === null || String(c).trim() === "" ? `Column ${j + 1}` : String(c).trim()));
    const rows = raw.slice(i + 1, i + 1 + MAX_ROWS).filter((row) => filled(row) > 0);
    return { headers, rows };
  }
  return null;
}

// A fingerprint of the headings: the same POS export always has the same one.
export function layoutSignature(headers: string[]) {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim()).join("|");
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

// What the AI is shown to suggest a mapping: the headings and a few rows, with
// anything that looks personal blanked out (customer, staff and card columns, emails, phone numbers).
const PERSONAL_HEADING = /(customer|client|guest|e-?mail|phone|mobile|card ?(no|number|holder)|address|post ?code|staff|employee|server|cashier|waiter|user)/i;
export function sampleForAi(table: Table, n = 8) {
  const blank = table.headers.map((h) => PERSONAL_HEADING.test(h));
  const rows = table.rows.slice(0, n).map((r) =>
    table.headers.map((_, j) => {
      if (blank[j]) return "[hidden]";
      const c = r[j];
      if (c instanceof Date) return c.toISOString();
      const s = c === null || c === undefined ? "" : String(c);
      if (s.includes("@")) return "[email]";
      if (/\d{9,}/.test(s.replace(/\s/g, ""))) return "[number]";
      return s.slice(0, 60);
    }),
  );
  return { headers: table.headers, rows };
}

// ---------- Reading cells ----------

export function parseMoney(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  let s = c.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-") || s.endsWith("-");
  s = s.replace(/[()£$€\s-]/g, "").replace(/GBP/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // "12,50"
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

// An hour from "18:42", "6:42 PM", "18.42", or a fraction of a day (Excel times).
export function parseHour(c: Cell): number | null {
  if (c instanceof Date) return c.getUTCHours();
  if (typeof c === "number") return c >= 0 && c < 1 ? Math.floor(c * 24 + 1e-9) : null;
  if (typeof c !== "string") return null;
  const m = c.match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return h >= 0 && h <= 23 ? h : null;
}

// A day (and the hour, if the cell has a time too) from a date cell.
export function parseDate(c: Cell, order: PosMapping["date_order"]): { day: string; hour: number | null } | null {
  if (c instanceof Date) {
    // Excel dates come through as UTC wall-clock times.
    const hasTime = c.getUTCHours() || c.getUTCMinutes();
    return { day: ymd(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate())!, hour: hasTime ? c.getUTCHours() : null };
  }
  if (typeof c === "number") {
    // An Excel serial date (days since 30 Dec 1899), possibly with a time.
    if (c < 30000 || c > 80000) return null;
    const ms = Math.round((c - 25569) * 86_400_000);
    const d = new Date(ms);
    const frac = c % 1;
    return { day: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())!, hour: frac ? d.getUTCHours() : null };
  }
  if (typeof c !== "string") return null;
  const s = c.trim();
  if (!s) return null;
  // ISO with a time zone ("2026-10-09T17:42:00Z"): convert to London time.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const p = londonParts(new Date(s));
    return { day: ymd(p.year, p.month, p.day)!, hour: p.hour };
  }
  // A time after the date ("09/10/2026 18:42", "2026-10-09T18:42", "Oct 9, 2026 6:42 PM").
  const time = s.match(/[\sT](\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[ap]\.?m\.?)?)/i);
  const hour = time ? parseHour(time[1]) : null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const day = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    return day ? { day, hour } : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [a, b] = [Number(m[1]), Number(m[2])];
    const day = order === "mdy" ? ymd(y, a, b) : ymd(y, b, a);
    return day ? { day, hour } : null;
  }
  // "9 Oct 2026", "09-Oct-2026", "Oct 9, 2026", "Fri 9 Oct 2026"
  m = s.replace(/^[a-z]{3,9},?\s+(?=\d)/i, "").match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{4})/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    const day = ymd(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
    return day ? { day, hour } : null;
  }
  m = s.match(/^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) {
    const day = ymd(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
    return day ? { day, hour } : null;
  }
  return null;
}

// ---------- Applying a mapping ----------

export type MappingProblem = string;

// Every heading the mapping uses must exist in the file.
export function mappingProblems(headers: string[], m: PosMapping): MappingProblem[] {
  const problems: string[] = [];
  const need: [string, string | null][] = [
    ["date", m.date],
    ["item", m.item],
    ["price", m.price],
    ["time", m.time],
    ["quantity", m.quantity],
    ["receipt", m.receipt],
  ];
  for (const [what, h] of need) if (h !== null && !headers.includes(h)) problems.push(`There's no "${h}" column for the ${what}.`);
  return problems;
}

export function applyMapping(table: Table, m: PosMapping) {
  const col = (h: string | null) => (h === null ? -1 : table.headers.indexOf(h));
  const [iDate, iTime, iItem, iQty, iPrice, iReceipt] = [m.date, m.time, m.item, m.quantity, m.price, m.receipt].map(col);
  const lines: SaleLine[] = [];
  let skipped = 0;
  for (const r of table.rows) {
    const date = parseDate(r[iDate] ?? null, m.date_order);
    const item = String(r[iItem] ?? "").trim();
    const price = parseMoney(r[iPrice] ?? null);
    const qty = iQty >= 0 ? parseMoney(r[iQty] ?? null) : 1;
    // Totals rows, blank lines and anything we can't read are skipped (and counted).
    if (!date || !item || price === null || qty === null || qty === 0 || /^(sub ?)?totals?$/i.test(item)) {
      skipped++;
      continue;
    }
    const hour = iTime >= 0 && iTime !== iDate ? parseHour(r[iTime] ?? null) : date.hour;
    const amount = m.price_is === "unit_price" ? price * qty : price;
    const receipt = iReceipt >= 0 && r[iReceipt] !== null && String(r[iReceipt]).trim() ? String(r[iReceipt]).trim() : null;
    lines.push({ day: date.day, hour, item: item.slice(0, 120), quantity: round2(qty), amount: round2(amount), receipt });
  }
  return { lines, skipped };
}

// A mapping "works" if most rows turn into sale lines.
export function mappingWorks(table: Table, m: PosMapping) {
  if (mappingProblems(table.headers, m).length) return false;
  const sample: Table = { headers: table.headers, rows: table.rows.slice(0, 200) };
  const { lines } = applyMapping(sample, m);
  return sample.rows.length > 0 && lines.length >= Math.max(1, sample.rows.length * 0.6);
}

// A fingerprint per sale line, so the same period uploaded twice is skipped.
// Identical lines in one file (two lattes at the same minute) are told apart by
// how many times they've appeared so far.
export function rowKeys(lines: SaleLine[]) {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [l.day, l.hour ?? "", l.item.toLowerCase(), l.quantity, l.amount, l.receipt ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}#${n}`).digest("hex").slice(0, 32);
  });
}

// Day totals from sale lines.
export function dayTotals(lines: Pick<SaleLine, "day" | "hour" | "amount" | "receipt">[]) {
  const days = new Map<string, { gross: number; receipts: Set<string>; hasReceipts: boolean; hours: Map<number, number> }>();
  for (const l of lines) {
    const d = days.get(l.day) ?? { gross: 0, receipts: new Set<string>(), hasReceipts: false, hours: new Map<number, number>() };
    d.gross += l.amount;
    if (l.receipt) {
      d.receipts.add(l.receipt);
      d.hasReceipts = true;
    }
    if (l.hour !== null) d.hours.set(l.hour, (d.hours.get(l.hour) ?? 0) + l.amount);
    days.set(l.day, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({
      day,
      gross: round2(d.gross),
      transactions: d.hasReceipts ? d.receipts.size : null,
      hours: [...d.hours.entries()].sort(([a], [b]) => a - b).map(([hour, sales]) => ({ hour, sales: round2(sales) })),
    }));
}

// What the owner is shown to check a mapping: "Date → 'Sale Date'" etc.
export function describeMapping(m: PosMapping) {
  const lines = [
    `Date → "${m.date}"`,
    m.time && m.time !== m.date ? `Time → "${m.time}"` : m.time === m.date ? `Time → in "${m.date}"` : "Time → (none)",
    `Item → "${m.item}"`,
    `Quantity → ${m.quantity ? `"${m.quantity}"` : "(none: 1 each)"}`,
    `Price → "${m.price}" (${m.price_is === "unit_price" ? "price each" : "line total"})`,
  ];
  if (m.receipt) lines.push(`Receipt → "${m.receipt}"`);
  return lines;
}
