// The guided flow after the business review, as pure rules (no database): the
// order of the steps, what the owner's taps and words mean, and the fixed words.
// "Let's go" (or GO) starts it; one action at a time, each with buttons; "Next?"
// after each; STOP or LATER ends it, and whatever is left waits in the next
// morning brief (the drafts are already held for it).
import { FLOW_PREFIX } from "./config";

// The order the owner goes through them. A step with nothing in it is passed over.
export const FLOW_STEPS = ["replies", "negative_replies", "profile", "themes", "audiences", "campaigns", "poster"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const STEP_TITLES: Record<FlowStep, string> = {
  replies: "your review replies",
  negative_replies: "replies to the harder reviews",
  profile: "your Google profile fixes",
  themes: "what customers say",
  audiences: "which dates to plan for",
  campaigns: "your planned campaigns",
  poster: "your QR poster",
};

export type FlowState = { done?: FlowStep[]; queue?: string[]; asked?: string[] };

// The next step to show: the first in order not done yet that has something in it.
export function nextStep(done: readonly FlowStep[], available: readonly FlowStep[]): FlowStep | null {
  return FLOW_STEPS.find((s) => !done.includes(s) && available.includes(s)) ?? null;
}

// ---------- What a tap or a word means ----------

export type FlowInput =
  | { kind: "go" } // start, or carry on
  | { kind: "next" }
  | { kind: "stop" }
  | { kind: "choose"; step: FlowStep; choice: string } // a step's own button
  | { kind: "number"; n: number }; // a typed 1, 2 or 3 for the buttons on screen

export const flowId = (reviewId: string, action: string) => `${FLOW_PREFIX}${reviewId}:${action}`;

// "review:<id>:go", "review:<id>:next", "review:<id>:stop", "review:<id>:<step>:<choice>".
export function parseFlowButton(payload: string | undefined): { reviewId: string; input: FlowInput } | null {
  if (!payload?.startsWith(FLOW_PREFIX)) return null;
  const [reviewId, action, choice] = payload.slice(FLOW_PREFIX.length).split(":");
  if (!reviewId || !action || !/^[0-9a-f-]{36}$/i.test(reviewId)) return null;
  if (action === "go") return { reviewId, input: { kind: "go" } };
  if (action === "next") return { reviewId, input: { kind: "next" } };
  if (action === "stop") return { reviewId, input: { kind: "stop" } };
  if ((FLOW_STEPS as readonly string[]).includes(action) && choice) return { reviewId, input: { kind: "choose", step: action as FlowStep, choice } };
  return null;
}

// Typed words, only while the flow is going (or, for GO, once the review is out).
// Numbers only mean a button when no draft is waiting on screen for Approve/Edit/Skip.
export function parseFlowWords(body: string, opts: { flowOn: boolean; draftOnScreen: boolean }): FlowInput | null {
  const t = body.trim().replace(/[.!]+$/, "").toLowerCase();
  if (/^(go|let'?s go|yes,? go)$/.test(t)) return { kind: "go" };
  if (!opts.flowOn) return null;
  if (/^(next|next one|ok,? next|carry on|continue)$/.test(t)) return { kind: "next" };
  if (/^(stop|later|stop for now|not now|that'?s enough)$/.test(t)) return { kind: "stop" };
  if (!opts.draftOnScreen && /^[1-3]$/.test(t)) return { kind: "number", n: Number(t) };
  return null;
}

// ---------- The fixed words ----------

export const NEXT_BUTTONS = (reviewId: string, upNext: FlowStep | null) =>
  upNext
    ? [
        { id: flowId(reviewId, "next"), title: "Next" },
        { id: flowId(reviewId, "stop"), title: "Stop for now" },
      ]
    : [];

export function nextPrompt(upNext: FlowStep | null) {
  return upNext ? `Next? Up next: ${STEP_TITLES[upNext]}.` : null;
}

export const STOPPED = "No problem. Everything else is waiting for you in tomorrow morning's brief. Reply GO any time to carry on.";
export const ALL_DONE = "That's everything from your review. 🎉 Anything still waiting is in tomorrow morning's brief. Message me any time.";
export const NOTHING_TO_DO = "There's nothing waiting from your review. Message me any time.";
