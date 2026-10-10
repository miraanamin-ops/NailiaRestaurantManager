// A stand-in for the Supabase client in tests. Every query chain works; what a
// query returns is decided by `respond`, given the table and what was asked.
// Inserts and updates are recorded so tests can check what was written.

export type Call = { table: string; op: "select" | "insert" | "update" | "delete" | "upsert"; payload?: unknown; filters: unknown[][] };
export type Respond = (call: Call) => { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

export function fakeSupabase(respond: Respond) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const result = () => {
      const r = respond(call);
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
    };
    const chain: Record<string, unknown> = {};
    const passThrough = ["select", "eq", "neq", "in", "is", "or", "not", "order", "limit", "gte", "lt", "lte", "gt", "ilike", "returns"];
    for (const m of passThrough) chain[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), chain);
    for (const op of ["insert", "update", "delete", "upsert"] as const) {
      chain[op] = (payload?: unknown) => {
        call.op = op;
        call.payload = payload;
        calls.push(call);
        return chain;
      };
    }
    chain.single = async () => result();
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (call.op === "select") calls.push(call);
      return Promise.resolve(result()).then(resolve, reject);
    };
    return chain;
  };
  return { client: { from: builder }, calls };
}
