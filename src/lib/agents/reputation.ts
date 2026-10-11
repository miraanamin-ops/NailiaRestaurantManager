import "server-only";
import { createHash } from "node:crypto";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { londonToday } from "./checker-core";
import type { AgentJob, JobOutcome } from "./jobs";
import { enqueueAgentJob } from "./jobs";
import { agentMode } from "./modes";
import { reputationLoop, type CheckerDeps, type OwnerChoice, type ReputationInput, type ReputationOutcome } from "./reputation-core";
import type { ReviewInput } from "./reputation-rules";
import { callTool } from "./tools";

// The Reputation agent with the database: its input (profile, review history),
// the checker's data, and shadow mode. In shadow mode it runs next to today's
// reply (writeReviewReply) on every review: its draft and the checker's verdict
// are saved in shadow_drafts for the /log comparison; the owner sees nothing new.

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function reputationMode(restaurant: Pick<Restaurant, "agent_modes">) {
  return agentMode(restaurant, "reputation");
}

export async function reputationInput(restaurantId: string, review: ReviewInput, ownerChoice: OwnerChoice | null = null): Promise<ReputationInput> {
  const [profile, history] = await Promise.all([
    callTool("reputation", "get_profile", restaurantId, {}),
    callTool("reputation", "get_review_history", restaurantId, {}),
  ]);
  return { review, profile, history, owner_choice: ownerChoice, today: londonToday() };
}

// The checker gets the whole profile, the real data behind each source, and recent replies.
export async function checkerDeps(restaurantId: string): Promise<CheckerDeps> {
  const [checkerProfile, recent] = await Promise.all([
    callTool("checker", "get_profile", restaurantId, {}),
    callTool("checker", "get_recent_outputs", restaurantId, { kind: "review_reply", excludeDraftId: null }),
  ]);
  return { resolve: (refs) => callTool("checker", "resolve_sources", restaurantId, { refs }), checkerProfile, recent };
}

export async function runReputationFor(restaurantId: string, review: ReviewInput, label: string, ownerChoice: OwnerChoice | null = null) {
  const [input, deps] = await Promise.all([reputationInput(restaurantId, review, ownerChoice), checkerDeps(restaurantId)]);
  // The review being replied to is resolved from what we already have (a pasted
  // review isn't in the database); everything else through resolve_sources.
  const reviewRef = `review:${review.id}`;
  const resolve: CheckerDeps["resolve"] = async (refs) => {
    const others = await deps.resolve(refs.filter((r) => r !== reviewRef));
    return refs.map((r) => (r === reviewRef ? { ref: r, found: true as const, data: review } : others.find((o) => o.ref === r)!));
  };
  return { outcome: await reputationLoop(input, { ...deps, resolve }, label), profileVersion: input.profile.version };
}

// A pasted review has no row in the database: it gets a stable id from its text.
export function pastedReviewId(review: { authorName: string; rating: number | null; text: string }) {
  return `pasted-${createHash("sha256").update(`${review.authorName}|${review.rating}|${review.text}`).digest("hex").slice(0, 16)}`;
}

// ---------- Shadow mode ----------

type ShadowJobInput = {
  source: "review_check" | "pasted";
  review: ReviewInput;
  legacy_draft_id: string | null;
  legacy_text: string | null;
};

// Queued next to today's reply. One job per review (or per pasted review text). Never throws.
export async function queueReputationShadow(restaurant: Pick<Restaurant, "id" | "agent_modes">, input: ShadowJobInput) {
  if (reputationMode(restaurant) !== "shadow") return null;
  const key = input.source === "review_check" ? `reputation:review:${input.review.id}` : `reputation:${input.review.id}`;
  try {
    return await enqueueAgentJob({ restaurantId: restaurant.id, key, agent: "reputation", kind: "reputation_shadow", trigger: input.source === "pasted" ? "owner_forwarded_review" : "hourly_review_check", input });
  } catch (err) {
    console.error("Couldn't queue Reputation in shadow mode", err);
    return null;
  }
}

export function outcomeLine(outcome: ReputationOutcome) {
  const rev = outcome.revisions ? ` after ${outcome.revisions} revision${outcome.revisions === 1 ? "" : "s"}` : "";
  if (outcome.kind === "reply") return `would reply (checker ${outcome.checker.verdict}${rev}${outcome.minorFixesApplied ? `, ${outcome.minorFixesApplied} minor fix${outcome.minorFixesApplied === 1 ? "" : "es"} applied` : ""})`;
  return `would ask the owner${outcome.by === "checker" ? ` (the checker escalated${rev})` : ""}: ${outcome.question}`;
}

export async function runReputationShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as ShadowJobInput;
  const name = input.review.author_name;
  const { outcome, profileVersion } = await runReputationFor(job.restaurant_id, input.review, `${name}'s review (shadow)`);
  ok(
    await getSupabase()
      .from("shadow_drafts")
      .insert({
        restaurant_id: job.restaurant_id,
        agent: "reputation",
        agent_version: outcome.agentVersion,
        checker_version: outcome.checkerVersion,
        job_id: job.id,
        source: input.source,
        review_id: input.source === "review_check" ? input.review.id : null,
        review: input.review,
        legacy_draft_id: input.legacy_draft_id,
        legacy_text: input.legacy_text,
        outcome: outcome.kind,
        output: outcome.output,
        question: outcome.kind === "question" ? outcome.question : null,
        checker: outcome.checker,
        revisions: outcome.revisions,
        steps: outcome.steps,
        profile_version: profileVersion,
      }),
  );
  return {
    output: { outcome: outcome.kind, revisions: outcome.revisions, checker_version: outcome.checkerVersion, steps: outcome.steps },
    agentVersion: outcome.agentVersion,
    verdict: outcome.kind === "reply" ? outcome.checker.verdict : "question",
    actor: "reputation",
    action: "agent_drafted",
    detail: `Reputation (shadow, v${outcome.agentVersion}) on ${name}'s ${input.review.rating ?? "no"}-star review: ${outcomeLine(outcome)}`,
  };
}
