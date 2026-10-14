// The Visibility agent's output and the plain-code rules every draft must pass
// (on top of the shared draft rules). Used to check each answer (one retry if it
// fails) and by the agent tests. Zod and pure code only, so it's unit-tested.
import { z } from "zod";
import { priceProblems } from "@/lib/prices";
import { draftProblems, type Problems } from "./schema";

export const VISIBILITY_TYPES = ["google_post", "google_photo", "hours_update", "menu_update", "content_brief", "one_off"] as const;
export const CTAS = ["Book", "Order online", "Learn more", "Call"] as const;
// Why a photo can't be used. Code turns the reason into a fixed tip for the staff member.
export const PHOTO_REASONS = ["ok", "too_dark", "blurry", "not_food_or_venue", "person_or_child", "kitchen_mess", "not_on_menu", "other"] as const;
export type PhotoReason = (typeof PHOTO_REASONS)[number];

// What Visibility returns (visibility.md "Output"), plus two fields code asks for:
// photo_check (is a staff or owner photo usable, and why not) and shoots (the
// weekly content brief's three shoot briefs).
export const VisibilityDraft = z.object({
  type: z.enum(VISIBILITY_TYPES),
  channel: z.enum(["google", "owner"]),
  content: z.object({
    text: z.string().describe("The post, caption, update or brief text"),
    cta: z.enum(CTAS).nullable(),
    hashtags: z.array(z.string()),
  }),
  photo_id: z.string().nullable(),
  change: z.object({ field: z.string(), from: z.string(), to: z.string() }).nullable(),
  publish_at: z.string().nullable(),
  photo_check: z
    .object({ usable: z.boolean(), reason_code: z.enum(PHOTO_REASONS), reason: z.string().describe("One line; for an unusable photo, why") })
    .nullable(),
  shoots: z.array(
    z.object({
      what: z.string(),
      where: z.string(),
      how: z.string(),
      who: z.string(),
      day: z.string(),
      platform: z.enum(["Instagram", "TikTok", "Google"]),
      caption: z.string(),
      hashtags: z.array(z.string()),
    }),
  ),
  needs_owner_input: z.string().nullable(),
  sources_used: z.array(z.string()),
});
export type VisibilityOutput = z.infer<typeof VisibilityDraft>;

export type VisibilityTask = "google_post" | "photo" | "profile_changed" | "content_brief" | "one_off";
export type VisibilityProfile = {
  halal_statement?: string | null;
  words_to_avoid?: string[] | null;
  emoji_allowed?: { posts?: number } | null;
  menu?: unknown;
};
export type ProfileChangedEvent = { field: "hours" | "special_hours" | "menu"; from: string; to: string };

const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const EMOJI = /\p{Extended_Pictographic}/gu;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|co\.uk|net|org|io|uk)\b/i;
// A phone number: 9 or more digits, allowing spaces, dashes, brackets and a leading +.
const PHONE = /(?:\+?\d[\d\s()-]{7,}\d)/;
// For a halal restaurant: no alcohol or pork, in posts or trend ideas.
const NOT_HALAL = /\b(?:beer|wine|lager|cider|cocktails?|gin|rum|vodka|whisk(?:e)?y|prosecco|champagne|tequila|sangria|mojito|spritz|espresso martini|negroni|margarita|pork|bacon|ham|prosciutto|chorizo|pepperoni|salami|lard|gelatine)\b/i;

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const emojiCount = (text: string) => (text.match(EMOJI) ?? []).length;

export function textRules(text: string, profile: VisibilityProfile, where: string, maxEmoji: number): Problems {
  const problems: Problems = [];
  if (EM_DASH.test(text)) problems.push(`${where} has an em-dash`);
  if (LINK.test(text.replace(/\S+@\S+\.\w+/g, ""))) problems.push(`no links or web addresses in ${where}`);
  if (emojiCount(text) > maxEmoji) problems.push(`${where} has ${emojiCount(text)} emojis; the profile allows ${maxEmoji}`);
  for (const w of profile.words_to_avoid ?? []) if (w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) problems.push(`"${w}" is in the profile's words to avoid (${where})`);
  if (profile.halal_statement && NOT_HALAL.test(text)) problems.push(`${where} mentions something that breaks the profile's dietary rules ("${text.match(NOT_HALAL)![0]}")`);
  return problems;
}

export function visibilityProblems(out: VisibilityOutput, input: { task: VisibilityTask; profile: VisibilityProfile; event?: ProfileChangedEvent | null }): Problems {
  const { task, profile } = input;
  const text = out.content.text.trim();
  const maxEmoji = profile.emoji_allowed?.posts ?? 0;

  // A photo that can't be used: no draft, just the reason (code sends a fixed tip).
  if (task === "photo" && out.photo_check && !out.photo_check.usable) {
    const problems: Problems = [];
    if (out.photo_check.reason_code === "ok") problems.push("an unusable photo needs a reason_code other than ok");
    if (!out.photo_check.reason.trim()) problems.push("say in one line why the photo can't be used");
    if (text) problems.push("an unusable photo gets no caption");
    return problems;
  }

  const problems = draftProblems(out);
  if (out.needs_owner_input) return problems;

  if (task === "photo") {
    if (!out.photo_check) problems.push("photo_check is required for a photo");
    else if (out.photo_check.reason_code === "person_or_child") problems.push("a photo showing a customer's face or a child is never usable");
    if (!["google_post", "google_photo"].includes(out.type)) problems.push("a photo becomes a google_post or google_photo");
  }

  if (task === "google_post" || (task === "photo" && out.type === "google_post")) {
    if (out.type !== "google_post" || out.channel !== "google") problems.push("a Google post has type google_post and channel google");
    const words = wordCount(text);
    if (words < 40 || words > 100) problems.push(`a Google post is 40 to 100 words (this one is ${words})`);
    if (!out.content.cta) problems.push("a Google post has one call to action (Book, Order online, Learn more or Call)");
  }
  if (out.channel === "google") {
    if (PHONE.test(text)) problems.push("no phone numbers in Google text (Google rejects them): use the Call button");
    if (out.content.hashtags.length || /(^|\s)#[A-Za-z]/.test(text)) problems.push("no hashtags on Google");
    problems.push(...textRules(text, profile, "the post", maxEmoji));
    problems.push(...priceProblems(text, { menu: profile.menu }, "the post"));
  }

  if (task === "profile_changed") {
    const want = input.event?.field === "menu" ? "menu_update" : "hours_update";
    if (out.type !== want) problems.push(`a ${input.event?.field ?? "profile"} change is drafted as ${want}`);
    if (!out.change) problems.push("a profile change shows the field, the current value and the new one (change)");
    else if (input.event && out.change.field !== input.event.field) problems.push(`change.field must be ${input.event.field}`);
    else if (!out.change.from.trim() || !out.change.to.trim()) problems.push("show both the current value (from) and the new one (to)");
  }

  // One-off writing (job 6): the owner sends it themselves (a job ad, a supplier email, a notice).
  if (task === "one_off") {
    if (out.type !== "one_off" || out.channel !== "owner") problems.push("one-off writing has type one_off and channel owner");
    if (out.content.hashtags.length) problems.push("no hashtags in one-off writing");
    problems.push(...textRules(text, profile, "the writing", maxEmoji));
  }

  if (task === "content_brief") {
    if (out.type !== "content_brief" || out.channel !== "owner") problems.push("the content brief has type content_brief and channel owner");
    if (out.shoots.length !== 3) problems.push(`the brief has exactly 3 shoot briefs (this one has ${out.shoots.length})`);
    out.shoots.forEach((s, i) => {
      if (!s.caption.trim()) problems.push(`shoot ${i + 1} has no caption`);
      if (s.hashtags.length > 5) problems.push(`shoot ${i + 1} has ${s.hashtags.length} hashtags (5 at most)`);
      problems.push(...textRules(`${s.what} ${s.how} ${s.caption}`, profile, `shoot ${i + 1}`, Math.max(maxEmoji, 2)));
    });
    problems.push(...textRules(text, profile, "the brief", Math.max(maxEmoji, 2)));
  }
  return problems;
}

// The fixed tip a staff member gets for an unusable photo (plain code, never AI wording).
export const PHOTO_TIPS: Record<Exclude<PhotoReason, "ok">, string> = {
  too_dark: "📸 Thanks! That one's too dark to use. Try it by a window or under the pass lights.",
  blurry: "📸 Thanks! That one's a bit blurry. Hold the phone steady (or rest it on something) and tap the dish to focus.",
  not_food_or_venue: "📸 Thanks! For Google we need the food or the restaurant itself in the shot. Try a close-up of a dish.",
  person_or_child: "📸 Thanks! We can't post photos where a customer's face or a child can be seen. Try one with just the food.",
  kitchen_mess: "📸 Thanks! The background's a bit busy for Google. Try a clean spot on the pass or a plain table.",
  not_on_menu: "📸 Thanks! That dish isn't on our menu yet, so we'll hold off posting it. The owner can add it first.",
  other: "📸 Thanks! That one won't work for Google. Try a bright, close-up shot of a dish.",
};

// ---------- Profile changes, in words ----------

type Dish = { name: string; price: number };
const dishes = (menu: unknown): Dish[] =>
  (Array.isArray(menu) ? menu : []).flatMap((c: { items?: Dish[] }) => (Array.isArray(c?.items) ? c.items : [])).filter((d) => d && typeof d.name === "string");
const money = (n: number) => `£${Number(n).toFixed(2).replace(/\.00$/, "")}`;
const entries = (v: unknown) => Object.entries(v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const dayHours = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "hours" in v ? String((v as { hours: unknown }).hours) : "not set");
const dayLabel = (date: string, v: unknown) => (v && typeof v === "object" && "label" in v && (v as { label: unknown }).label ? `${(v as { label: string }).label} (${date})` : date);

// What changed on a profile field Google shows (opening hours, special hours,
// the menu), as from/to text for Visibility's update and the owner's Approve.
// Null if nothing Google shows changed (e.g. only allergens were confirmed).
export function describeProfileChange(field: ProfileChangedEvent["field"], before: unknown, after: unknown): ProfileChangedEvent | null {
  const from: string[] = [];
  const to: string[] = [];
  if (field === "hours" || field === "special_hours") {
    const a = new Map(entries(before));
    const b = new Map(entries(after));
    for (const key of [...new Set([...a.keys(), ...b.keys()])]) {
      const x = a.has(key) ? dayHours(a.get(key)) : null;
      const y = b.has(key) ? dayHours(b.get(key)) : null;
      if (x === y) continue;
      const label = field === "special_hours" ? dayLabel(key, b.get(key) ?? a.get(key)) : key;
      from.push(`${label}: ${x ?? (field === "special_hours" ? "usual hours" : "not set")}`);
      to.push(`${label}: ${y ?? (field === "special_hours" ? "usual hours" : "closed")}`);
    }
  } else {
    const a = new Map(dishes(before).map((d) => [d.name.toLowerCase(), d]));
    const b = new Map(dishes(after).map((d) => [d.name.toLowerCase(), d]));
    for (const [k, d] of b) {
      const old = a.get(k);
      if (!old) {
        from.push(`${d.name}: not on the menu`);
        to.push(`${d.name}: added, ${money(d.price)}`);
      } else if (Number(old.price) !== Number(d.price)) {
        from.push(`${d.name}: ${money(old.price)}`);
        to.push(`${d.name}: ${money(d.price)}`);
      }
    }
    for (const [k, d] of a) {
      if (b.has(k)) continue;
      from.push(`${d.name}: ${money(d.price)}`);
      to.push(`${d.name}: removed`);
    }
  }
  return from.length ? { field, from: from.join("; "), to: to.join("; ") } : null;
}
