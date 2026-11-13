import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelTier } from "@/lib/agents/definition";

// One place for how the app calls Claude, so changing model is a one-line edit.
// Agent files name a tier (model: sonnet / haiku); this maps it to a model id.
export const MODELS: Record<ModelTier, string> = {
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

// The model everything outside the agent files uses. (The checker uses the same
// model for now; a cheaper one is to be tested later.)
export const MODEL = MODELS.sonnet;

// Thinking counts towards max_tokens as well as the reply, so leave plenty of
// room; you only pay for what's actually used.
export const MAX_TOKENS = 16000;

// If Claude declines a request, the API retries it on a fallback model inside the
// same call (Claude API only). Every request goes through the beta endpoint for this.
export const WITH_FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

// Haiku has no server-side fallback, so its requests go without one.
export function fallbackFor(tier: ModelTier) {
  return tier === "haiku" ? {} : WITH_FALLBACK;
}

// The Claude client. Every answer's tokens and cost are recorded in ai_usage
// (lib/ai-usage.ts) for the founder dashboard: `purpose` says what the call was for
// ("assistant", "agent:reputation", "sales"...); the restaurant comes from the
// running job or request (lib/ai-context.ts) unless it's given here.
export function claude(purpose = "other", restaurantId?: string | null) {
  const client = new Anthropic();
  const messages = client.beta.messages;
  const parse = messages.parse.bind(messages);
  const create = messages.create.bind(messages);
  const record = async (res: unknown, params: { model?: unknown; stream?: unknown }) => {
    const r = res as { model?: string; usage?: Parameters<typeof import("@/lib/agents/usage").tokensFrom>[1] } | null;
    if (params.stream || !r?.usage) return;
    const { recordAiUsage } = await import("@/lib/ai-usage");
    await recordAiUsage(purpose, r.model ?? (typeof params.model === "string" ? params.model : MODEL), r.usage, restaurantId);
  };
  messages.parse = (async (...args: Parameters<typeof parse>) => {
    const res = await parse(...args);
    await record(res, args[0]);
    return res;
  }) as unknown as typeof messages.parse;
  messages.create = (async (...args: Parameters<typeof create>) => {
    const res = await create(...args);
    await record(res, args[0] as { model?: unknown; stream?: unknown });
    return res;
  }) as unknown as typeof messages.create;
  return client;
}
