// Agent costs: tokens priced by the model that answered (cache reads cheaper,
// cache writes dearer), added up per agent and per month, and saved on each job.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { monthlyCosts } from "@/lib/agents/costs";
import { addUsage, dollars, tokensFrom, totals } from "@/lib/agents/usage";
import { memoryDb } from "../support/memory-db";

test("a call's cost, from the published prices", () => {
  // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 cache write, per million tokens.
  const t = tokensFrom("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 });
  expect(t.cost).toBeCloseTo((1000 * 2 + 500 * 10 + 4000 * 0.2) / 1e6, 10);
  const write = tokensFrom("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 4000 });
  expect(write.cost).toBeCloseTo(0.01, 10);
  // A model not in the table (e.g. a fallback) is priced as Sonnet.
  expect(tokensFrom("claude-other", { input_tokens: 1_000_000 }).cost).toBeCloseTo(2, 10);
  expect(tokensFrom("claude-haiku-5-5", { input_tokens: 1_000_000 }).cost).toBeCloseTo(0.1, 10);
});

test("usage adds up per agent", () => {
  const a = { reputation: tokensFrom("claude-sonnet-5-5", { input_tokens: 100, output_tokens: 10 }) };
  const b = { reputation: tokensFrom("claude-sonnet-5-5", { input_tokens: 100 }), checker: tokensFrom("claude-sonnet-5-5", { output_tokens: 1000 }) };
  const sum = addUsage(a, b);
  expect(sum.reputation.input).toBe(200);
  expect(sum.checker.output).toBe(1000);
  expect(totals(sum).cost).toBeCloseTo(a.reputation.cost + b.reputation.cost + b.checker.cost, 10);
  expect(dollars(0.0314)).toBe("$0.031");
  expect(dollars(12.5)).toBe("$12.50");
});

test("costs per London month, split by agent", () => {
  const u = (agent: string, cost: number) => ({ [agent]: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost } });
  const months = monthlyCosts([
    { created_at: "2026-10-01T10:00:00Z", usage: u("reputation", 0.02) },
    { created_at: "2026-10-02T10:00:00Z", usage: { ...u("reputation", 0.01), ...u("checker", 0.03) } },
    { created_at: "2026-09-30T23:30:00Z", usage: u("checker", 0.05) }, // 00:30 on 1 October in London
    { created_at: "2026-09-15T10:00:00Z", usage: u("visibility", 0.04) },
    { created_at: "2026-09-16T10:00:00Z", usage: null },
  ]);
  expect(months.map((m) => [m.month, m.jobs, Number(m.total.toFixed(2))])).toEqual([
    ["2026-10", 3, 0.11],
    ["2026-09", 1, 0.04],
  ]);
  expect(months[0].byAgent.checker).toBeCloseTo(0.08, 10);
});

let db: ReturnType<typeof memoryDb>;
beforeEach(() => {
  vi.resetModules();
  db = memoryDb({ agent_jobs: [], audit_log: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/builder-alerts");
});

test("each finished job saves its usage and cost", async () => {
  const { enqueueAgentJob, runAgentJobs } = await import("@/lib/agents/jobs");
  await enqueueAgentJob({ restaurantId: "r1", key: "k", agent: "reputation", kind: "x", trigger: "t" });
  const usage = { reputation: tokensFrom("claude-sonnet-5-5", { input_tokens: 2000, output_tokens: 300 }), checker: tokensFrom("claude-sonnet-5-5", { input_tokens: 3000, output_tokens: 200 }) };
  await runAgentJobs("r1", { x: async () => ({ output: {}, agentVersion: "0.2", detail: "done", actor: "reputation", usage }) });
  expect(db.tables.agent_jobs[0].usage).toEqual(usage);
  expect(db.tables.agent_jobs[0].cost_usd).toBeCloseTo((5000 * 2 + 500 * 10) / 1e6, 6);
});
