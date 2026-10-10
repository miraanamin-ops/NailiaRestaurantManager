// The rules for "How was your visit?" emails. Plain code with no imports, so
// every rule is unit-tested (tests/feedback.test.ts).

export const FEEDBACK_DELAY_HOURS = 3; // after a reward or offer is redeemed
export const FEEDBACK_GAP_DAYS = 30; // at most one feedback email per customer in this many days
export const FEEDBACK_STALE_HOURS = 24; // more than this late (e.g. sending was paused): don't send

const HOUR = 3_600_000;

export type FeedbackCustomer = {
  email: string | null;
  email_confirmed_at: string | null;
  unsubscribed_at: string | null;
  deleted_at: string | null;
};

export type FeedbackDecision = { action: "send" } | { action: "wait"; reason: string } | { action: "skip"; reason: string };

export function feedbackDecision(input: {
  dueAt: Date;
  now: Date;
  customer: FeedbackCustomer | null;
  lastSentAt: Date | null; // this customer's most recent feedback email, if any
  enabled: boolean; // the restaurant's feedback_emails setting
  paused: boolean;
  inSendWindow: boolean;
}): FeedbackDecision {
  const { customer, now } = input;
  if (!input.enabled) return { action: "skip", reason: "feedback emails are switched off" };
  if (!customer || customer.deleted_at) return { action: "skip", reason: "customer deleted their data" };
  if (!customer.email || !customer.email_confirmed_at) return { action: "skip", reason: "email not confirmed" };
  if (customer.unsubscribed_at) return { action: "skip", reason: "unsubscribed" };
  if (input.lastSentAt && now.getTime() - input.lastSentAt.getTime() < FEEDBACK_GAP_DAYS * 24 * HOUR) {
    return { action: "skip", reason: `already had one in the last ${FEEDBACK_GAP_DAYS} days` };
  }
  if (now < input.dueAt) return { action: "wait", reason: "not 3 hours yet" };
  if (now.getTime() - input.dueAt.getTime() > FEEDBACK_STALE_HOURS * HOUR) return { action: "skip", reason: "too long after the visit" };
  if (input.paused) return { action: "wait", reason: "sending is paused" };
  if (!input.inSendWindow) return { action: "wait", reason: "outside sending hours" };
  return { action: "send" };
}

// 1-3 stars count as negative: the owner hears straight away.
export const isNegative = (rating: number) => rating <= 3;

export function parseRating(raw: unknown) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

const stars = (n: number) => "⭐".repeat(n);

// What the owner sees on WhatsApp. Negative feedback includes the email so they can reply.
export function negativeAlert(f: { rating: number; comment: string | null; name: string; email: string | null }) {
  return [
    `🚨 *Private feedback: ${f.rating}★ from ${f.name}*`,
    f.comment ? `_"${f.comment}"_` : "_(no comment, just the rating)_",
    "",
    f.email ? `Only you can see this. To reply, email ${f.email}.` : "Only you can see this.",
  ].join("\n");
}

export function briefLines(items: { rating: number; comment: string | null; name: string }[]) {
  if (!items.length) return [];
  return [
    `💬 *Private feedback since yesterday:*`,
    ...items.map((f) => `- ${f.name} ${stars(f.rating)}${f.comment ? `: _"${f.comment.length > 160 ? `${f.comment.slice(0, 157)}…` : f.comment}"_` : ""}`),
  ];
}
