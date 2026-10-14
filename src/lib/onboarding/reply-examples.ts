// The review replies the owner picked during onboarding ("Reply to reviews"),
// kept in the profile's `examples` field (restaurants.profile_examples). Every
// review reply then follows the matching example. Plain code, unit-tested
// (tests/onboarding-replies.test.ts).

export type ReplyExample = { review: string; reply: string; style: string | null; own: boolean };
export type ProfileExamples = { review_replies?: { positive?: ReplyExample; negative?: ReplyExample } };
type Choice = { review: string; replies: { style: string; reply: string }[] };

// What the owner chose for one review: a suggestion's number (1 to 3), or their own words.
export function pickExample(choice: Choice, answer: { n?: number; own?: string }): ReplyExample | null {
  const own = answer.own?.trim();
  if (own && own.length >= 15) return { review: choice.review, reply: own.slice(0, 1200), style: null, own: true };
  const picked = answer.n ? choice.replies[answer.n - 1] : undefined;
  return picked ? { review: choice.review, reply: picked.reply, style: picked.style, own: false } : null;
}

// The example for a review with this rating: 4 or 5 stars follow the positive one,
// 1 to 3 the negative one (falling back to whichever exists).
export function exampleFor(examples: ProfileExamples | null | undefined, rating: number | null) {
  const r = examples?.review_replies;
  if (!r) return null;
  const negative = rating !== null && rating <= 3;
  return (negative ? (r.negative ?? r.positive) : (r.positive ?? r.negative)) ?? null;
}

// The line added to the reply-writing prompt.
export function examplePrompt(example: ReplyExample | null) {
  if (!example) return "";
  return `\n\nThe owner picked this as the way they like to answer a review like this. Match its tone, length, warmth and structure, but write fresh words for this review (never copy it):\nExample review: """${example.review}"""\nTheir reply: """${example.reply}"""`;
}
