// The GM, live: the router (Haiku) on the 40 routing cases, and the composer
// (Sonnet) on each composer case, with real Claude. Every route must be right, and
// every message must pass its case. Reply times are printed (and saved with the
// recorded answers). Same commands as the others (npm run test:agents / test:agents:record).
import { describe, expect, test, vi } from "vitest";
import { addUsage, dollars, totals, type Usage } from "@/lib/agents/usage";
import { composerData, judgeComposer, loadComposerCases, loadRouting, saveComposerRecorded, saveRoutingRecorded } from "../agents/support/gm-cases";
import { hasKey, RECORD } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

describe.skipIf(!hasKey)("gm (live)", () => {
  test("the router: all 40 routing cases", async () => {
    const { runRouter } = await import("@/lib/agents/gm-core");
    const routing = loadRouting();
    const results: { message: string; output: Awaited<ReturnType<typeof runRouter>>["output"] }[] = [];
    const wrong: string[] = [];
    const usages: Usage[] = [];
    const times: number[] = [];
    for (const c of routing.cases) {
      const started = Date.now();
      const r = await runRouter({ message: c.message, recent: [], onScreen: null }, `routing "${c.message}"`).catch((err: Error) => {
        wrong.push(`"${c.message}": invalid output (${err.message.slice(0, 160)})`);
        return null;
      });
      times.push(Date.now() - started);
      if (!r) continue;
      usages.push(r.usage);
      results.push({ message: c.message, output: r.output });
      if (!c.routes.includes(r.output.route)) wrong.push(`"${c.message}": ${r.output.route}, expected ${c.routes.join(" or ")}`);
    }
    const t = totals(addUsage(...usages));
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`router: ${routing.cases.length - wrong.length} of ${routing.cases.length} right; ${dollars(t.cost / routing.cases.length)} a message; typical ${sorted[Math.floor(sorted.length / 2)]}ms, slowest ${sorted.at(-1)}ms`);
    for (const w of wrong) console.log(`  wrong: ${w}`);
    if (RECORD) saveRoutingRecorded({ results, recorded_at: new Date().toISOString() });
    expect(wrong).toEqual([]);
  });

  test.each(loadComposerCases())("composer $file", async ({ file, case: c }) => {
    const { runComposer } = await import("@/lib/agents/gm-core");
    const started = Date.now();
    const data = composerData(c);
    const r = await runComposer({ kind: c.kind, ...data }, `composer ${file}`);
    const ms = Date.now() - started;
    const problems = judgeComposer(c, r.output);
    console.log(`composer ${file}: ${ms}ms, ${dollars(totals(r.usage).cost)}\n  ${r.output.message.replace(/\n/g, "\n  ")}`);
    if (RECORD) saveComposerRecorded(file, { output: r.output, recorded_at: new Date().toISOString() });
    expect(problems).toEqual([]);
  });
});
