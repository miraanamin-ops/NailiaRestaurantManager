// Saved checker cases (agents/tests/checker/*.json): real drafts, the data the
// checker would be given, what a correct verdict must look like, and the
// checker's recorded answer. Shared by the offline test (every push) and the
// live run with real Claude (on demand, and on pull requests that change agents).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckerInput } from "@/lib/agents/checker-core";
import type { CheckerVerdictOutput } from "@/lib/agents/schema";

export type CheckerCase = Omit<CheckerInput, "makerRules" | "preview"> & {
  name: string;
  source: string;
  note: string | null;
  expect: {
    // Any of these verdicts is acceptable.
    verdict: CheckerVerdictOutput["verdict"][];
    // Each entry: one of these checks failed, or a minor fix under one of them
    // (whose find contains find_contains, if given).
    flagged?: { checks: string[]; find_contains?: string }[];
    // The release gate (code) must block it, whatever the checker says.
    gate?: { blocked: string };
  };
  recorded: (CheckerVerdictOutput & { model: string; agent_version: string; recorded_at: string }) | null;
};

export const CASES_DIR = join("agents", "tests", "checker");

export function loadCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(CASES_DIR, file), "utf8")) as CheckerCase }));
}

export function saveRecorded(file: string, recorded: CheckerCase["recorded"]) {
  const path = join(CASES_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as CheckerCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

// What's wrong with a verdict for this case. Empty = it's right.
export function judge(c: CheckerCase, v: Pick<CheckerVerdictOutput, "verdict" | "checks" | "minor_fixes">) {
  const problems: string[] = [];
  if (!c.expect.verdict.includes(v.verdict)) problems.push(`verdict ${v.verdict}, expected ${c.expect.verdict.join(" or ")}`);
  for (const f of c.expect.flagged ?? []) {
    const failed = v.checks.some((k) => f.checks.includes(k.id) && k.result === "fail");
    const fixed = v.minor_fixes.some((m) => f.checks.includes(m.check) && (!f.find_contains || m.find.includes(f.find_contains)));
    if (!failed && !fixed) problems.push(`expected ${f.checks.join("/")} to be failed or minor-fixed${f.find_contains ? ` (on "${f.find_contains}")` : ""}`);
  }
  return problems;
}
