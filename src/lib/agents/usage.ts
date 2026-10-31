// What agent calls use and cost: tokens per agent, and an estimated cost in US
// dollars (the API's own currency) from the published per-token prices, priced
// by the model that actually answered. No imports, so it's unit-tested
// (tests/agents/usage.test.ts).

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
// Per agent, for one job (e.g. Reputation's loop also uses the checker).
export type Usage = Record<string, Tokens>;

// US dollars per million tokens. Cache writes (5-minute cache) cost 1.25x input;
// cache reads are the discounted price.
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
// A model not in the table (e.g. a refusal fallback) is priced as Sonnet, and the job says so.
const FALLBACK_PRICE = PRICES["claude-sonnet-5-5"];

export const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  // The split of cache writes: 1-hour writes (Dina's instructions) cost 2x input, not 1.25x.
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
};

export function tokensFrom(model: string, u: ApiUsage | null | undefined): Tokens {
  const t = { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheWrite: u?.cache_creation_input_tokens ?? 0 };
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const hourWrites = Math.min(u?.cache_creation?.ephemeral_1h_input_tokens ?? 0, t.cacheWrite);
  const writes = (t.cacheWrite - hourWrites) * p.cacheWrite + hourWrites * p.input * 2;
  return { ...t, cost: (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + writes) / 1_000_000 };
}

const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cost: a.cost + b.cost,
});

export function addUsage(...all: (Usage | null | undefined)[]): Usage {
  const out: Usage = {};
  for (const u of all) for (const [agent, t] of Object.entries(u ?? {})) out[agent] = addTokens(out[agent] ?? NO_TOKENS, t);
  return out;
}

export function totals(u: Usage | null | undefined): Tokens {
  return Object.values(u ?? {}).reduce(addTokens, NO_TOKENS);
}

// "$0.031"
export const dollars = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
