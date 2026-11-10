// Importing a customer list: the plain-code rules (no database), unit-tested in
// tests/customer-import.test.ts. Reading the columns, cleaning the rows, the legal
// basis and the declaration, what the owner is told, when sending pauses.
import { createHash } from "node:crypto";

export type Cell = string | number | boolean | Date | null | undefined;
export type Table = { headers: string[]; rows: Cell[][] };

// Which column holds what (column numbers; null = not in the file).
export type Mapping = { email: number | null; name: number | null; phone: number | null; birthday: number | null };
export type ImportRow = { email: string; name: string | null; phone: string | null; birthday: string | null };

// During the pilot.
export const MAX_IMPORT_ROWS = 5000;
// Welcome (or confirm) emails per restaurant per day, and per hourly run, so a new
// list doesn't hurt the shared sending domain (and stays inside Resend's plan).
export const IMPORT_EMAILS_PER_DAY = 50;
export const IMPORT_EMAILS_PER_RUN = 10;
// A batch's bounce rate over this pauses that import's sending.
export const BOUNCE_PAUSE_RATE = 0.05;
// Below this many sends the rate isn't judged yet, unless this many have already bounced.
export const BOUNCE_MIN_SENT = 20;
export const BOUNCE_MIN_COUNT = 3;

export const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i;
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

export function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// ---------- The columns ----------

const PHONE = /^\+?[\d\s()-]{7,}$/;
const DATE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/;

// What each column looks like, without the data itself (this is all an AI sees: no
// names, emails or numbers ever leave the restaurant's data).
export function columnShapes(table: Table, sample = 50) {
  const rows = table.rows.slice(0, sample);
  return table.headers.map((header, i) => {
    const cells = rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    const share = (re: RegExp) => (cells.length ? Math.round((cells.filter((c) => re.test(c)).length / cells.length) * 100) : 0);
    const words = cells.length ? Math.round(cells.reduce((n, c) => n + c.split(/\s+/).length, 0) / cells.length) : 0;
    return { column: i, header: String(header ?? "").slice(0, 60), filled_pct: rows.length ? Math.round((cells.length / rows.length) * 100) : 0, email_like_pct: share(EMAIL), phone_like_pct: share(PHONE), date_like_pct: share(DATE) || (rows.some((r) => r[i] instanceof Date) ? 100 : 0), avg_words: words };
  });
}

// The columns by their headings and contents (used when the AI isn't available, and to check the AI).
export function ruleMapping(table: Table): Mapping {
  const h = table.headers.map((x) => norm(String(x ?? "")));
  const shapes = columnShapes(table);
  let email = h.findIndex((x) => x.includes("email") || x === "mail");
  if (email === -1) {
    const best = shapes.reduce((a, b) => (b.email_like_pct > a.email_like_pct ? b : a), shapes[0] ?? { column: -1, email_like_pct: 0 });
    email = best && best.email_like_pct >= 50 ? best.column : -1;
  }
  const find = (test: (x: string) => boolean) => {
    const i = h.findIndex((x, n) => n !== email && test(x));
    return i === -1 ? null : i;
  };
  const first = find((x) => x === "firstname" || x === "forename" || x === "givenname");
  const name = first ?? find((x) => x === "name" || x === "fullname" || x === "customername" || x === "customer" || x === "guestname" || x === "guest");
  const phone = find((x) => x.includes("phone") || x.includes("mobile") || x === "tel" || x === "telephone" || x === "cell");
  const birthday = find((x) => x.includes("birthday") || x.includes("dateofbirth") || x === "dob" || x === "birthdate");
  return { email: email === -1 ? null : email, name, phone, birthday };
}

// A mapping is usable if its email column really holds emails. Problems, or [].
export function mappingProblems(table: Table, m: Mapping): string[] {
  const shapes = columnShapes(table);
  const n = table.headers.length;
  const problems: string[] = [];
  for (const [field, col] of Object.entries(m)) if (col !== null && (col < 0 || col >= n)) problems.push(`${field}: column ${col} isn't in the file`);
  if (m.email === null) problems.push("no email column");
  else if ((shapes[m.email]?.email_like_pct ?? 0) < 50) problems.push(`column "${table.headers[m.email]}" doesn't hold email addresses`);
  const used = Object.values(m).filter((c): c is number => c !== null);
  if (new Set(used).size !== used.length) problems.push("one column is used for two things");
  return problems;
}

// Does this spreadsheet look like a customer list (rather than sales)? An email column, and no money columns.
export function looksLikeCustomerList(table: Table) {
  const m = ruleMapping(table);
  if (m.email === null || mappingProblems(table, m).length) return false;
  const money = table.headers.some((x) => /\b(net|gross|vat|qty|quantity|price|amount|sales|total|revenue|takings)\b/i.test(String(x ?? "")));
  return !money;
}

// ---------- The rows ----------

export function birthdayFrom(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return validDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}
const validDate = (y: number, mo: number, d: number) =>
  y >= 1900 && y <= new Date().getFullYear() && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

const phoneFrom = (v: Cell) => {
  const t = String(v ?? "").trim();
  return PHONE.test(t) ? t.replace(/[^\d+]/g, "").slice(0, 20) : null;
};

export type Cleaned = {
  rows: ImportRow[];
  counts: { total: number; invalid: number; duplicate: number; existing: number; suppressed: number; to_add: number };
};

// Every row checked: a valid email, not twice in the file, not already on the list,
// and never anyone who unsubscribed, deleted their data or hard-bounced before.
export function cleanRows(table: Table, m: Mapping, existing: Set<string>, suppressed: Set<string>): Cleaned {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const counts = { total: table.rows.length, invalid: 0, duplicate: 0, existing: 0, suppressed: 0, to_add: 0 };
  for (const r of table.rows) {
    const email = String(m.email === null ? "" : (r[m.email] ?? "")).trim().toLowerCase();
    if (!EMAIL.test(email)) {
      counts.invalid++;
      continue;
    }
    if (seen.has(email)) {
      counts.duplicate++;
      continue;
    }
    seen.add(email);
    if (suppressed.has(emailHash(email))) {
      counts.suppressed++;
      continue;
    }
    if (existing.has(email)) {
      counts.existing++;
      continue;
    }
    const rawName = m.name === null ? "" : String(r[m.name] ?? "").trim();
    rows.push({
      email,
      name: rawName ? rawName.split(/\s+/)[0].slice(0, 60) : null,
      phone: m.phone === null ? null : phoneFrom(r[m.phone]),
      birthday: m.birthday === null ? null : birthdayFrom(r[m.birthday]),
    });
  }
  counts.to_add = rows.length;
  return { rows, counts };
}

// ---------- The legal basis ----------

export const BASES = ["opted_in", "past_customers", "unknown"] as const;
export type Basis = (typeof BASES)[number];

export const BASIS_WORDS: Record<Basis, string> = {
  opted_in: "they opted in to marketing (for example a tick box on your booking system)",
  past_customers: "they're past customers who bought from you and were given a chance to opt out when their details were taken",
  unknown: "you don't know",
};

// Why "don't know" can't be imported, in plain words.
export const UNKNOWN_BASIS_REPLY =
  "I can't import that list, sorry. Under UK law, even a \"please confirm\" email is marketing, so it needs a reason these people agreed to hear from you: either they opted in, or they're past customers who were given a chance to opt out. Instead, put your QR codes out so they can join themselves: send *QR* for your sign-up page.";

export function declarationText(basis: Exclude<Basis, "unknown">, restaurant: string, count: number) {
  return `I confirm that the ${count} people in this list ${basis === "opted_in" ? "opted in to receive marketing from" : "are past customers who bought from"} ${restaurant}${basis === "past_customers" ? " and were given a chance to opt out of marketing when their details were taken" : ""}, and that I'm responsible for having their permission.`;
}

// The web form's tick box (the basis is chosen just above it, on the same form).
export function webDeclarationText(restaurant: string, count: number) {
  return `I confirm that the ${count} people in this list agreed to hear from ${restaurant} in the way I chose above, and that I'm responsible for having their permission.`;
}

// Kept on each contact's consent record.
export function consentWording(basis: Exclude<Basis, "unknown">, restaurant: string) {
  return basis === "opted_in"
    ? `Imported by ${restaurant}: the owner declared these customers opted in to marketing from ${restaurant}.`
    : `Imported by ${restaurant}: the owner declared these are past customers who bought from ${restaurant} and were given a chance to opt out of marketing.`;
}

// Why they're getting the welcome email (in the email itself).
export function welcomeReason(basis: Exclude<Basis, "unknown">, restaurant: string) {
  return basis === "opted_in" ? `you signed up for offers and news from ${restaurant}` : `you've been a customer at ${restaurant}`;
}

// ---------- What the owner sees ----------

const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-GB")} ${x === 1 ? one : many}`;

export function previewLines(c: Cleaned["counts"], fieldsFound: string[]) {
  const left = [
    c.invalid ? `${n(c.invalid, "row")} without a valid email` : "",
    c.duplicate ? `${n(c.duplicate, "duplicate")}` : "",
    c.existing ? `${n(c.existing, "person", "people")} already on your list` : "",
    c.suppressed ? `${n(c.suppressed, "person", "people")} who unsubscribed or asked to be deleted before (never added back)` : "",
  ].filter(Boolean);
  return [`📇 *${n(c.to_add, "new customer")}* to add, out of ${n(c.total, "row")} (${fieldsFound.join(", ")}).`, left.length ? `Left out: ${left.join("; ")}.` : ""].filter(Boolean);
}

export function basisQuestion() {
  return [
    "Before I add them: how did these people agree to hear from you?",
    "- They *opted in* to marketing (for example a tick box on your booking system)",
    "- They're *past customers* who bought from you and were given a chance to opt out when their details were taken",
    "- You're *not sure*",
    "Just tell me in your own words.",
  ].join("\n");
}

export function declarationQuestion(basis: Exclude<Basis, "unknown">, restaurant: string, count: number) {
  return [
    "Please confirm this is true (you're responsible for having their permission):",
    `_"${declarationText(basis, restaurant, count)}"_`,
    "Reply *YES* to confirm and add them. Each one gets one welcome email first, which you approve. If you'd rather they confirm their email before getting anything else, say so.",
  ].join("\n");
}

// ---------- Sending ----------

export function shouldPause(sent: number, bounced: number) {
  if (bounced >= BOUNCE_MIN_COUNT && sent < BOUNCE_MIN_SENT) return bounced / Math.max(sent, 1) > BOUNCE_PAUSE_RATE;
  return sent >= BOUNCE_MIN_SENT && bounced / sent > BOUNCE_PAUSE_RATE;
}

// How many welcome emails this run may send.
export function sendRoom(sentLast24h: number, waiting: number) {
  return Math.max(0, Math.min(IMPORT_EMAILS_PER_DAY - sentLast24h, IMPORT_EMAILS_PER_RUN, waiting));
}

// A campaign may reach an imported contact only once their welcome has gone (or,
// with double opt-in, once they've confirmed: email_confirmed_at, like a sign-up).
export function importedContactReady(c: { source: string; import_status?: string | null; email_confirmed_at: string | null }) {
  if (c.source !== "import" || !c.import_status) return Boolean(c.email_confirmed_at);
  if (c.import_status === "welcomed") return true;
  return Boolean(c.email_confirmed_at);
}
