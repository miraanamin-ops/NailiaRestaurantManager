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

export function claude() {
  return new Anthropic();
}
