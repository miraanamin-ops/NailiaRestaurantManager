// Reading a customer list (setup, 7 Nov 2026): the email column (and a name and
// birthday if there are), each row checked, duplicates and junk left out. Plain
// code, unit-tested (tests/guide-catalog.test.ts).

export type ImportRow = { email: string; name: string | null; birthday: string | null };
type Cell = string | number | boolean | Date | null | undefined;

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

// "1990-03-14", "14/03/1990", a date: the birthday as YYYY-MM-DD (a date with no
// year is left out: the column is a full date).
export function birthdayFrom(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return valid(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}
const valid = (year: number, month: number, day: number) =>
  year >= 1900 && year <= new Date().getFullYear() && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;

export function customersFromTable(table: { headers: string[]; rows: Cell[][] }, max: number) {
  const h = table.headers.map((x) => norm(String(x ?? "")));
  let emailCol = h.findIndex((x) => x.includes("email") || x === "mail");
  // No heading says email: the column where most cells are emails.
  if (emailCol === -1) {
    const counts = table.headers.map((_, i) => table.rows.filter((r) => EMAIL.test(String(r[i] ?? "").trim())).length);
    const best = Math.max(0, ...counts);
    emailCol = best ? counts.indexOf(best) : -1;
  }
  if (emailCol === -1) return { rows: [] as ImportRow[], skipped: table.rows.length, problem: "I couldn't find a column of email addresses in that file." };
  const first = h.findIndex((x) => x === "firstname" || x === "forename" || x === "givenname");
  const nameCol = first !== -1 ? first : h.findIndex((x) => x === "name" || x === "fullname" || x === "customername" || x === "customer");
  const birthdayCol = h.findIndex((x) => x.includes("birthday") || x.includes("dateofbirth") || x === "dob");
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let skipped = 0;
  for (const r of table.rows) {
    const email = String(r[emailCol] ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    const name = nameCol === -1 ? null : String(r[nameCol] ?? "").trim().split(/\s+/)[0] || null;
    rows.push({ email, name: name ? name.slice(0, 60) : null, birthday: birthdayCol === -1 ? null : birthdayFrom(r[birthdayCol]) });
    if (rows.length >= max) break;
  }
  return { rows, skipped, problem: null as string | null };
}
