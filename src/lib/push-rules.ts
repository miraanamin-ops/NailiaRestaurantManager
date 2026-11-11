// Push notifications to the DinerAI app (step 50, phase 2), as plain code
// (tests/push.test.ts): what each notification says, which buttons it gets,
// quiet hours, and when a "haven't seen you" nudge is due. lib/push.ts sends.
import type { OpenerRequest } from "@/lib/openers";

// The buttons on a notification (set up in the app: mobile/src/lib/notifications.ts).
//   draft  Approve (Face ID first) · Open      a single draft, e.g. a bad review's reply
//   brief  Open                               the morning brief
//   info   (none: a tap opens the app)
export type PushCategory = "draft" | "brief" | "info";

export type PushMessage = {
  title: string;
  body: string;
  category: PushCategory;
  data: { screen: "today" | "inbox"; draftId?: string; kind: string };
  urgent: boolean;
};

const clean = (text: string) =>
  text
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

// The first line that says something, cut to fit a notification.
export function headline(text: string, max = 120) {
  const line = clean(text).split("\n").find((l) => l.trim().length > 3) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// A proactive message (the same text WhatsApp would get) as a notification.
export function pushFor(request: OpenerRequest, text: string, draftId?: string | null): PushMessage {
  const review = text.match(/\b([1-5])-star review\b/);
  const feedback = text.match(/Private feedback: ([1-5])★/);
  const kind = request === "alert" ? (review ? "review" : feedback ? "feedback" : "update") : request;
  const withDraft = draftId ? { draftId } : {};
  switch (kind) {
    case "review":
      return { title: `New ${review?.[1] ?? ""}-star review`.replace("  ", " "), body: "I've drafted a careful reply. Check it before it's posted.", category: draftId ? "draft" : "info", data: { screen: "inbox", kind, ...withDraft }, urgent: true };
    case "feedback":
      return { title: `A customer rated their visit ${feedback?.[1] ?? "low"} out of 5`, body: headline(text.split("\n").slice(1).join("\n")) || "They left a private note for you.", category: "info", data: { screen: "inbox", kind }, urgent: true };
    case "rota":
      return { title: "Next week's rota is ready", body: "Check it and approve it in one tap.", category: draftId ? "draft" : "info", data: { screen: "inbox", kind, ...withDraft }, urgent: false };
    case "report":
      return { title: "Your report is ready", body: headline(text) || "Your latest numbers, in charts.", category: "info", data: { screen: "today", kind }, urgent: false };
    case "none":
      return { title: "DinerAI", body: headline(text), category: "info", data: { screen: "today", kind: "info" }, urgent: false };
    default:
      return { title: "DinerAI", body: headline(text) || "Something needs a quick look.", category: draftId ? "draft" : "info", data: { screen: draftId ? "inbox" : "today", kind: "update", ...withDraft }, urgent: false };
  }
}

// The morning brief as one notification.
export function briefPush(input: { waiting: number; takings?: string | null; firstName?: string | null }): PushMessage {
  const hello = `Good morning${input.firstName ? `, ${input.firstName}` : ""}`;
  const parts = [input.takings ? `Yesterday ${input.takings}.` : null, input.waiting ? `${input.waiting} ${input.waiting === 1 ? "thing" : "things"} to approve.` : "Nothing to approve today."].filter(Boolean);
  return { title: `☀️ ${hello}`, body: parts.join(" "), category: input.waiting ? "brief" : "info", data: { screen: input.waiting ? "inbox" : "today", kind: "brief" }, urgent: false };
}

// "HH:MM" on the London clock, inside a quiet window that may cross midnight (22:00 to 07:00).
export function inQuietHours(londonMinutes: number, start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return false;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const [s, e] = [m(start), m(end)];
  if (s === e) return false;
  return s < e ? londonMinutes >= s && londonMinutes < e : londonMinutes >= s || londonMinutes < e;
}

const DAY = 86_400_000;
// One friendly nudge after 3 days without opening the app, at most once a week.
export function nudgeDue(now: Date, lastSeenAt: Date, lastNudgeAt: Date | null) {
  return now.getTime() - lastSeenAt.getTime() >= 3 * DAY && (!lastNudgeAt || now.getTime() - lastNudgeAt.getTime() >= 7 * DAY);
}

export function nudgePush(waiting: number, idea: string | null): PushMessage {
  return {
    title: "We haven't seen you in a while 👋",
    body: idea ? `Here's an idea to bring in more covers this week: ${headline(idea, 90)}` : waiting ? `${waiting} ${waiting === 1 ? "draft is" : "drafts are"} ready to bring in more covers. One tap each.` : "Let me help you bring in more covers this week. Tell me your quietest day.",
    category: "info",
    data: { screen: waiting ? "inbox" : "today", kind: "nudge" },
    urgent: false,
  };
}
