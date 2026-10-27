// The per-restaurant switch between the agents and the old assistant (the same
// rule as scripts/lib/assistant-modes.mjs, which scripts/assistant-mode.mjs uses;
// tests/agents/assistant-mode.test.ts checks the two agree). No imports, so it's
// unit-tested.
//   agents: the five agents and the checker live. The GM routes every owner
//           message; the old assistant never answers.
//   old:    every agent in shadow (they still run alongside and are compared on
//           /log); the old assistant answers everything, as before the agents.
// "Set live" is what the builder chose: each agent still only runs live once
// AGENTS_LIVE_ALLOWED is true and its own readiness check passes (lib/switches.ts).

export const ASSISTANT_AGENTS = ["reputation", "visibility", "insights", "growth", "gm", "checker"] as const;
export type AssistantMode = "agents" | "old";

export function agentModesFor(mode: AssistantMode, current: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = { ...(current ?? {}) };
  for (const a of ASSISTANT_AGENTS) out[a] = mode === "agents" ? "live" : "shadow";
  return out;
}

export function assistantModeOf(agentModes: Record<string, string> | null | undefined): AssistantMode | "mixed" {
  const live = ASSISTANT_AGENTS.filter((a) => agentModes?.[a] === "live").length;
  return live === ASSISTANT_AGENTS.length ? "agents" : live === 0 ? "old" : "mixed";
}
