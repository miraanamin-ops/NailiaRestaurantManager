import "server-only";
import { getCampaignForDraft } from "@/lib/campaigns";
import { draftName, type AgentCheck, type Draft } from "@/lib/drafts";
import { channelFor } from "@/lib/gate-rules";
import { getSupabase } from "@/lib/supabase";
import { londonToday, runChecker } from "./checker-core";
import { makerFor, verdictLine } from "./checker-rules";
import type { AgentJob, JobOutcome } from "./jobs";
import { agentMode } from "./modes";
import { legacySources } from "./sources";
import { callTool } from "./tools";

// The checker agent on every new or edited draft: it reviews it against its
// rubric (agents/checker.md) and its verdict is recorded on the draft
// (drafts.agent_check), next to the existing four checks, in agent_jobs and in
// the audit log. In shadow nothing changes for the owner. Live (with the agents
// live), the release gate counts it: a Google reply or post only goes out once
// the checker passed that exact version (lib/send.ts, gate-rules googleCheckerStep).
// Minor fixes are recorded, not applied.

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

// The checker on one version of a draft. Its verdict is saved on the draft only if
// the draft hasn't been edited since (a newer version has its own check).
export async function checkDraftVersion(draft: Draft, version: number, mode: "shadow" | "live", jobId: string) {
  const rid = draft.restaurant_id;
  const { json, text } = await draftForChecker(draft);
  const maker = makerFor(draft.kind);
  const [profile, sources, recent, makerRules, preview] = await Promise.all([
    callTool("checker", "get_profile", rid, {}),
    callTool("checker", "resolve_sources", rid, { refs: json.sources_used }),
    callTool("checker", "get_recent_outputs", rid, { kind: draft.kind, excludeDraftId: draft.id }),
    callTool("checker", "get_maker_rules", rid, { maker }),
    draft.kind === "email_campaign" || draft.kind === "google_post" ? callTool("checker", "get_rendered_preview", rid, { draftId: draft.id }).catch(() => null) : Promise.resolve(null),
  ]);
  const result = await runChecker(
    { draft: json, text, sources, profile, recent, maker, makerRules, preview, today: londonToday() },
    `draft ${draft.id} (v${version})`,
  );
  const { checks } = result.output;
  const agentCheck: AgentCheck = {
    mode,
    job_id: jobId,
    agent_version: result.agentVersion,
    draft_version: version,
    verdict: result.output.verdict,
    checks,
    minor_fixes: result.output.minor_fixes,
    owner_question: result.output.owner_question,
    notes: result.output.notes,
    at: new Date().toISOString(),
  };
  ok(await getSupabase().from("drafts").update({ agent_check: agentCheck }).eq("restaurant_id", rid).eq("id", draft.id).eq("version", version));
  return { agentCheck, result, profileVersion: profile.version };
}

// The checker's mode for a restaurant: live only when the builder set it live.
export async function checkerModeFor(restaurantId: string) {
  const { data } = await getSupabase().from("restaurants").select("agent_modes").eq("id", restaurantId).maybeSingle<{ agent_modes: Record<string, string> | null }>();
  return agentMode(data ?? {}, "checker") === "live" ? ("live" as const) : ("shadow" as const);
}

export async function runCheckerShadow(job: AgentJob): Promise<JobOutcome> {
  const rid = job.restaurant_id;
  const draft = ok(await getSupabase().from("drafts").select("*").eq("restaurant_id", rid).eq("id", job.draft_id ?? "").maybeSingle<Draft>());
  if (!draft) throw new Error(`Draft ${job.draft_id} not found for this restaurant`);
  const version = Number(job.input?.version ?? draft.version);
  const mode = await checkerModeFor(rid);
  const { agentCheck, result, profileVersion } = await checkDraftVersion(draft, version, mode, job.id);
  return {
    output: { ...agentCheck, model: result.model, attempts: result.attempts, house_rules_version: result.houseRulesVersion, profile_version: profileVersion },
    agentVersion: result.agentVersion,
    verdict: result.output.verdict,
    usage: result.usage,
    actor: "checker",
    detail: `Checker (${mode}, v${result.agentVersion}) on the ${draftName(draft)}, version ${version}: ${verdictLine(result.output)}`,
  };
}
