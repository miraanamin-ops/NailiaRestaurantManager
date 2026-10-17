// Money for the operations data: always whole pence (integers), never floating
// pounds. The older sales tables keep pounds (numeric); convert at the edge.
// No imports, so it's unit-tested (tests/ops-helpers.test.ts).

// 12.5 -> 1250, "£1,234.56" -> 123456, "7.505" -> null (not a whole number of pence).
// Works from the text so 0.1 + 0.2 style float errors can't creep in.
export function toPence(pounds: number | string | null | undefined): number | null {
  if (pounds === null || pounds === undefined) return null;
  const text = (typeof pounds === "number" ? (Number.isFinite(pounds) ? String(pounds) : "") : pounds)
    .replace(/[£,\s]/g, "")
    .trim();
  const m = text.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) {
    return null;
  }
  const decimals = (m[3] ?? "").replace(/0+$/, "");
  if (decimals.length > 2) return null;
  const pence = Number(m[2] || "0") * 100 + Number((decimals + "00").slice(0, 2));
  return m[1] ? -pence : pence;
}

// 1250 -> 12.5 (for the menu copy and the old pounds columns).
export function toPounds(pence: number): number {
  return pence / 100;
}

// 1250 -> "£12.50", 123456 -> "£1,234.56", -500 -> "-£5.00".
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100).toLocaleString("en-GB");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

// A share of sales as a percentage with 2 decimals (labour %, food cost %). null if no sales.
export function percentOf(partPence: number, wholePence: number): number | null {
  if (!wholePence) return null;
  return Math.round((partPence / wholePence) * 10_000) / 100;
}
