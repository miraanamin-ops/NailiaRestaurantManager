// The Reputation agent's output, and the plain-code rules every reply must pass
// (on top of the shared draft rules). Used to check each answer (one retry if it
// fails) and by the agent tests. Zod and pure code only, so it's unit-tested.
import { z } from "zod";
import { draftProblems, type Problems } from "./schema";

// What Reputation returns for one review (reputation.md "Output").
export const ReputationReply = z.object({
  type: z.literal("review_reply"),
  channel: z.literal("google"),
  review_id: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
  content: z.object({ text: z.string().describe("The reply text, or empty when needs_owner_input is set") }),
  alert: z.boolean(),
  needs_owner_input: z.string().nullable(),
  sources_used: z.array(z.string()),
});
export type ReputationReplyOutput = z.infer<typeof ReputationReply>;

export type ReviewInput = { id: string; author_name: string; rating: number | null; text: string | null };
export type ReplyProfile = {
  sign_off_name?: string | null;
  complaint_contact?: string | null;
  recovery_offers?: string[] | null;
  words_to_avoid?: string[] | null;
  emoji_allowed?: { review_replies?: number } | null;
  phone?: string | null;
};

const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const EMOJI = /\p{Extended_Pictographic}/gu;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|co\.uk|net|org|io|uk)\b/i;
// house-rules 3: never say a dish is allergen-free, safe for allergies or "suitable for" a condition.
const FOOD_SAFETY = /\ballergen[-\s]?free\b|\bsafe for (?:people with )?allerg|\bsuitable for (?:coeliacs?|celiacs?|allerg|diabetic|nut)/i;
// house-rules 5 / reputation.md: never offer anything in exchange for a review or for changing one.
const REVIEW_INCENTIVE = /\b(?:review|rating|stars?)\b[^.!?]{0,60}\b(?:free|on us|discount|% off|voucher|reward)\b|\b(?:free|on us|discount|voucher)\b[^.!?]{0,60}\b(?:update|change|remove|delete|edit)\b[^.!?]{0,30}\breview\b/i;
const MONEY_BACK = /\brefund|\bmoney back\b|\bcompensat/i;
// "Feel free to get in touch" isn't a gesture.
const GESTURE = /(?<!feel\s)\bfree\b(?!\s+to\b)|\bon us\b|\bon the house\b|\bdiscount\b|\bvoucher\b/i;

export const emojiCount = (text: string) => (text.match(EMOJI) ?? []).length;
const has = (refs: string[], ref: string) => refs.includes(ref);

export function reputationProblems(out: ReputationReplyOutput, input: { review: ReviewInput; profile: ReplyProfile }): Problems {
  const problems = draftProblems(out);
  const { review, profile } = input;
  const text = out.content.text.trim();
  const refs = out.sources_used;

  if (out.review_id !== review.id) problems.push(`review_id must be ${review.id}`);
  if (out.rating !== review.rating) problems.push(`rating must be ${review.rating}`);
  const lowStars = review.rating !== null && review.rating <= 3;
  if (out.alert !== lowStars) problems.push(`alert must be ${lowStars} for a ${review.rating ?? "no"}-star review`);
  if (!has(refs, `review:${review.id}`)) problems.push(`sources_used must include review:${review.id}`);
  if (!text) return problems;

  // Writing rules (house rules section 8) and forbidden content.
  if (EM_DASH.test(text)) problems.push("the reply has an em-dash");
  const maxEmoji = profile.emoji_allowed?.review_replies ?? 0;
  if (emojiCount(text) > maxEmoji) problems.push(`the reply has ${emojiCount(text)} emojis; the profile allows ${maxEmoji} in review replies`);
  if (/(^|\s)#[A-Za-z]/.test(text)) problems.push("no hashtags in review replies");
  // (Email addresses are fine: the complaint contact is often one.)
  if (LINK.test(text.replace(/\S+@\S+\.\w+/g, ""))) problems.push("no links or web addresses in a reply");
  if (FOOD_SAFETY.test(text)) problems.push("never say a dish is allergen-free, safe for allergies or suitable for a condition");
  if (REVIEW_INCENTIVE.test(text)) problems.push("never offer anything in exchange for a review or for changing one");
  if (MONEY_BACK.test(text)) problems.push("never offer refunds, money or compensation");
  for (const w of profile.words_to_avoid ?? []) if (w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) problems.push(`"${w}" is in the profile's words to avoid`);

  // reputation.md: stars only, no text = one short line (of thanks, or inviting them to get in touch).
  if (!review.text?.trim()) {
    const body = profile.sign_off_name ? text.replace(profile.sign_off_name, "") : text;
    const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => /[a-z]/i.test(s)).length;
    if (sentences > 2) problems.push(`the review has no text, so the reply should be one short line (it has ${sentences} sentences)`);
  }

  // Every claim traces to a source.
  if (profile.sign_off_name) {
    if (!text.includes(profile.sign_off_name)) problems.push(`sign off with the profile's sign-off name ("${profile.sign_off_name}")`);
    else if (!has(refs, "profile:sign_off_name")) problems.push("sources_used must include profile:sign_off_name");
  }
  const contact = profile.complaint_contact?.trim();
  if (contact && text.includes(contact) && !has(refs, "profile:complaint_contact")) problems.push("sources_used must include profile:complaint_contact");
  const phone = profile.phone?.trim();
  if (phone && phone !== contact && text.includes(phone) && !has(refs, "profile:phone")) problems.push("sources_used must include profile:phone");
  if (GESTURE.test(text)) {
    if (!(profile.recovery_offers ?? []).length) problems.push("the reply offers something, but the profile has no approved recovery offers");
    else if (!has(refs, "profile:recovery_offers")) problems.push("a recovery gesture must come from profile:recovery_offers (and be listed in sources_used)");
  }
  if (/\bhalal\b/i.test(text) && !has(refs, "profile:halal_statement")) problems.push("anything about halal must come from profile:halal_statement");
  if (/\ballerg/i.test(text) && !has(refs, "profile:allergen_statement")) problems.push("anything about allergens must come from profile:allergen_statement");
  return problems;
}
