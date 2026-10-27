// The per-restaurant switch between the agents and the old assistant, as plain
// data, shared by scripts/assistant-mode.mjs and the app (src/lib/agents/assistant-mode.ts
// re-states it; tests/agents/assistant-mode.test.ts checks the two agree).
//   agents: the five agents and the checker live. The GM routes every owner
//           message; the old assistant never answers.
//   old:    every agent in shadow (they still run alongside and are compared on
//           /log); the old assistant answers everything, as before the agents.
export const ASSISTANT_AGENTS = ["reputation", "visibility", "insights", "growth", "gm", "checker"];

export function agentModesFor(mode, current) {
  if (mode !== "agents" && mode !== "old") throw new Error(`mode must be "agents" or "old", not "${mode}"`);
  const out = { ...(current ?? {}) };
  for (const a of ASSISTANT_AGENTS) out[a] = mode === "agents" ? "live" : "shadow";
  return out;
}

// "agents" when all six are set live, "old" when none is, "mixed" otherwise.
export function assistantModeOf(agentModes) {
  const live = ASSISTANT_AGENTS.filter((a) => agentModes?.[a] === "live").length;
  return live === ASSISTANT_AGENTS.length ? "agents" : live === 0 ? "old" : "mixed";
}
