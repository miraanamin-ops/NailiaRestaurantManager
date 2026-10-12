// Haiku as the checker, compared with Sonnet (a one-off measurement; the model isn't
// switched). For each recorded verdict, the same draft and sources Sonnet's checker
// saw go to the checker running on Haiku, once:
//   - the checker's own cases (agents/tests/checker/)
//   - the final reply in each Reputation case, and the final answer in each Insights case
// Reports agreement on the verdict, and on the safety checks (F1 to F5, C1, C3, C4),
// to tests/agents-live/.results/checker-haiku.txt.
// Run: node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.agents.config.mts tests/agents-live/checker-haiku.eval.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import type { CheckerInput } from "@/lib/agents/checker-core";
import type { Resolved } from "@/lib/agents/tools";
import { addUsage, dollars, totals, type Usage } from "@/lib/agents/usage";
import { loadCases } from "../agents/support/checker-cases";
import { caseData, loadInsightsCases } from "../agents/support/insights-cases";
import { loadReputationCases } from "../agents/support/reputation-cases";
import { hasKey } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));
// The checker on Haiku (no server-side fallback for Haiku); every other agent as it is.
vi.mock("@/lib/agents/loader", async (orig) => {
  const real = await orig<typeof import("@/lib/agents/loader")>();
  return { ...real, loadAgent: (name: Parameters<typeof real.loadAgent>[0]) => (name === "checker" ? { ...real.loadAgent(name), model: "haiku", modelId: "claude-haiku-5-5" } : real.loadAgent(name)) };
});

const SAFETY = ["F1", "F2", "F3", "F4", "F5", "C1", "C3", "C4"];
type Check = { id: string; result: string };
type Item = { name: string; input: () => Promise<CheckerInput>; sonnet: { verdict: string; checks: Check[] } };

const profileResolver = (fields: Record<string, unknown>, extra: (ref: string) => Resolved | null = () => null) => async (refs: string[]): Promise<Resolved[]> =>
  refs.map((ref) => {
    const id = ref.slice(ref.indexOf(":") + 1);
    const found = extra(ref);
    if (found) return found;
    if (ref.startsWith("profile:") && id in fields) return { ref, found: true, data: fields[id] ?? null };
    return { ref, found: false, reason: "not in this case's data" };
  });

async function items(): Promise<Item[]> {
  const { loadAgent } = await import("@/lib/agents/loader");
  const { checkerInput: reputationCheckerInput } = await import("@/lib/agents/reputation-core");
  const { insightsCheckerInput, REPORT_QUERIES } = await import("@/lib/agents/insights-core");
  const { queryMetrics } = await import("@/lib/agents/insights-metrics");
  const out: Item[] = [];
  for (const { file, case: c } of loadCases()) {
    if (!c.recorded) continue;
    out.push({ name: `checker/${file}`, input: async () => ({ ...c, makerRules: loadAgent(c.maker).rules, preview: null }), sonnet: c.recorded });
  }
  for (const { file, case: c } of loadReputationCases()) {
    const r = c.recorded;
    if (!r || r.outcome !== "reply" || !r.checker) continue;
    out.push({
      name: `reputation/${file}`,
      input: () =>
        reputationCheckerInput(r.output, { review: c.review, profile: c.profile, history: c.history, owner_choice: c.owner_choice, today: c.today } as never, {
          resolve: profileResolver(c.profile.fields, (ref) => (ref === `review:${c.review.id}` ? { ref, found: true, data: c.review } : null)),
          checkerProfile: c.profile,
          recent: c.history.recent_replies,
        }),
      sonnet: r.checker,
    });
  }
  for (const { file, case: c } of loadInsightsCases()) {
    const r = c.recorded;
    if (!r || r.outcome !== "reply" || !r.checker) continue;
    const data = caseData(c);
    const results = new Map(r.queries.map((q, i) => [`q${i + 1}`, queryMetrics(data, q, `q${i + 1}`)]));
    const input = { task: c.task, question: c.question, profile: c.profile, data, prepared: c.task === "report" ? REPORT_QUERIES : [], themes: c.themes, today: c.today_words };
    out.push({ name: `insights/${file}`, input: () => insightsCheckerInput(r.output, input, results, { resolve: profileResolver(c.profile.fields), checkerProfile: c.profile }), sonnet: r.checker });
  }
  return out;
}

const rows: { name: string; sonnet: string; haiku: string; disagree: string[] }[] = [];
const usages: Usage[] = [];

describe.skipIf(!hasKey)("checker on Haiku against Sonnet's recorded verdicts", async () => {
  const list = hasKey ? await items() : [];
  test.each(list.map((i) => [i.name, i] as const))("%s", async (_name, item) => {
    const { runChecker } = await import("@/lib/agents/checker-core");
    const result = await runChecker(await item.input(), `haiku comparison ${item.name}`);
    usages.push(result.usage);
    const haiku = new Map(result.output.checks.map((c) => [c.id, c.result]));
    const disagree = item.sonnet.checks
      .filter((c) => c.result !== "skipped" && haiku.has(c.id) && haiku.get(c.id) !== "skipped" && haiku.get(c.id) !== c.result)
      .map((c) => `${c.id}: Sonnet ${c.result}, Haiku ${haiku.get(c.id)}`);
    rows.push({ name: item.name, sonnet: item.sonnet.verdict, haiku: result.output.verdict, disagree });
    console.log(`${item.name}: Sonnet ${item.sonnet.verdict}, Haiku ${result.output.verdict}${disagree.length ? ` (${disagree.join("; ")})` : ""}`);
    expect(result.output.verdict).toBeTruthy();
  });
});

afterAll(() => {
  if (!rows.length) return;
  const same = rows.filter((r) => r.sonnet === r.haiku).length;
  const safety = rows.flatMap((r) => r.disagree.filter((d) => SAFETY.includes(d.slice(0, 2))));
  const missed = safety.filter((d) => /Sonnet fail, Haiku pass/.test(d)).length;
  const extra = safety.filter((d) => /Sonnet pass, Haiku fail/.test(d)).length;
  const compared = rows.length * SAFETY.length;
  const t = totals(addUsage(...usages));
  const lines = [
    `Checker on Haiku vs Sonnet, ${new Date().toISOString()}`,
    `Verdict agreement: ${same} of ${rows.length} (${Math.round((same / rows.length) * 100)}%)`,
    `Safety checks (F1-F5, C1, C3, C4): ${safety.length} disagreements in about ${compared} check results; Haiku passed ${missed} that Sonnet failed, and failed ${extra} that Sonnet passed`,
    `Haiku cost: ${dollars(t.cost / rows.length)} per check on average`,
    "",
    ...rows.map((r) => `${r.sonnet === r.haiku ? "  " : "≠ "}${r.name}: Sonnet ${r.sonnet}, Haiku ${r.haiku}${r.disagree.length ? `  [${r.disagree.join("; ")}]` : ""}`),
  ];
  const dir = join("tests", "agents-live", ".results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "checker-haiku.txt"), `${lines.join("\n")}\n`);
  console.log(lines.slice(0, 4).join("\n"));
});
