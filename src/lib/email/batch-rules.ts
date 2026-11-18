// Sending many customer emails at once (security review E1, E2). Pure, unit-tested
// in tests/email-batch.test.ts; lib/email/index.ts does the sending.
//
// Resend takes up to 100 emails in one batch call, so a campaign to 2,000 customers is
// 20 calls, not 2,000 (the old one-at-a-time loop could run out of time half way).
// Each batch call carries an idempotency key, so retrying it after a timeout never
// sends anyone the same email twice.

export const BATCH_SIZE = 100;
export const LOOKUP_CHUNK = 100; // ids per database ".in(...)" query (keeps the request short)
export const MAX_ATTEMPTS = 3;

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Worth trying again: Resend's rate limit, its own errors, or no answer at all.
// Not worth it: a bad address, a bad key, a used-up quota (it would fail the same way).
const RETRYABLE = new Set(["rate_limit_exceeded", "application_error", "internal_server_error", "concurrent_idempotent_requests"]);
export function isRetryable(err: { name?: string | null; statusCode?: number | null } | null | undefined) {
  if (!err) return false;
  // A named Resend error decides by its name (a used-up quota is also a 429).
  if (err.name) return RETRYABLE.has(err.name);
  if (err.statusCode == null) return true;
  return err.statusCode === 429 || err.statusCode >= 500;
}

// Waits between tries: 1 second, then 4.
export function backoffMs(attempt: number) {
  return attempt <= 1 ? 1000 : 4000;
}
