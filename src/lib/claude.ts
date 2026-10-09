import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// One place for how the app calls Claude, so changing model is a one-line edit.
// (The checker uses the same model for now; a cheaper one is to be tested later.)
export const MODEL = "claude-sonnet-5-5";

// Thinking counts towards max_tokens as well as the reply, so leave plenty of
// room; you only pay for what's actually used.
export const MAX_TOKENS = 16000;

// If Claude declines a request, the API retries it on a fallback model inside the
// same call (Claude API only). Every request goes through the beta endpoint for this.
export const WITH_FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

export function claude() {
  return new Anthropic();
}
