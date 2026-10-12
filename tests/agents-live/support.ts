// Shared by the live agent tests.
//   RECORD=1      save each answer as the case's recorded answer
//   STABILITY=n   run each case n times and report any case whose verdict changes
//                 (a "flip"). Every run must still be right for the case to pass.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const RECORD = process.env.RECORD === "1";
export const RUNS = Math.max(1, Math.min(5, Number(process.env.STABILITY ?? 1) || 1));
export const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

// Flips are printed and added to tests/agents-live/.results/flips.txt, so a long run's summary isn't lost.
export function reportRuns(agent: string, file: string, verdicts: string[]) {
  const distinct = [...new Set(verdicts)];
  const line = `${agent} ${file}: ${verdicts.join(", ")}${distinct.length > 1 ? "  <-- FLIP" : ""}`;
  console.log(line);
  if (RUNS > 1 && distinct.length > 1) {
    const dir = join("tests", "agents-live", ".results");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "flips.txt"), `${new Date().toISOString()} ${line}\n`);
  }
  return distinct.length > 1;
}
