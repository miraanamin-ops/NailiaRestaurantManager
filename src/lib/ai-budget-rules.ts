// Limits on how much AI one restaurant's chat can use (security review A2). Pure,
// unit-tested in tests/ai-budget.test.ts; lib/ai-budget.ts reads the numbers.
//
// Two limits, checked only where an owner starts AI work by typing (the app's Chat
// tab and WhatsApp), never on scheduled work: the 9am brief, review alerts and the
// Monday report keep running whatever happens.
//   - messages: at most AI_CHAT_PER_HOUR typed messages or files an hour per restaurant
//   - money:    at most AI_DAILY_CAP_USD of Claude calls per restaurant per UK day,
//               everything counted (ai_usage); the builder is told at 80%.

export const DEFAULT_DAILY_CAP_USD = 3;
export const DEFAULT_CHAT_PER_HOUR = 60;
export const WARN_AT = 0.8;

export type BudgetVerdict = { ok: true; warn: boolean } | { ok: false; why: "busy" | "budget" };

// Reads a setting like AI_DAILY_CAP_USD: a positive number, else the default.
export function positiveNumber(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function budgetVerdict(i: { overHourly: boolean; spentToday: number; capUsd: number }): BudgetVerdict {
  if (i.overHourly) return { ok: false, why: "busy" };
  if (i.spentToday >= i.capUsd) return { ok: false, why: "budget" };
  // (A hair of tolerance: 2.4 is 80% of 3, though 3 * 0.8 is 2.4000000000000004.)
  return { ok: true, warn: i.spentToday >= i.capUsd * WARN_AT - 1e-9 };
}

// What the owner sees instead of an answer. No numbers or costs: just when to come back.
export const REFUSAL_TEXT: Record<"busy" | "budget", string> = {
  busy: "That's a lot of messages in the last hour, so give me a few minutes before the next one. Approve, Edit and Skip still work as normal.",
  budget:
    "I've done a lot for you today, so I'm pausing chat until midnight. Your drafts, approvals, review alerts and tomorrow's 9am brief carry on as normal.",
};
