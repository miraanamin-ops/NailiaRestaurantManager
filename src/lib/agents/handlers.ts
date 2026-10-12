import "server-only";
import { runCheckerShadow } from "./checker";
import { runAgentJobs, type JobHandler } from "./jobs";
import { runReputationShadow } from "./reputation";
import { runVisibilityLive, runVisibilityShadow } from "./visibility";

// Every kind of agent job, and what runs it.
export const AGENT_HANDLERS: Record<string, JobHandler> = {
  checker_shadow: runCheckerShadow,
  reputation_shadow: runReputationShadow,
  visibility_shadow: runVisibilityShadow,
  visibility_live: runVisibilityLive,
};

// Runs this restaurant's queued agent jobs. Called once the owner's reply has
// gone (webhook) and by the scheduled jobs, which also pick up anything left over.
export function runQueuedAgentJobs(restaurantId: string, limit = 3) {
  return runAgentJobs(restaurantId, AGENT_HANDLERS, { limit });
}
