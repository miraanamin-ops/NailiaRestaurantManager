// Shared by the live agent tests.
//   RECORD=1      save each answer as the case's recorded answer
//   STABILITY=n   run each case n times and report any case whose verdict changes
//                 (a "flip"). Every run must still be right for the case to pass.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { addUsage, dollars, totals, type Usage } from "@/lib/agents/usage";

export const RECORD = process.env.RECORD === "1";
export const RUNS = Math.max(1, Math.min(5, Number(process.env.STABILITY ?? 1) || 1));
export const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

// Flips are printed and added to tests/agents-live/.results/flips.txt, so a long run's summary isn't lost.
// usages: what each run used. The line shows the average cost per run and how much
// of the input came from the prompt cache.
export function reportRuns(agent: string, file: string, verdicts: string[], usages: Usage[] = []) {
  const distinct = [...new Set(verdicts)];
  const all = totals(addUsage(...usages));
  const cached = all.input + all.cacheRead + all.cacheWrite ? Math.round((all.cacheRead / (all.input + all.cacheRead + all.cacheWrite)) * 100) : 0;
  const cost = usages.length ? `  [${dollars(all.cost / usages.length)} per run, ${cached}% of input from cache]` : "";
  const line = `${agent} ${file}: ${verdicts.join(", ")}${distinct.length > 1 ? "  <-- FLIP" : ""}${cost}`;
  console.log(line);
  if (RUNS > 1 && distinct.length > 1) {
    const dir = join("tests", "agents-live", ".results");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "flips.txt"), `${new Date().toISOString()} ${line}\n`);
  }
  return distinct.length > 1;
}
