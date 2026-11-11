// The app's Inbox cards and Today screen (step 50, phase 1), as plain code
// (tests/app-cards.test.ts). A draft becomes a card: what it is in plain words,
// the words that would go out, what it answers (a review), the four checks and
// which buttons it gets. lib/app/inbox.ts loads the rows and calls these.
import { CHECK_LABELS, CHECK_NAMES, type CheckStatus, type DraftChecks } from "@/lib/checks/types";
import { isQuestion, KIND_LABELS, OWNER_ONLY_KINDS, type Draft } from "@/lib/drafts";

export type CardReview = { author: string; rating: number; text: string | null };
export type CardCheck = { name: string; label: string; status: CheckStatus; notes: string[] };

export type InboxCard = {
  id: string;
  kind: Draft["kind"];
  kindLabel: string;
  title: string;
  body: string; // the words that would go out (or the question)
  audience: string | null;
  review: CardReview | null;
  previewImageUrl: string | null; // an email campaign's picture
  checks: CardCheck[];
  flagged: boolean; // a check wants the owner to look
  urgent: boolean; // a 1 to 3 star review
  // approve/edit/skip: the usual three. answer: a question, answered in Chat (phase 3).
  actions: ("approve" | "edit" | "skip")[] | "answer";
  // What Approve does, in the owner's words ("Posts the reply on Google").
  approveHint: string;
  waitingSince: string;
};

const firstName = (author: string) => author.replace(/\.$/, "").trim();

export function cardTitle(d: Pick<Draft, "kind" | "audience" | "content">, review: CardReview | null, campaignName?: string | null) {
  if (d.kind === "review_reply" && review) return `Reply to ${firstName(review.author)}'s ${review.rating}-star review`;
  if (d.kind === "review_question") return review ? `Your call on ${firstName(review.author)}'s ${review.rating}-star review` : "Your call on a review";
  if (d.kind === "hours_question") return d.audience ?? "Your hours on a bank holiday";
  if (d.kind === "email_campaign") return `Email: ${campaignName ?? "offer"}${d.audience ? ` to ${d.audience}` : ""}`;
  if (d.kind === "google_post") return "Google post";
  return `${KIND_LABELS[d.kind] ?? "Draft"}${d.audience && !OWNER_ONLY_KINDS.has(d.kind) ? ` for ${d.audience}` : ""}`;
}

export function approveHint(kind: Draft["kind"]) {
  switch (kind) {
    case "review_reply":
      return "Posts this reply on Google";
    case "google_post":
      return "Publishes this post on Google";
    case "email_campaign":
      return "Sends the email to these customers, in sending hours";
    case "rota":
      return "Publishes the rota to your team";
    case "profile_change":
      return "Saves this to your details";
    case "special_idea":
      return "Keeps the idea for a draft";
    case "hours_update":
    case "menu_update":
    case "profile_fix":
      return "Updates your Google profile";
    case "import_welcome":
      return "Starts the welcome emails";
    default:
      return "Sends it after the safety checks";
  }
}

// Draft-time checks first; send-time results (consent, the cap, sending hours) win where both exist.
export function cardChecks(checks: DraftChecks | null): CardCheck[] {
  if (!checks) return [];
  return CHECK_NAMES.filter((n) => checks[n]).map((n) => {
    const r = (n === "compliance" || n === "money" ? checks.send?.[n] : undefined) ?? checks[n]!;
    return { name: n, label: CHECK_LABELS[n], status: r.status, notes: [...r.flags, ...r.fixes] };
  });
}

export function toCard(
  d: Draft,
  extra: { review: CardReview | null; campaignName?: string | null; previewImageUrl?: string | null; body: string },
): InboxCard {
  const checks = cardChecks(d.checks);
  return {
    id: d.id,
    kind: d.kind,
    kindLabel: KIND_LABELS[d.kind] ?? "Draft",
    title: cardTitle(d, extra.review, extra.campaignName),
    body: extra.body,
    audience: d.audience,
    review: extra.review,
    previewImageUrl: extra.previewImageUrl ?? null,
    checks,
    flagged: checks.some((c) => c.status === "flagged" || c.status === "blocked") || Boolean(d.check_notes?.flags?.length),
    urgent: d.kind === "review_reply" && Boolean(extra.review && extra.review.rating <= 3),
    actions: isQuestion(d.kind) ? "answer" : d.kind === "special_idea" ? ["approve", "skip"] : ["approve", "edit", "skip"],
    approveHint: approveHint(d.kind),
    waitingSince: d.created_at,
  };
}

// Urgent first (bad reviews), then flagged, then oldest first: the order an owner should clear them in.
export function sortCards(cards: InboxCard[]) {
  const rank = (c: InboxCard) => (c.urgent ? 0 : c.flagged ? 1 : 2);
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.waitingSince.localeCompare(b.waitingSince));
}

// "3 to approve: 2 review replies, 1 email"
export function waitingSummary(cards: Pick<InboxCard, "kind">[]) {
  if (!cards.length) return { count: 0, line: "Nothing waiting. All done for now." };
  const names: Record<string, [string, string]> = {
    review_reply: ["review reply", "review replies"],
    email_campaign: ["email", "emails"],
    google_post: ["Google post", "Google posts"],
    rota: ["rota", "rotas"],
    review_question: ["question", "questions"],
    hours_question: ["question", "questions"],
    agent_question: ["question", "questions"],
    choice: ["question", "questions"],
  };
  const groups = new Map<string, { n: number; word: [string, string] }>();
  for (const c of cards) {
    const word = names[c.kind] ?? ["other item", "other items"];
    const g = groups.get(word[0]) ?? { n: 0, word };
    g.n++;
    groups.set(word[0], g);
  }
  const parts = [...groups.values()].map((g) => `${g.n} ${g.n === 1 ? g.word[0] : g.word[1]}`);
  return { count: cards.length, line: parts.join(", ") };
}

// Yesterday's takings against the same day last week: "£2,340" and "+8%".
export function takingsLine(yesterday: number | null, weekBefore: number | null) {
  if (yesterday === null) return null;
  const amount = `£${Math.round(yesterday).toLocaleString("en-GB")}`;
  if (!weekBefore) return { amount, change: null as string | null };
  const pct = Math.round(((yesterday - weekBefore) / weekBefore) * 100);
  return { amount, change: `${pct >= 0 ? "+" : ""}${pct}% vs last week` };
}
