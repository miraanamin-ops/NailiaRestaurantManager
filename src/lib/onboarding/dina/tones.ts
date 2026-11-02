import { z } from "zod";

// The tone step (step 3): the four tones and the default reviews from
// agents/tones.config.json, which real reviews to use instead (the owner's rules
// of 28 Oct), and the choice cards the owner picks from. Plain code, unit-tested
// (tests/dina-steps.test.ts); reading the file is in tone-step.ts.

export type Voice = "praise" | "complaint";
export const VOICES: Voice[] = ["praise", "complaint"];

const Reply = z.string().min(10).max(600);
const Example = z.object({ author: z.string().min(1), rating: z.number().int().min(1).max(5), text: z.string().min(20), replies: z.record(z.string(), Reply) });
const Schema = z
  .object({
    default_tone: z.string(),
    tones: z.array(z.object({ id: z.string().regex(/^[a-z_]+$/), name: z.string().min(1).max(40), short: z.string().min(1).max(20), describe: z.string().min(10) })).length(4),
    defaults: z.object({ praise: Example, complaint: Example }),
  })
  .passthrough()
  .superRefine((c, ctx) => {
    const ids = c.tones.map((t) => t.id);
    if (!ids.includes(c.default_tone)) ctx.addIssue({ code: "custom", message: `default_tone must be one of ${ids.join(", ")}` });
    for (const v of VOICES)
      for (const id of ids) if (!c.defaults[v].replies[id]) ctx.addIssue({ code: "custom", message: `defaults.${v}.replies is missing ${id}` });
    for (const t of [...c.tones.flatMap((t) => [t.name, t.short, t.describe]), ...VOICES.flatMap((v) => [c.defaults[v].text, ...Object.values(c.defaults[v].replies)])])
      if (t.includes("—")) ctx.addIssue({ code: "custom", message: `no em-dashes: "${t.slice(0, 40)}"` });
  });

export type ToneConfig = z.infer<typeof Schema>;
export type Tone = ToneConfig["tones"][number];

export function parseTones(raw: unknown): ToneConfig {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) throw new Error(`agents/tones.config.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "file"} ${i.message}`).join("; ")}`);
  return parsed.data;
}

// ---------- Which reviews ----------

export type ReviewForTone = { id: string; author_name: string; rating: number; text: string | null; review_date: string; replied: boolean; reply_text: string | null };

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const SPECIFIC_PRAISE = /\b(staff|team|waiter|waitress|server|chef|manager|host|service|served|(?:[A-Z][a-z]+ (?:was|were|made|looked)))\b/;
const SPECIFIC_COMPLAINT = /\b(wait|waited|waiting|minutes|hour|cold|slow|late|rude|wrong|dirty|overcooked|undercooked|burnt|raw|price|expensive|portion|ignored|forgot|missing|booking|noisy)\b/i;
// Abuse is left out: those reviews aren't the place to set a tone.
const ABUSIVE = /\b(f+u+c+k\w*|shit\w*|crap|bastard\w*|idiot\w*|scum|disgusting people|wankers?)\b/i;

// The owner's rules: real text of about 15 words or more; the last 12 months
// first; praise is 5 stars, ideally naming a dish or a person; a complaint is 2
// or 3 stars with something specific, never an abusive 1-star; unanswered first.
export function pickToneReviews(reviews: ReviewForTone[], now: Date, dishes: string[] = []): Record<Voice, ReviewForTone | null> {
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const usable = reviews.filter((r) => r.text && wordCount(r.text) >= 15 && !ABUSIVE.test(r.text));
  const dishWords = dishes.map((d) => d.toLowerCase()).filter((d) => d.length >= 4);
  const score = (r: ReviewForTone, specific: boolean) =>
    (r.review_date >= yearAgo ? 4 : 0) + (specific ? 2 : 0) + (r.replied ? 0 : 1) + Math.min(wordCount(r.text!), 80) / 1000;
  const best = (list: ReviewForTone[], specific: (r: ReviewForTone) => boolean) =>
    [...list].sort((a, b) => score(b, specific(b)) - score(a, specific(a)) || b.review_date.localeCompare(a.review_date))[0] ?? null;
  const mentionsDish = (t: string) => dishWords.some((d) => t.toLowerCase().includes(d));
  return {
    praise: best(usable.filter((r) => r.rating === 5), (r) => SPECIFIC_PRAISE.test(r.text!) || mentionsDish(r.text!)),
    complaint: best(usable.filter((r) => r.rating === 2 || r.rating === 3), (r) => SPECIFIC_COMPLAINT.test(r.text!)),
  };
}

// How the owner already answers reviews (their own replies), as evidence of their voice.
export function ownerReplies(reviews: ReviewForTone[], max = 3) {
  return reviews.filter((r) => r.replied && r.reply_text && wordCount(r.reply_text) >= 5).slice(0, max).map((r) => ({ rating: r.rating, review: r.text ?? "", reply: r.reply_text! }));
}

// ---------- What the owner picks from ----------

// One review and a reply in each tone: the owner's real review (replies written
// for it) or the default one (replies from the config file).
export type ToneOptions = { review: { id: string | null; author: string; rating: number; text: string }; real: boolean; replies: Record<string, string> };

export function defaultOptions(config: ToneConfig, voice: Voice): ToneOptions {
  const d = config.defaults[voice];
  return { review: { id: null, author: d.author, rating: d.rating, text: d.text }, real: false, replies: { ...d.replies } };
}

export const OWN = "own";

// The cards: one per tone with its reply, then "Write my own".
export function toneCards(config: ToneConfig, options: ToneOptions) {
  return [
    ...config.tones.map((t) => ({ id: t.id, title: t.name, short: t.short, body: options.replies[t.id] ?? "" })),
    { id: OWN, title: "Write my own", short: "Write my own", body: "Tell me how you'd reply in your own words." },
  ];
}

// The example saved for every future reply (restaurants.profile_examples).
export function exampleFrom(config: ToneConfig, options: ToneOptions, pick: { tone?: string; own?: string }) {
  const own = pick.own?.trim();
  if (own) return { review: options.review.text, reply: own.slice(0, 1200), style: null, own: true };
  const tone = config.tones.find((t) => t.id === pick.tone);
  const reply = tone ? options.replies[tone.id] : undefined;
  return tone && reply ? { review: options.review.text, reply, style: tone.name, own: false } : null;
}
