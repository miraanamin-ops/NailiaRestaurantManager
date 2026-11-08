// Opening the WhatsApp conversation when the owner hasn't messaged in 24 hours
// (step 46). Plain rules, no database: what to hold, which approved template
// opens the chat, and whether one may be sent now. Sending and the outbox are in
// lib/outbox.ts; the wording is in lib/whatsapp-templates.json.
import templates from "./whatsapp-templates.json";

export type OpenerKind = "brief" | "review" | "feedback" | "report" | "rota" | "update";
// What a proactive message asks for: a template, "alert" (worked out from the
// text: a review or feedback alert, else an update) or "none" (just held for the
// owner's next message, e.g. a redeemed reward).
export type OpenerRequest = OpenerKind | "alert" | "none";

export const OPENER_KINDS = Object.keys(templates.templates) as OpenerKind[];
export const OPENER_SHOW_ID = templates.showButtonId;
export const URGENT_OPENERS: ReadonlySet<OpenerKind> = new Set(["review", "feedback"]);

const HOUR = 60 * 60 * 1000;
export const FREE_MESSAGING_HOURS = 24;
// An urgent alert sends its own opener, unless one went in the last few minutes
// (one alert can be several messages).
const URGENT_GAP_MS = 10 * 60 * 1000;
// Anything else: not while an opener from the last 20 hours is still unanswered.
const UNANSWERED_GAP_MS = 20 * HOUR;
// Held messages older than this aren't sent (a week-old draft is stale).
export const OUTBOX_MAX_AGE_MS = 7 * 24 * HOUR;

export function templateFor(kind: OpenerKind) {
  return templates.templates[kind];
}

export function withinWindow(lastInboundAt: Date | null, now: Date) {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < FREE_MESSAGING_HOURS * HOUR);
}

// The template and its variables for a held message. Null = no template ("none").
export function resolveOpener(
  request: OpenerRequest,
  text: string,
  who: { ownerName: string | null; restaurantName: string; reportLabel?: string; briefSummary?: string },
): { kind: OpenerKind; vars: Record<string, string> } | null {
  if (request === "none") return null;
  const name = (who.ownerName ?? "").trim().split(/\s+/)[0] || "there";
  const place = who.restaurantName.trim() || "your restaurant";
  let kind: OpenerKind = request === "alert" ? "update" : request;
  let stars: string | null = null;
  if (request === "alert" || request === "review" || request === "feedback") {
    const review = text.match(/\b([1-5])-star review\b/);
    const feedback = text.match(/Private feedback: ([1-5])★/);
    if (review && request !== "feedback") [kind, stars] = ["review", review[1]];
    else if (feedback && request !== "review") [kind, stars] = ["feedback", feedback[1]];
    else kind = "update"; // couldn't read the stars: the general opener still opens the chat
  }
  switch (kind) {
    case "brief":
      return { kind, vars: { 1: name, 2: place, 3: who.briefSummary || "a summary of yesterday" } };
    case "review":
    case "feedback":
      return { kind, vars: { 1: name, 2: place, 3: stars! } };
    case "report":
      return { kind, vars: { 1: name, 2: who.reportLabel || "latest", 3: place } };
    default:
      return { kind, vars: { 1: name, 2: place } };
  }
}

// "3 things to approve" for the brief opener.
export function briefSummary(waiting: number) {
  if (waiting <= 0) return "a summary of yesterday";
  return waiting === 1 ? "1 thing to approve" : `${waiting} things to approve`;
}

// May an opener go now? Brief: always (it's once a day). Urgent: unless one went
// in the last 10 minutes. Others: unless one sent in the last 20 hours is still
// unanswered (no message from the owner since).
export function mayOpen(kind: OpenerKind, s: { now: Date; lastOpenerAt: Date | null; lastInboundAt: Date | null }) {
  if (kind === "brief" || !s.lastOpenerAt) return true;
  const since = s.now.getTime() - s.lastOpenerAt.getTime();
  if (URGENT_OPENERS.has(kind)) return since >= URGENT_GAP_MS;
  const answered = Boolean(s.lastInboundAt && s.lastInboundAt.getTime() > s.lastOpenerAt.getTime());
  return answered || since >= UNANSWERED_GAP_MS;
}

// The text version of a template (the message log, and phones without buttons).
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[n] ?? "");
}
