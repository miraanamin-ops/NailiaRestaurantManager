// The app's Inbox cards and Today screen (step 50, phase 1), as plain code
// (tests/app-cards.test.ts). A draft becomes a card: what it is in plain words,
// the words that would go out, what it answers (a review), the four checks and
// which buttons it gets. lib/app/inbox.ts loads the rows and calls these.
import { CHECK_LABELS, CHECK_NAMES, type CheckStatus, type DraftChecks } from "@/lib/checks/types";
import { isQuestion, KIND_LABELS, OWNER_ONLY_KINDS, type Draft } from "@/lib/drafts";
import type { CardView } from "./card-views";

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
  urgent: boolean; // category urgent
  // approve/edit/skip: the usual three. answer: a question, answered in Chat (phase 3).
  actions: ("approve" | "edit" | "skip")[] | "answer";
  // What Approve does, in the owner's words ("Posts the reply on Google"). Older apps
  // show it under the card; since 15 Nov the button says it instead (approveLabel).
  approveHint: string;
  // Fewer words (15 Nov 2026, the owner's "less is more"): the Approve button's own
  // words ("Post reply"), one line for the closed card, and checks as one tick.
  approveLabel: string;
  preview: string; // at most PREVIEW_WORDS words
  allClear: boolean; // every check passed or was fixed: one tick, nothing else
  checkLine: string | null; // when not: what needs a look, at most CHECK_LINE_WORDS words
  // The thing itself, drawn by the app (lib/app/card-views.ts): the rota, the real email,
  // the Google post, an hours or menu change. Null for words-only drafts.
  view: CardView | null;
  // The Inbox's sections and colours (the owner's table, 12 Nov): the message type, and
  // its category (categoryOf). The older "tier" is the same as the category.
  type: { key: MessageTypeKey; label: string };
  category: Category;
  tier: Category;
  // Can "Approve all" take it: simple, every check passed (approveAllEligible).
  bulk: boolean;
  waitingSince: string;
};

const firstName = (author: string) => author.replace(/\.$/, "").trim();

// Word limits for what an owner sees on a closed card (tests/app-cards.test.ts).
export const TITLE_WORDS = 5;
export const PREVIEW_WORDS = 12;
export const CHECK_LINE_WORDS = 12;

const wordsOf = (text: string) => text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
// At most n words, ending in "…" if cut.
export function firstWords(text: string, n: number) {
  const w = wordsOf(text);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ").replace(/[,.;:!?]+$/, "")}…`;
}
// The first line that says something (a draft's text often starts with an emoji header).
const firstLine = (text: string) =>
  text
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /[a-z0-9]/i.test(l))
    // A leading emoji header ("🧑‍🍳 Next week's rota") is noise on a one-line preview.
    ?.replace(/^[^\p{L}\p{N}£$“"'(]+/u, "") ?? "";

export function cardTitle(d: Pick<Draft, "kind" | "audience" | "content">, review: CardReview | null, campaignName?: string | null) {
  const who = review ? wordsOf(firstName(review.author))[0] ?? "a guest" : null;
  let title: string;
  if (d.kind === "review_reply") title = who ? `Reply to ${who}` : "Review reply";
  else if (d.kind === "review_question") title = who ? `${who}'s review: your call` : "A review: your call";
  else if (d.kind === "hours_question") title = "Bank holiday hours";
  else if (d.kind === "email_campaign" || d.kind === "promotion") title = `Email: ${campaignName ?? "offer"}`;
  else title = SHORT_KIND[d.kind] ?? KIND_LABELS[d.kind] ?? "Draft";
  return firstWords(title, TITLE_WORDS);
}

const SHORT_KIND: Partial<Record<Draft["kind"], string>> = {
  google_post: "Google post",
  rota: "Next week's rota",
  hours_update: "Google hours change",
  menu_update: "Google menu change",
  profile_change: "Save to your details",
  profile_fix: "Google profile fixes",
  agent_question: "A quick question",
  choice: "Which did you mean?",
  special_idea: "An idea",
  import_welcome: "Welcome your imported list",
};

// The closed card's one line: the review, else the words that would go out.
export function cardPreview(body: string, review: CardReview | null) {
  return firstWords(review?.text ? `“${review.text}”` : firstLine(body), PREVIEW_WORDS);
}

// A card with a view gets its one line from the thing itself ("Mon 17 to Sun 23 Nov, £2,140").
export function viewPreview(view: CardView | null) {
  if (!view) return null;
  if (view.type === "rota") {
    const t = view.week.totals;
    const cost = t ? `, £${Math.round(t.costPence / 100).toLocaleString("en-GB")}` : "";
    return firstWords(`${view.week.label.replace(/\s+[–-]\s+/, " to ")}${cost}${view.week.openShifts ? `, ${view.week.openShifts} open` : ""}`, PREVIEW_WORDS);
  }
  if (view.type === "email") return view.subject ? firstWords(view.subject, PREVIEW_WORDS) : null;
  if (view.type === "change") {
    const r = view.rows[0];
    return firstWords(`${r.label ? `${r.label}: ` : ""}${r.from} → ${r.to}${view.rows.length > 1 ? `, +${view.rows.length - 1} more` : ""}`, PREVIEW_WORDS);
  }
  return null;
}

// What the Approve button says.
export function approveLabel(kind: Draft["kind"]) {
  switch (kind) {
    case "review_reply":
      return "Post reply";
    case "google_post":
      return "Publish post";
    case "email_campaign":
    case "promotion":
      return "Send email";
    case "rota":
      return "Publish rota";
    case "profile_change":
      return "Save";
    case "special_idea":
      return "Keep idea";
    case "hours_update":
    case "menu_update":
    case "profile_fix":
      return "Update Google";
    case "import_welcome":
      return "Start emails";
    default:
      return "Approve";
  }
}

// Checks as the owner cares about them: all fine (one tick), or the one thing to look at.
export function checkSummary(checks: CardCheck[], extraFlags: string[] = []) {
  const bad = checks.filter((c) => c.status === "flagged" || c.status === "blocked" || c.status === "failed");
  const note = bad.flatMap((c) => c.notes)[0] ?? extraFlags[0] ?? (bad.length ? `${bad[0].label} needs a look` : null);
  const allClear = checks.length > 0 && !bad.length && !extraFlags.length && checks.every((c) => c.status === "pass" || c.status === "fixed");
  return { allClear, checkLine: allClear || !note ? null : firstWords(note, CHECK_LINE_WORDS) };
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
  extra: { review: CardReview | null; campaignName?: string | null; previewImageUrl?: string | null; body: string; birthday?: boolean; view?: CardView | null },
): InboxCard {
  const checks = cardChecks(d.checks);
  const card: Omit<InboxCard, "tier" | "category" | "type" | "bulk"> = {
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
    urgent: false,
    actions: isQuestion(d.kind) ? "answer" : d.kind === "special_idea" ? ["approve", "skip"] : ["approve", "edit", "skip"],
    approveHint: approveHint(d.kind),
    approveLabel: approveLabel(d.kind),
    preview: viewPreview(extra.view ?? null) ?? cardPreview(extra.body, extra.review),
    view: extra.view ?? null,
    ...checkSummary(checks, d.check_notes?.flags ?? []),
    waitingSince: d.created_at,
  };
  const type = messageType(d.kind, extra.review?.rating ?? null, Boolean(extra.birthday));
  const category = categoryOf(type.key, card.flagged);
  return { ...card, urgent: category === "urgent", type, category, tier: category, bulk: approveAllEligible(category, checks) };
}

// ---------- The owner's categories (12 Nov 2026) ----------

// What each message is, as the owner thinks of it. A review reply depends on the stars;
// an email campaign is a birthday email when it goes to the birthday group.
export const MESSAGE_TYPES = {
  rota: "Rota",
  agent_question: "Questions",
  choice: "Quick checks",
  review_poor: "Poor reviews",
  review_question: "Review questions",
  email_offer: "Email offers",
  import_welcome: "Welcome emails",
  hours_update: "Hours changes",
  menu_update: "Menu changes",
  hours_question: "Bank holidays",
  profile_fix: "Google fixes",
  profile_change: "Facts to save",
  google_post: "Google posts",
  special_idea: "Ideas",
  review_good: "Good reviews",
  birthday_email: "Birthday emails",
  other: "Other",
} as const;
export type MessageTypeKey = keyof typeof MESSAGE_TYPES;

// urgent: open first, at the top; look: open it to check; later: not urgent (a tick on
// its card, but never in "Approve all"); simple: a tick, and "Approve all".
export type Category = "urgent" | "look" | "later" | "simple";
export const CATEGORY_OF: Record<MessageTypeKey, Category> = {
  rota: "urgent",
  agent_question: "urgent",
  choice: "urgent",
  review_poor: "look",
  review_question: "look",
  email_offer: "look",
  import_welcome: "look",
  hours_update: "look",
  menu_update: "look",
  hours_question: "look",
  profile_fix: "look",
  profile_change: "look",
  google_post: "later",
  special_idea: "later",
  review_good: "simple",
  birthday_email: "simple",
  other: "look",
};
export const CATEGORY_ORDER: Category[] = ["urgent", "look", "later", "simple"];

export function messageType(kind: string, rating: number | null, birthday: boolean): { key: MessageTypeKey; label: string } {
  let key: MessageTypeKey;
  if (kind === "review_reply") key = (rating ?? 0) >= 4 ? "review_good" : "review_poor";
  else if (kind === "email_campaign" || kind === "promotion") key = birthday ? "birthday_email" : "email_offer";
  else key = kind in MESSAGE_TYPES ? (kind as MessageTypeKey) : "other";
  return { key, label: MESSAGE_TYPES[key] };
}

// A draft a check flagged always needs a look, whatever its type (urgent stays urgent).
export function categoryOf(key: MessageTypeKey, flagged: boolean): Category {
  const c = CATEGORY_OF[key];
  return flagged && c !== "urgent" ? "look" : c;
}

// "Approve all" only ever takes simple items whose every check passed (or was fixed).
export function approveAllEligible(category: Category, checks: Pick<CardCheck, "status">[]) {
  return category === "simple" && checks.length > 0 && checks.every((x) => x.status === "pass" || x.status === "fixed");
}

// By category (urgent, look, not urgent, simple), then by type in the owner's order,
// then oldest first: the order an owner should clear them in.
const TYPE_ORDER = Object.keys(MESSAGE_TYPES) as MessageTypeKey[];
export function sortCards(cards: InboxCard[]) {
  const rank = (c: InboxCard) => CATEGORY_ORDER.indexOf(c.category) * 100 + TYPE_ORDER.indexOf(c.type.key);
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.waitingSince.localeCompare(b.waitingSince));
}

// Today's "Waiting for you": one tile per message type with its count (none at zero).
export type TypeTile = { key: MessageTypeKey; label: string; category: Category; count: number };
export function typeTiles(cards: Pick<InboxCard, "type" | "category">[]): TypeTile[] {
  const tiles = new Map<MessageTypeKey, TypeTile>();
  for (const c of cards) {
    const t = tiles.get(c.type.key) ?? { key: c.type.key, label: c.type.label, category: c.category, count: 0 };
    t.count++;
    // A flagged one makes its tile need a look too.
    if (CATEGORY_ORDER.indexOf(c.category) < CATEGORY_ORDER.indexOf(t.category)) t.category = c.category;
    tiles.set(c.type.key, t);
  }
  return [...tiles.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || TYPE_ORDER.indexOf(a.key) - TYPE_ORDER.indexOf(b.key));
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
