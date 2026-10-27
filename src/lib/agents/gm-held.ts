import "server-only";
import { createDraft } from "@/lib/drafts";
import type { Restaurant } from "@/lib/supabase";

// The GM live (see gmMode): what scheduled work wants from the owner goes in the
// morning brief instead of being messaged on its own. A question from an agent
// (answered in words, back to that agent) and a special idea (Like it / Skip;
// Draft only, nothing is ever sent).

export async function gmIsLive(r: Restaurant) {
  const { gmMode } = await import("./gm");
  return (await gmMode(r)) === "live";
}

export async function holdAgentQuestion(r: Restaurant, agent: "growth" | "insights", question: string, job: Record<string, unknown> = {}) {
  return createDraft({ restaurantId: r.id, kind: "agent_question", content: question, audience: "you", request: `A question from ${agent}`, checks: {}, mode: "hold", actor: agent, agentInput: { agent, job } });
}

// A question an agent asks while the owner is talking to it (an owner request):
// on screen now, so the owner's typed answer goes back to that agent with the
// original request (gm-live answerAgentQuestion).
export async function askOwnerNow(r: Restaurant, agent: "growth" | "insights", question: string, job: Record<string, unknown> = {}) {
  return createDraft({ restaurantId: r.id, kind: "agent_question", content: question, audience: "you", request: `A question from ${agent}`, checks: {}, mode: "present", actor: agent, agentInput: { agent, job } });
}

export async function holdSpecialIdea(r: Restaurant, idea: string) {
  return createDraft({ restaurantId: r.id, kind: "special_idea", content: idea, audience: "you (an idea for the menu)", request: "This week's special idea", checks: {}, mode: "hold", actor: "growth" });
}
