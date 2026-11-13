import { AsyncLocalStorage } from "node:async_hooks";

// Which restaurant (and queue job) the code running right now is working for, so
// every Claude call can be counted against the right restaurant in ai_usage
// (lib/ai-usage.ts) without passing an id through every function. Set by the
// queue worker for each job, by the app's login wrapper and by the setup chat.

export type AiContext = { restaurantId?: string | null; jobType?: string | null };

const store = new AsyncLocalStorage<AiContext>();

export function aiContext(): AiContext {
  return store.getStore() ?? {};
}

// Runs fn with the context added to whatever is already set.
export function withAiContext<T>(ctx: AiContext, fn: () => T): T {
  return store.run({ ...aiContext(), ...ctx }, fn);
}

// Sets the context for the rest of this request (a route handler that already
// knows its restaurant). Prefer withAiContext where a callback fits.
export function enterAiContext(ctx: AiContext) {
  store.enterWith({ ...aiContext(), ...ctx });
}
