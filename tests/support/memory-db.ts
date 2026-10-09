// An in-memory stand-in for Supabase that really applies each query's filters
// (eq, neq, in, is, not, or, gte/lt…), ordering, limits, inserts, updates and
// deletes. The isolation tests load two restaurants' data into it and run the
// real app code: if a query forgets to filter by restaurant, the other
// restaurant's rows come back and the test fails.
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

const cmp = (a: unknown, b: unknown) => (a == null || b == null ? NaN : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1");

function condition(col: string, op: string, raw: string): Pred {
  const v = unquote(raw);
  switch (op) {
    case "eq":
      return (r) => String(r[col]) === v;
    case "neq":
      return (r) => String(r[col]) !== v;
    case "is":
      return (r) => (v === "null" ? r[col] == null : String(r[col]) === v);
    case "in": {
      const list = v.replace(/^\(|\)$/g, "").split(",").map(unquote);
      return (r) => list.includes(String(r[col]));
    }
    case "lt":
      return (r) => cmp(r[col], v) < 0;
    case "lte":
      return (r) => cmp(r[col], v) <= 0;
    case "gt":
      return (r) => cmp(r[col], v) > 0;
    case "gte":
      return (r) => cmp(r[col], v) >= 0;
    default:
      throw new Error(`memory-db: unsupported filter ${op}`);
  }
}

// "a.is.null,b.lt.2026-01-01" / 'from_number.eq."x",to_number.eq."x"' / "w.in.(a,b)"
function parseOr(expr: string): Pred {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of expr) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (ch === "," && depth === 0 && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const preds = parts.map((p) => {
    const [col, op, ...rest] = p.split(".");
    return condition(col, op, rest.join("."));
  });
  return (r) => preds.some((p) => p(r));
}

export function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const table = (name: string) => (tables[name] ??= []);

  function from(name: string) {
    const preds: Pred[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let order: { col: string; asc: boolean }[] = [];
    let limit: number | null = null;
    let countHead = false;
    let returning = false;

    const run = () => {
      const rows = table(name);
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...p,
        }));
        rows.push(...list);
        return { data: returning ? list : null, error: null, count: null };
      }
      let matched = rows.filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload);
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null, count: null };
      }
      if (op === "delete") {
        tables[name] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null, count: null };
      }
      for (const o of [...order].reverse()) matched = [...matched].sort((a, b) => cmp(a[o.col], b[o.col]) * (o.asc ? 1 : -1));
      if (limit !== null) matched = matched.slice(0, limit);
      if (countHead) return { data: null, error: null, count: matched.length };
      return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
    };

    const chain = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.head) countHead = true;
        return chain;
      },
      insert(p: Row | Row[]) {
        op = "insert";
        payload = p;
        return chain;
      },
      update(p: Row) {
        op = "update";
        payload = p;
        return chain;
      },
      delete() {
        op = "delete";
        return chain;
      },
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v || String(r[c]) === String(v)), chain),
      neq: (c: string, v: unknown) => (preds.push((r) => String(r[c]) !== String(v)), chain),
      in: (c: string, list: unknown[]) => (preds.push((r) => list.map(String).includes(String(r[c]))), chain),
      is: (c: string, v: null | boolean) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), chain),
      not: (c: string, o: string, v: unknown) => (preds.push((r) => !condition(c, o, String(v))(r)), chain),
      gte: (c: string, v: unknown) => (preds.push((r) => cmp(r[c], v) >= 0), chain),
      gt: (c: string, v: unknown) => (preds.push((r) => cmp(r[c], v) > 0), chain),
      lt: (c: string, v: unknown) => (preds.push((r) => cmp(r[c], v) < 0), chain),
      lte: (c: string, v: unknown) => (preds.push((r) => cmp(r[c], v) <= 0), chain),
      or: (expr: string) => (preds.push(parseOr(expr)), chain),
      order: (c: string, o?: { ascending?: boolean }) => ((order = [...order, { col: c, asc: o?.ascending ?? true }]), chain),
      limit: (n: number) => ((limit = n), chain),
      returns: () => chain,
      single: async () => {
        const r = run();
        const one = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
        return { data: one, error: one ? null : { message: "No rows" }, count: r.count };
      },
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null, count: r.count };
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  }

  return { client: { from }, tables };
}
