import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getCampaignForDraft } from "@/lib/campaigns";
import { draftName, type AgentCheck, type Draft } from "@/lib/drafts";
import { channelFor } from "@/lib/gate-rules";
import { getSupabase } from "@/lib/supabase";
import { applicableChecks, audienceOf, makerFor, verdictLine } from "./checker-rules";
import { runAgentJobs, type AgentJob, type JobHandler, type JobOutcome } from "./jobs";
import { callAgent } from "./run";
import { CheckerVerdict, verdictProblems, type CheckerVerdictOutput } from "./schema";
import { legacySources } from "./sources";
import { callTool } from "./tools";

// The checker agent in shadow mode: it reviews every new or edited draft against
// its rubric (agents/checker.md) and its verdict is recorded on the draft
// (drafts.agent_check), next to the existing four checks, in agent_jobs and in
// the audit log. Nothing changes for the owner: today's checks still decide
// what they see, and minor fixes are recorded, not applied.

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// What the checker sees of a draft: the shared draft shape, never the maker's reasoning.
async function draftForChecker(draft: Draft) {
  const campaign = draft.kind === "email_campaign" ? await getCampaignForDraft(draft.id) : null;
  const content = campaign
    ? { subject: campaign.subject, body: campaign.body, offer: campaign.offer, valid_from: campaign.valid_from, valid_until: campaign.valid_until }
    : { text: draft.content };
  return {
    json: {
      type: draft.kind,
      channel: channelFor(draft.kind),
      audience: draft.audience,
      content,
      needs_owner_input: null,
      sources_used: legacySources(draft, campaign?.segment),
    },
    // Minor fixes must match the text exactly as written.
    text: campaign ? [campaign.subject, campaign.body, campaign.offer].join("\n") : draft.content,
  };
}

export async function runCheckerShadow(job: AgentJob): Promise<JobOutcome> {
  const supabase = getSupabase();
  const rid = job.restaurant_id;
  const draft = ok(await supabase.from("drafts").select("*").eq("restaurant_id", rid).eq("id", job.draft_id ?? "").maybeSingle<Draft>());
  if (!draft) throw new Error(`Draft ${job.draft_id} not found for this restaurant`);
  const version = Number(job.input?.version ?? draft.version);

  const { json, text } = await draftForChecker(draft);
  const maker = makerFor(draft.kind);
  const [profile, sources, recent, makerRules, preview] = await Promise.all([
    callTool("checker", "get_profile", rid, {}),
    callTool("checker", "resolve_sources", rid, { refs: json.sources_used }),
    callTool("checker", "get_recent_outputs", rid, { kind: draft.kind, excludeDraftId: draft.id }),
    callTool("checker", "get_maker_rules", rid, { maker }),
    draft.kind === "email_campaign" ? callTool("checker", "get_rendered_preview", rid, { draftId: draft.id }).catch(() => null) : Promise.resolve(null),
  ]);
  const { applicable, skipped } = applicableChecks(audienceOf(draft.kind), Boolean(preview));

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Check this draft. Today is ${new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
        `Applicable checks (list every one in "checks", passed or not): ${applicable.join(", ")}.`,
        skipped.length ? `Skipped (no rendered preview for this kind of draft): ${skipped.join(", ")}. List them with result "skipped".` : "",
        `The draft (JSON):\n${JSON.stringify(json, null, 2)}`,
        `Resolved sources (the real data behind sources_used):\n${JSON.stringify(sources, null, 2)}`,
        `Restaurant profile (version ${profile.version}):\n${JSON.stringify(profile.fields, null, 2)}`,
        `The last ${recent.length} outputs of the same type (newest first):\n${recent.length ? recent.map((r, i) => `${i + 1}. """${r}"""`).join("\n") : "(none yet)"}`,
        `The maker's rules (the ${maker} agent), for C8:\n${makerRules}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...(preview
      ? [
          { type: "text" as const, text: "The rendered preview of the email, as a customer sees it on a phone:" },
          { type: "image" as const, source: { type: "base64" as const, media_type: preview.media_type, data: preview.data } },
        ]
      : []),
  ];

  const result = await callAgent<CheckerVerdictOutput>({
    agent: "checker",
    content,
    schema: CheckerVerdict,
    validate: (out) => verdictProblems(out, { applicable, skipped, draftText: text }),
    label: `draft ${draft.id} (v${version})`,
  });

  // The B checks that couldn't run are always listed as skipped, so the log shows them.
  const listed = new Set(result.output.checks.map((c) => c.id));
  const checks = [...result.output.checks, ...skipped.filter((id) => !listed.has(id)).map((id) => ({ id, result: "skipped" as const, reason: "no rendered preview for this kind of draft", fix: null }))];
  const agentCheck: AgentCheck = {
    mode: "shadow",
    job_id: job.id,
    agent_version: result.agentVersion,
    draft_version: version,
    verdict: result.output.verdict,
    checks,
    minor_fixes: result.output.minor_fixes,
    owner_question: result.output.owner_question,
    notes: result.output.notes,
    at: new Date().toISOString(),
  };
  // Saved on the draft only if it hasn't been edited since (a newer version has its own job).
  ok(await supabase.from("drafts").update({ agent_check: agentCheck }).eq("restaurant_id", rid).eq("id", draft.id).eq("version", version));

  return {
    output: { ...agentCheck, model: result.model, attempts: result.attempts, house_rules_version: result.houseRulesVersion, profile_version: profile.version },
    agentVersion: result.agentVersion,
    verdict: result.output.verdict,
    actor: "checker",
    detail: `Checker (shadow, v${result.agentVersion}) on the ${draftName(draft)}, version ${version}: ${verdictLine({ ...result.output, checks })}`,
  };
}

export const AGENT_HANDLERS: Record<string, JobHandler> = { checker_shadow: runCheckerShadow };

// Runs this restaurant's queued agent jobs. Called once the owner's reply has
// gone (webhook) and by the scheduled jobs, which also pick up anything left over.
export function runQueuedAgentJobs(restaurantId: string, limit = 3) {
  return runAgentJobs(restaurantId, AGENT_HANDLERS, { limit });
}
