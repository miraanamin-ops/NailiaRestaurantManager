// The spending cap for live agent tests (a setup file of vitest.agents.config.mts).
// Every Claude call any test makes (agents, the checker, the old assistant) goes
// through the app's one client (lib/claude.ts claude()), so it's metered here:
// each answer's tokens, priced by the model that answered (lib/agents/usage.ts),
// are added to tests/agents-live/.results/spend.json. Once the total reaches the
// budget (AGENT_TEST_BUDGET dollars, default 40) every further call fails with
// "test spend cap reached" before it goes out (so at most the one call already
// under way goes over).
// The total carries on across runs until it's reset (npm run test:agents -- --reset-spend).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { tokensFrom } from "@/lib/agents/usage";

const DIR = join("tests", "agents-live", ".results");
export const SPEND_FILE = join(DIR, "spend.json");
export const BUDGET = Number(process.env.AGENT_TEST_BUDGET ?? 40) || 40;

export type Ledger = { budget: number; total: number; calls: number; byModel: Record<string, number>; byFile: Record<string, number>; started_at: string; updated_at: string };

export function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(SPEND_FILE, "utf8")) as Ledger;
  } catch {
    const now = new Date().toISOString();
    return { budget: BUDGET, total: 0, calls: 0, byModel: {}, byFile: {}, started_at: now, updated_at: now };
  }
}

// Files run one at a time (fileParallelism: false), so read-add-write is safe.
function record(model: string, cost: number) {
  const l = readLedger();
  const file = (expect.getState().testPath ?? "unknown").split(/[\\/]/).pop()!;
  l.total += cost;
  l.calls++;
  l.byModel[model] = (l.byModel[model] ?? 0) + cost;
  l.byFile[file] = (l.byFile[file] ?? 0) + cost;
  l.budget = BUDGET;
  l.updated_at = new Date().toISOString();
  mkdirSync(DIR, { recursive: true });
  writeFileSync(SPEND_FILE, `${JSON.stringify(l, null, 2)}\n`);
}

export class SpendCapError extends Error {
  constructor(total: number) {
    super(`test spend cap reached: $${total.toFixed(2)} of the $${BUDGET} budget is used (npm run test:agents -- --reset-spend to start a new budget)`);
  }
}

type Messages = { create: (...a: unknown[]) => Promise<{ model?: string; usage?: Parameters<typeof tokensFrom>[1] }>; parse: (...a: unknown[]) => Promise<{ model?: string; usage?: Parameters<typeof tokensFrom>[1] }> };

function metered<T extends Messages>(messages: T): T {
  const wrap = (fn: Messages["create"]) => async (...args: unknown[]) => {
    const spent = readLedger().total;
    if (spent >= BUDGET) throw new SpendCapError(spent);
    const res = await fn.apply(messages, args);
    const model = res.model ?? String((args[0] as { model?: string })?.model ?? "unknown");
    record(model, tokensFrom(model, res.usage).cost);
    return res;
  };
  return Object.assign(Object.create(messages), { create: wrap(messages.create), parse: wrap(messages.parse) });
}

vi.mock("@/lib/claude", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/claude")>();
  return {
    ...orig,
    claude: () => {
      const client = orig.claude();
      const beta = Object.assign(Object.create(client.beta), { messages: metered(client.beta.messages as unknown as Messages) });
      return Object.assign(Object.create(client), { beta, messages: metered(client.messages as unknown as Messages) });
    },
  };
});
