import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { applicableChecks, audienceOf } from "./checker-rules";
import type { AgentName } from "./definition";
import { callAgent } from "./run";
import { CheckerVerdict, verdictProblems, type CheckerVerdictOutput } from "./schema";
import type { Resolved } from "./tools";

// The checker itself, without the database: everything it's given goes in as
// CheckerInput. Shadow mode (lib/agents/checker.ts) fills it from the database;
// the agent tests (agents/tests/checker/) fill it from saved real examples.

export type CheckerDraft = {
  type: string;
  channel: string;
  audience: string | null;
  content: Record<string, unknown>;
  needs_owner_input: string | null;
  sources_used: string[];
};

export type CheckerInput = {
  draft: CheckerDraft;
  // The draft's text exactly as written (minor fixes must match it).
  text: string;
  sources: Resolved[];
  profile: { version: number; fields: Record<string, unknown> };
  recent: string[];
  maker: AgentName;
  makerRules: string;
  preview: { media_type: "image/png"; data: string } | null;
  // "Saturday 11 October 2026"
  today: string;
};

export function checkerContent(input: CheckerInput) {
  const { applicable, skipped } = applicableChecks(audienceOf(input.draft.type), Boolean(input.preview));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Check this draft. Today is ${input.today}.`,
        `Applicable checks (list every one in "checks", passed or not): ${applicable.join(", ")}.`,
        skipped.length ? `Skipped (no rendered preview for this kind of draft): ${skipped.join(", ")}. List them with result "skipped".` : "",
        `The draft (JSON):\n${JSON.stringify(input.draft, null, 2)}`,
        `Resolved sources (the real data behind sources_used):\n${JSON.stringify(input.sources, null, 2)}`,
        `Restaurant profile (version ${input.profile.version}):\n${JSON.stringify(input.profile.fields, null, 2)}`,
        `The last ${input.recent.length} outputs of the same type (newest first):\n${input.recent.length ? input.recent.map((r, i) => `${i + 1}. """${r}"""`).join("\n") : "(none yet)"}`,
        `The maker's rules (the ${input.maker} agent), for C8:\n${input.makerRules}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...(input.preview
      ? [
          { type: "text" as const, text: "The rendered preview of the email, as a customer sees it on a phone:" },
          { type: "image" as const, source: { type: "base64" as const, media_type: input.preview.media_type, data: input.preview.data } },
        ]
      : []),
  ];
  return { content, applicable, skipped };
}

export async function runChecker(input: CheckerInput, label: string) {
  const { content, applicable, skipped } = checkerContent(input);
  const result = await callAgent<CheckerVerdictOutput>({
    agent: "checker",
    content,
    schema: CheckerVerdict,
    validate: (out) => verdictProblems(out, { applicable, skipped, draftText: input.text }),
    label,
  });
  // The B checks that couldn't run are always listed as skipped, so the log shows them.
  const listed = new Set(result.output.checks.map((c) => c.id));
  const checks = [
    ...result.output.checks,
    ...skipped.filter((id) => !listed.has(id)).map((id) => ({ id, result: "skipped" as const, reason: "no rendered preview for this kind of draft", fix: null })),
  ];
  return { ...result, output: { ...result.output, checks } };
}

export const londonToday = (now = new Date()) =>
  now.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
