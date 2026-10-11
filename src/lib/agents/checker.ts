import "server-only";
import { getCampaignForDraft } from "@/lib/campaigns";
import { draftName, type AgentCheck, type Draft } from "@/lib/drafts";
import { channelFor } from "@/lib/gate-rules";
import { getSupabase } from "@/lib/supabase";
import { londonToday, runChecker } from "./checker-core";
import { makerFor, verdictLine } from "./checker-rules";
import { runAgentJobs, type AgentJob, type JobHandler, type JobOutcome } from "./jobs";
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
  const result = await runChecker(
    { draft: json, text, sources, profile, recent, maker, makerRules, preview, today: londonToday() },
    `draft ${draft.id} (v${version})`,
  );
  const { checks } = result.output;
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
    detail: `Checker (shadow, v${result.agentVersion}) on the ${draftName(draft)}, version ${version}: ${verdictLine(result.output)}`,
  };
}

export const AGENT_HANDLERS: Record<string, JobHandler> = { checker_shadow: runCheckerShadow };

// Runs this restaurant's queued agent jobs. Called once the owner's reply has
// gone (webhook) and by the scheduled jobs, which also pick up anything left over.
export function runQueuedAgentJobs(restaurantId: string, limit = 3) {
  return runAgentJobs(restaurantId, AGENT_HANDLERS, { limit });
}
