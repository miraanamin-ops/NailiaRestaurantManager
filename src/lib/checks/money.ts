// Money and risk check (plain code): the rules every send must pass, in order.
// Pure function (no database), so every rule is unit-tested; lib/send.ts calls it
// right before anything goes out, and records the result.
import { formatLondon, formatWindow, isInSendWindow, nextWindowStart } from "@/lib/clock";
import { overCap } from "@/lib/discounts";
import { offerCap, type OwnerOffers, type StructuredOffer } from "@/lib/offers";
import { gateApproval, type GateDraft } from "@/lib/trust";

export type RuleDraft = {
  status: string;
  approved_at: string | null;
  sent_at: string | null;
  scheduled_for: string | null;
  content: string;
  // For trust levels (lib/trust.ts): the task, the version, and the checker agent's verdict.
  kind?: string;
  version?: number;
  agent_check?: GateDraft["agent_check"];
  // A campaign's offer as structured fields (Growth's campaigns): the cap is checked from these.
  offer_details?: StructuredOffer | null;
  // A campaign's send time (Growth's send_at): it waits until then.
  send_at?: string | null;
};
export type RuleRestaurant = {
  paused: boolean;
  discount_cap_percent: number;
  send_window_start: string;
  send_window_end: string;
  // Per-task trust levels, set by the builder. Missing = Approve for everything.
  trust_levels?: Record<string, string> | null;
  // The menu, so a free item or £ off can be measured against the dish it comes with.
  menu?: unknown;
  // The owner's own offers (settings): not capped when an offer is exactly one of them.
  birthday_offer?: string | null;
  signup_reward?: string | null;
};
// approve: the owner tapped Approve. queue: a held draft being retried. test: TEST SEND.
export type SendSource = "approve" | "queue" | "test";

export type RuleDecision =
  | { outcome: "ok"; approvedBy?: "auto" }
  | { outcome: "blocked"; reason: "duplicate" | "not_approved" | "discount_cap" | "trust_level"; detail: string }
  | { outcome: "queued"; reason: "paused" | "outside_window" | "scheduled"; detail: string; scheduledFor: Date | null };

const SENDABLE = ["approved", "queued", "blocked"];

export function moneyAndRisk(draft: RuleDraft, restaurant: RuleRestaurant, now: Date, source: SendSource): RuleDecision {
  // No duplicates: a draft can only be sent once.
  if (draft.status === "sent" || draft.sent_at) {
    return {
      outcome: "blocked",
      reason: "duplicate",
      detail: `Already sent${draft.sent_at ? ` (${formatLondon(new Date(draft.sent_at))})` : ""}. Duplicates are blocked.`,
    };
  }
  if (draft.status === "queued" && source === "approve") {
    const when = draft.scheduled_for ? `for ${formatLondon(new Date(draft.scheduled_for))}` : "until you text RESUME";
    return { outcome: "blocked", reason: "duplicate", detail: `Already approved and queued ${when}. It will only go out once.` };
  }

  // A question for the owner (e.g. about a review alleging food poisoning) is never sent to anyone.
  if (["review_question", "hours_question", "agent_question", "choice", "profile_change", "special_idea"].includes(draft.kind ?? "")) {
    return { outcome: "blocked", reason: "not_approved", detail: "This is a question for you, not a message, so it's never sent." };
  }

  // Nothing sends without an Approve, unless the builder set its task to Auto and
  // the live checker passed it (never campaigns, offers, hours, menu or profile).
  // Draft-only tasks never send.
  const approval = gateApproval(
    { kind: draft.kind ?? "other", content: draft.content, version: draft.version, approved_at: draft.approved_at, agent_check: draft.agent_check },
    restaurant.trust_levels,
  );
  if (!approval.ok && approval.reason === "trust_level") return { outcome: "blocked", reason: "trust_level", detail: approval.detail };
  const sendable = approval.ok && approval.by === "auto" ? [...SENDABLE, "pending"] : SENDABLE;
  if (!approval.ok || !sendable.includes(draft.status)) {
    return { outcome: "blocked", reason: "not_approved", detail: `Draft hasn't been approved (status: ${draft.status}).` };
  }

  // No discount above the restaurant's cap: from the structured offer first (a free
  // item or £ off as a % of the dish it comes with), then from the wording as a backstop.
  if (draft.offer_details) {
    const cap = offerCap(draft.offer_details, restaurant.menu, restaurant.discount_cap_percent, { birthday_offer: restaurant.birthday_offer, signup_reward: restaurant.signup_reward });
    if (!cap.ok) return { outcome: "blocked", reason: "discount_cap", detail: `${cap.detail[0].toUpperCase()}${cap.detail.slice(1)}.` };
  }
  const over = overCap(draft.content, restaurant.discount_cap_percent);
  if (over) {
    return {
      outcome: "blocked",
      reason: "discount_cap",
      detail: `Offers ${over.percent}% off ("${over.phrase}"), above the ${restaurant.discount_cap_percent}% cap.`,
    };
  }

  // A campaign with a send time still ahead waits for it (and comes back through every rule then).
  if (draft.send_at && new Date(draft.send_at) > now) {
    const at = new Date(draft.send_at);
    return { outcome: "queued", reason: "scheduled", detail: `Scheduled for its send time, ${formatLondon(at)}.`, scheduledFor: at };
  }

  // Nothing sends while PAUSED: held until RESUME.
  if (restaurant.paused) {
    return { outcome: "queued", reason: "paused", detail: "Sending is paused. Held until RESUME.", scheduledFor: null };
  }

  // Only inside the sending window (9am-9pm UK time by default).
  if (!isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end)) {
    const at = nextWindowStart(now, restaurant.send_window_start);
    return {
      outcome: "queued",
      reason: "outside_window",
      detail: `Outside sending hours (${formatWindow(restaurant.send_window_start, restaurant.send_window_end)}, it's ${formatLondon(now)}). Queued for ${formatLondon(at)}.`,
      scheduledFor: at,
    };
  }
  return approval.by === "auto" ? { outcome: "ok", approvedBy: "auto" } : { outcome: "ok" };
}

// At draft time, only the discount cap can be checked (the rest depends on when it's sent).
export function moneyAtDraft(content: string, capPercent: number, offer?: { details: StructuredOffer; menu: unknown; owner?: OwnerOffers } | null) {
  const problems: string[] = [];
  if (offer) {
    const cap = offerCap(offer.details, offer.menu, capPercent, offer.owner);
    if (!cap.ok) problems.push(`${cap.detail}, so it will be blocked if you approve it`);
  }
  const over = overCap(content, capPercent);
  if (over) problems.push(`${over.percent}% off is above your ${capPercent}% cap, so it will be blocked if you approve it`);
  return problems;
}
