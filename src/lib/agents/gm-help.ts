import "server-only";
import type { Turn } from "@/lib/bot/turn";
import { runChecker, londonToday } from "./checker-core";
import { runHelp, type HelpInput } from "./gm-core";
import type { OwnerContext } from "./gm-rules";
import { helpGuide, yourSetup } from "./help";
import type { HelpOutputType } from "./help-rules";
import { recordAgentRun } from "./jobs";
import { loadAgent } from "./loader";
import { callTool } from "./tools";
import { addUsage, type Usage } from "./usage";

// "How do I...?": answered from the owner help guide (agents/help.md) and the
// restaurant's own setup, fact-checked against them (one retry with the checker's
// notes), then sent. Where DinerAI can do the task itself, a "Yes, do it" button
// starts it. Not covered by the guide: the caller is told (it asks the team).

export type HelpResult =
  | { kind: "answered"; message: string; action: string | null; usage: Usage }
  | { kind: "not_covered"; message: string; usage: Usage }
  | { kind: "blocked"; reasons: string[]; usage: Usage };

async function check(restaurantId: string, out: HelpOutputType, input: HelpInput, label: string) {
  const profile = await callTool("checker", "get_profile", restaurantId, {});
  const checked = await runChecker(
    {
      draft: { type: "gm_reply", channel: "owner", audience: "the owner", content: { text: out.message }, needs_owner_input: null, sources_used: ["help:guide", "help:setup"] },
      text: out.message,
      sources: [{ ref: "help:setup", found: true, data: { setup: input.setup, owner_question: input.question } }],
      profile,
      recent: [],
      maker: "gm",
      makerRules: loadAgent("gm").rules,
      preview: null,
      today: londonToday(),
      reference: { title: "the DinerAI owner help guide", text: input.guide },
    },
    `${label} (check)`,
  );
  const fails = checked.output.checks.filter((c) => c.result === "fail").map((c) => `${c.id}: ${c.reason ?? ""}${c.fix ? ` Fix: ${c.fix}` : ""}`);
  return { pass: checked.output.verdict === "pass", fails, usage: checked.usage };
}

export async function answerHowTo(turn: Turn, question: string, context: OwnerContext | null): Promise<HelpResult> {
  const r = turn.ctx.restaurant;
  const input: HelpInput = {
    question,
    meaning: context?.meaning ?? null,
    conversation: context?.conversation ?? [],
    guide: helpGuide(),
    setup: await yourSetup(r, turn.ctx.now),
    owner: { owner_name: r.owner_name, restaurant: r.name },
  };
  let usage: Usage = {};
  let fix: string[] | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const label = `a how-to question (attempt ${attempt})`;
    const answer = await runHelp({ ...input, fix }, label);
    usage = addUsage(usage, answer.usage);
    if (!answer.output.covered) return finish(r.id, { kind: "not_covered", message: answer.output.message, usage }, question);
    const checked = await check(r.id, answer.output, input, label);
    usage = addUsage(usage, checked.usage);
    if (checked.pass) return finish(r.id, { kind: "answered", message: answer.output.message, action: answer.output.action, usage }, question);
    fix = checked.fails.length ? checked.fails : ["the fact check didn't pass it: say only what the guide and the setup say"];
  }
  return finish(r.id, { kind: "blocked", reasons: fix ?? [], usage }, question);
}

async function finish(restaurantId: string, result: HelpResult, question: string) {
  await recordAgentRun({
    restaurantId,
    key: `gm:help:${restaurantId}:${Date.now()}`,
    agent: "gm",
    kind: "gm_help",
    trigger: "owner_message",
    output: { question: question.slice(0, 120), outcome: result.kind },
    agentVersion: "gm",
    verdict: result.kind,
    usage: result.usage,
  }).catch(() => null);
  return result;
}
