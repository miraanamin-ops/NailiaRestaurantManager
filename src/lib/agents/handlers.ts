import "server-only";
import { runCheckerShadow } from "./checker";
import { runGmBriefShadow, runGmShadow } from "./gm";
import { runGrowthShadow } from "./growth";
import { runInsightsShadow } from "./insights";
import { runAgentJobs, type JobHandler } from "./jobs";
import { runReputationShadow } from "./reputation";
import { runVisibilityLive, runVisibilityShadow } from "./visibility";

// Every kind of agent job, and what runs it.
export const AGENT_HANDLERS: Record<string, JobHandler> = {
  checker_shadow: runCheckerShadow,
  reputation_shadow: runReputationShadow,
  visibility_shadow: runVisibilityShadow,
  visibility_live: runVisibilityLive,
  insights_shadow: runInsightsShadow,
  growth_shadow: runGrowthShadow,
  gm_shadow: runGmShadow,
  gm_brief_shadow: runGmBriefShadow,
};

// Runs this restaurant's queued agent jobs. Called once the owner's reply has
// gone (webhook) and by the scheduled jobs, which also pick up anything left over.
export function runQueuedAgentJobs(restaurantId: string, limit = 3) {
  return runAgentJobs(restaurantId, AGENT_HANDLERS, { limit });
}
