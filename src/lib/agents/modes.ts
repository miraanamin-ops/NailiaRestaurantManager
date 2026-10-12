// Each agent runs off, in shadow (its work is recorded and compared, nothing
// changes for the owner) or live, per restaurant. Only the builder switches it.
// No imports, so it's unit-tested.
import type { AgentName } from "./definition";

export const AGENT_MODES = ["off", "shadow", "live"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

// What each agent can be set to in this phase, and its default. An agent can only
// go live once it's built to (and, from phase 2, its go-live checklist passes).
export const MODES_AVAILABLE: Partial<Record<AgentName, { allowed: AgentMode[]; default: AgentMode }>> = {
  checker: { allowed: ["off", "shadow"], default: "shadow" },
  // Live only once its go-live checklist passes (lib/agents/reputation.ts reputationMode).
  reputation: { allowed: ["off", "shadow", "live"], default: "shadow" },
  // Live only once its go-live checklist passes (lib/agents/visibility.ts visibilityMode).
  visibility: { allowed: ["off", "shadow", "live"], default: "shadow" },
};

export function agentMode(restaurant: { agent_modes?: Record<string, string> | null }, agent: AgentName): AgentMode {
  const available = MODES_AVAILABLE[agent];
  if (!available) return "off";
  const set = restaurant.agent_modes?.[agent];
  return set && (available.allowed as string[]).includes(set) ? (set as AgentMode) : available.default;
}
