import "server-only";
import { runChecker, type CheckerInput } from "./checker-core";
import type { AgentName } from "./definition";
import type { AgentResult } from "./run";
import type { CheckerVerdictOutput } from "./schema";
import { addUsage, type Usage } from "./usage";

// The maker-checker loop every maker agent goes through (agent-system.md "The pipeline"):
//   the maker writes a draft (or asks the owner: needs_owner_input)
//   -> the checker: pass     = minor fixes applied by code, done
//                   fail     = back to the maker with the fix notes (at most MAX_REVISIONS)
//                   escalate, or still failing after MAX_REVISIONS = a question for the owner

export const MAX_REVISIONS = 2;

export type FixNote = { id: string; reason: string | null; fix: string | null };
export type Revision<O> = { previous: O; fixes: FixNote[] };
export type LoopStep = { agent: AgentName; version: string; verdict?: string; summary: string };

export type LoopOutcome<O> =
  | { kind: "reply"; output: O; checker: CheckerVerdictOutput; revisions: number; minorFixesApplied: number; steps: LoopStep[]; agentVersion: string; checkerVersion: string; usage: Usage }
  | { kind: "question"; output: O; question: string; by: "maker" | "checker"; checker: CheckerVerdictOutput | null; revisions: number; steps: LoopStep[]; agentVersion: string; checkerVersion: string | null; usage: Usage };

export type LoopSpec<O> = {
  maker: AgentName;
  label: string;
  // Writes the draft (a revision when given the fix notes).
  make: (revision: Revision<O> | null, label: string) => Promise<AgentResult<O>>;
  // The maker's question for the owner, if it set needs_owner_input.
  question: (out: O) => string | null;
  // What the checker is given for this draft.
  checkerInput: (out: O) => Promise<CheckerInput>;
  // The draft with the checker's minor fixes applied, or null if that would break the maker's rules.
  applyFixes: (out: O, fixes: CheckerVerdictOutput["minor_fixes"]) => O | null;
  // The question when the checker still fails it after MAX_REVISIONS.
  stuckQuestion: (reason: string) => string;
  // One line for each maker step in the log.
  describe?: (out: O, revision: number) => string;
};

export async function makerCheckerLoop<O>(spec: LoopSpec<O>): Promise<LoopOutcome<O>> {
  const steps: LoopStep[] = [];
  const describe = spec.describe ?? ((_o, r) => (r ? `revision ${r}` : "drafted"));
  let made = await spec.make(null, `${spec.label} (draft)`);
  let usage: Usage = addUsage(made.usage);
  let output = made.output;
  let asked = spec.question(output);
  steps.push({ agent: spec.maker, version: made.agentVersion, summary: asked ? `asks the owner: ${asked}` : describe(output, 0) });
  if (asked) {
    return { kind: "question", output, question: asked, by: "maker", checker: null, revisions: 0, steps, agentVersion: made.agentVersion, checkerVersion: null, usage };
  }

  for (let revisions = 0; ; revisions++) {
    const checked = await runChecker(await spec.checkerInput(output), `${spec.label} (check ${revisions + 1})`);
    usage = addUsage(usage, checked.usage);
    const verdict = checked.output;
    const failed = verdict.checks.filter((c) => c.result === "fail");
    steps.push({ agent: "checker", version: checked.agentVersion, verdict: verdict.verdict, summary: failed.map((c) => `${c.id}: ${c.reason ?? ""}`).join("; ") || verdict.verdict });

    if (verdict.verdict === "pass") {
      // Minor fixes are applied by code, and only if the result still passes the maker's rules.
      const fixed = verdict.minor_fixes.length ? spec.applyFixes(output, verdict.minor_fixes) : output;
      return {
        kind: "reply",
        output: fixed ?? output,
        checker: verdict,
        revisions,
        minorFixesApplied: fixed && verdict.minor_fixes.length ? verdict.minor_fixes.length : 0,
        steps,
        agentVersion: made.agentVersion,
        checkerVersion: checked.agentVersion,
        usage,
      };
    }
    if (verdict.verdict === "escalate" || revisions >= MAX_REVISIONS) {
      const question = verdict.verdict === "escalate" && verdict.owner_question ? verdict.owner_question : spec.stuckQuestion(failed[0]?.reason ?? "the checker kept failing it");
      return { kind: "question", output, question, by: "checker", checker: verdict, revisions, steps, agentVersion: made.agentVersion, checkerVersion: checked.agentVersion, usage };
    }

    made = await spec.make({ previous: output, fixes: failed }, `${spec.label} (revision ${revisions + 1})`);
    usage = addUsage(usage, made.usage);
    output = made.output;
    asked = spec.question(output);
    steps.push({ agent: spec.maker, version: made.agentVersion, summary: asked ? `asks the owner: ${asked}` : describe(output, revisions + 1) });
    if (asked) {
      return { kind: "question", output, question: asked, by: "maker", checker: verdict, revisions: revisions + 1, steps, agentVersion: made.agentVersion, checkerVersion: checked.agentVersion, usage };
    }
  }
}
