// The job queue's real SQL (supabase/027_job_queue.sql) running in PGlite, a
// Postgres that runs inside the test process (no network, no Supabase). Tests
// that use the queue call the same database functions the live app does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(fileURLToPath(new URL("../../supabase/027_job_queue.sql", import.meta.url)), "utf8");

// What 027 needs from the rest of the database (and Supabase's own roles).
const BEFORE = `
  create role anon; create role authenticated; create role service_role;
  create table restaurants (id uuid primary key, name text);
  create table schema_migrations (name text primary key);
  create table agent_jobs (id uuid primary key default gen_random_uuid(), restaurant_id uuid, job_key text, kind text, status text);
`;

// A fresh database with the queue. withRestaurantFk: false lets tests use any
// restaurant id (the in-memory stand-in keeps restaurants elsewhere).
export async function newQueueDb({ withRestaurantFk = true } = {}) {
  const pg = await PGlite.create();
  await pg.exec(BEFORE);
  await pg.exec(SQL);
  if (!withRestaurantFk) await pg.exec("alter table jobs drop constraint if exists jobs_restaurant_id_fkey");
  return pg;
}

function toSql(name: string, v: unknown) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v) && name === "p_types") return `{${v.map((x) => `"${String(x).replaceAll('"', '\\"')}"`).join(",")}}`;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function fromSql(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v]));
}

// supabase.rpc(fn, args) on PGlite: named arguments, like PostgREST. A function
// returning one value gives that value; one returning rows gives the rows.
export function rpcOn(pg: PGlite) {
  return async (fn: string, args: Record<string, unknown> = {}) => {
    if (!/^\w+$/.test(fn)) throw new Error(`bad function name ${fn}`);
    const names = Object.keys(args);
    const sql = `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
    try {
      const res = await pg.query<Record<string, unknown>>(sql, names.map((n) => toSql(n, args[n])));
      const rows = res.rows.map(fromSql);
      if (res.fields.length === 1 && res.fields[0].name === fn) return { data: rows[0]?.[fn] ?? null, error: null };
      return { data: rows, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

// One shared database per test file for the in-memory Supabase stand-in
// (memory-db.ts): made once, emptied for each new stand-in.
let shared: Promise<PGlite> | null = null;
export async function sharedQueueDb(): Promise<PGlite> {
  shared ??= newQueueDb({ withRestaurantFk: false });
  return shared;
}
