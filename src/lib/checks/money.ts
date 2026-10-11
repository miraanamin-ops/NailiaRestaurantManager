// Money and risk check (plain code): the rules every send must pass, in order.
// Pure function (no database), so every rule is unit-tested; lib/send.ts calls it
// right before anything goes out, and records the result.
import { formatLondon, formatWindow, isInSendWindow, nextWindowStart } from "@/lib/clock";
import { overCap } from "@/lib/discounts";
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
};
export type RuleRestaurant = {
  paused: boolean;
  discount_cap_percent: number;
  send_window_start: string;
  send_window_end: string;
  // Per-task trust levels, set by the builder. Missing = Approve for everything.
  trust_levels?: Record<string, string> | null;
};
// approve: the owner tapped Approve. queue: a held draft being retried. test: TEST SEND.
export type SendSource = "approve" | "queue" | "test";

export type RuleDecision =
  | { outcome: "ok"; approvedBy?: "auto" }
  | { outcome: "blocked"; reason: "duplicate" | "not_approved" | "discount_cap" | "trust_level"; detail: string }
  | { outcome: "queued"; reason: "paused" | "outside_window"; detail: string; scheduledFor: Date | null };

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

  // No discount above the restaurant's cap.
  const over = overCap(draft.content, restaurant.discount_cap_percent);
  if (over) {
    return {
      outcome: "blocked",
      reason: "discount_cap",
      detail: `Offers ${over.percent}% off ("${over.phrase}"), above the ${restaurant.discount_cap_percent}% cap.`,
    };
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
export function moneyAtDraft(content: string, capPercent: number) {
  const over = overCap(content, capPercent);
  return over ? [`${over.percent}% off is above your ${capPercent}% cap, so it will be blocked if you approve it`] : [];
}
