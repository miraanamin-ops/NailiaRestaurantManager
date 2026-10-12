// Source references in a draft's sources_used: "kind:id", e.g. "review:abc123",
// "profile:sign_off_name", "history:cmp_0012". The checker resolves each one to
// the real data behind it (lib/agents/tools.ts). No imports, so it's unit-tested.

export const SOURCE_KINDS = [
  "review", // a Google review (its id)
  "profile", // a restaurant profile field
  "history", // a past campaign (its id) and its results
  "segment", // a customer segment and its size
  "request", // what the owner asked for (the draft's id)
  "calendar", // a date in the local calendar
  "metrics", // a figure from query_metrics
  "photo", // a photo in the library
  "post", // a past Google post (the date it went out, YYYY-MM-DD)
  "themes", // Reputation's weekly themes
  "decision", // an owner decision (approve, edit, skip)
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceRef = { kind: SourceKind; id: string };

export function parseSourceRef(ref: string): SourceRef | null {
  const m = ref.trim().match(/^([a-z_]+):(.+)$/);
  if (!m || !(SOURCE_KINDS as readonly string[]).includes(m[1])) return null;
  return { kind: m[1] as SourceKind, id: m[2].trim() };
}

// Drafts written before the agents (by the single assistant) have no sources_used.
// In shadow mode the checker still needs them, so code lists what each kind of
// draft is allowed to rely on: the profile fields, the review, the segment, and
// what the owner asked for.
export type LegacyDraft = { id: string; kind: string; review_id: string | null; request: string | null };

const PROFILE_BY_KIND: Record<string, string[]> = {
  review_reply: ["menu", "sign_off_name", "greeting", "complaint_contact", "recovery_offers", "phone", "halal_statement", "allergen_statement"],
  email_campaign: ["menu", "hours", "discount_cap", "signup_offer", "halal_statement", "allergen_statement", "address", "links"],
  google_post: ["menu", "hours", "address", "phone", "links", "halal_statement", "allergen_statement"],
  promotion: ["menu", "hours", "discount_cap", "halal_statement", "allergen_statement"],
  other: ["menu", "hours", "address", "phone", "halal_statement", "allergen_statement"],
};
const VOICE = ["name", "cuisine", "tone_notes", "emoji_allowed", "words_to_avoid"];

export function legacySources(draft: LegacyDraft, segment?: string | null): string[] {
  const refs = [...VOICE, ...(PROFILE_BY_KIND[draft.kind] ?? PROFILE_BY_KIND.other)].map((f) => `profile:${f}`);
  if (draft.review_id) refs.unshift(`review:${draft.review_id}`);
  if (segment) refs.push(`segment:${segment}`);
  if (draft.request) refs.push(`request:${draft.id}`);
  return [...new Set(refs)];
}
