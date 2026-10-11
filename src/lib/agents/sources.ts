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
