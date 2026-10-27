// Which Google review an owner means ("reply to the 2 star one from yesterday",
// "answer Tom's review"), and a question about the reviews ("which still need a
// reply?"), for the GM's reputation route. No imports, so it's unit-tested
// (tests/agents/agents-live.test.ts).

export type ReviewChoice = { id: string; author_name: string; rating: number; review_date: string; replied: boolean };

// "2 star", "2-star", "two stars", "2*", "⭐⭐"
const WORD_STARS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
export function starsMentioned(message: string): number | null {
  const m = message.toLowerCase();
  const digit = m.match(/\b([1-5])\s*(?:-\s*)?(?:stars?|\*)/);
  if (digit) return Number(digit[1]);
  const word = m.match(/\b(one|two|three|four|five)\s*(?:-\s*)?stars?\b/);
  if (word) return WORD_STARS[word[1]];
  const emoji = (message.match(/⭐/g) ?? []).length;
  return emoji >= 1 && emoji <= 5 ? emoji : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "").toLowerCase() ?? "";

// The review the message points at: a reviewer named in it, else the stars it
// mentions, newest first, not yet replied to before already replied. Null when
// nothing matches.
export function pickReview<T extends ReviewChoice>(message: string, reviews: T[]): T | null {
  const words = new Set(message.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}'-]+/u).filter((w) => w.length >= 3));
  const stars = starsMentioned(message);
  const named = reviews.filter((r) => words.has(firstName(r.author_name)));
  let pool = named.length ? named : reviews;
  if (stars) pool = pool.filter((r) => r.rating === stars);
  if (!named.length && !stars) pool = pool.filter((r) => !r.replied);
  const sorted = [...pool].sort((a, b) => Number(a.replied) - Number(b.replied) || b.review_date.localeCompare(a.review_date));
  return sorted[0] ?? null;
}

// "which reviews still need a reply?" asks about the reviews; "reply to the 2 star one" asks for a reply.
export function asksAboutReviews(message: string) {
  const m = message.trim().toLowerCase();
  const question = /^(which|what|how many|any|do we|have we|are there|show|list)\b/.test(m);
  if (/\b(reply to|respond to|answer|write (?:a )?reply|draft)\b/.test(m) && !question) return false;
  return question || /\?\s*$/.test(m);
}

// The reviews still waiting for a reply, newest first, in plain words (no AI).
export function waitingReviewsText(reviews: ReviewChoice[]) {
  const waiting = reviews.filter((r) => !r.replied).sort((a, b) => b.review_date.localeCompare(a.review_date));
  if (!waiting.length) return "Every review has a reply. 👍";
  const lines = waiting.slice(0, 5).map((r) => `- ${r.author_name.replace(/\.$/, "")}, ${r.rating} star${r.rating === 1 ? "" : "s"} (${r.review_date.slice(0, 10)})`);
  const more = waiting.length > 5 ? `\n…and ${waiting.length - 5} more` : "";
  const first = waiting[0].author_name.split(/\s+/)[0].replace(/\.$/, "");
  return `${waiting.length} review${waiting.length === 1 ? " is" : "s are"} waiting for a reply:\n${lines.join("\n")}${more}\n\nSay _reply to ${first}_ and I'll draft it.`;
}
