// The Growth agent's output and the plain-code rules every draft must pass (on
// top of the shared draft rules): email only, a real segment with its real size,
// copy that fits the template, an offer of an approved kind, within the cap
// (worked out from its fields), for dishes on the menu, with clear dates and
// conditions, no fake urgency, no targeting by religion, and an expected outcome
// that only quotes past results. Zod and pure code only (plus the pure offer and
// wording rules), so it's unit-tested (tests/agents/growth.test.ts).
import { z } from "zod";
import { findDish, OFFER_TYPES, offerCap } from "@/lib/offers";
import { quotedNumbers } from "./insights-rules";
import { priceProblems } from "@/lib/prices";
import { draftProblems, type Problems } from "./schema";
import { textRules, type VisibilityProfile } from "./visibility-rules";

export const GROWTH_TASKS = ["owner_request", "weekly_plan", "calendar", "birthdays", "special_ideas", "revision"] as const;
export type GrowthTask = (typeof GROWTH_TASKS)[number];
export const SEGMENT_NAMES = ["everyone", "birthdays_7d", "unredeemed_signups"] as const;
export const NO_BASELINE = "First campaign of this kind, no baseline yet.";

export const GrowthOffer = z.object({
  type: z.enum(OFFER_TYPES),
  description: z.string(),
  items: z.array(z.string()).describe("Menu dishes the offer involves, named as on the menu"),
  applies_to: z.string().nullable().describe("The menu dish (or main) a free item or £ off comes with; null for a % off everything"),
  discount_percent: z.number().nullable(),
  discount_value_gbp: z.number().nullable(),
  valid_from: z.string().describe("YYYY-MM-DD or YYYY-MM-DDTHH:MM"),
  valid_to: z.string().describe("YYYY-MM-DD or YYYY-MM-DDTHH:MM"),
  conditions: z.string(),
});

// growth.md "Output", plus fields code asks for: name (the owner's label for the
// campaign) and idea (a special idea's dish, the menu dishes its ingredients come
// from, ingredients, steps and why now). A special idea goes to the owner only.
export const GrowthDraft = z.object({
  type: z.enum(["campaign", "birthday_batch", "special_idea"]),
  channel: z.enum(["email", "whatsapp", "owner"]),
  name: z.string(),
  segment: z.enum(SEGMENT_NAMES).nullable(),
  audience_size: z.number().nullable(),
  send_at: z.string().nullable().describe("YYYY-MM-DDTHH:MM, London time"),
  template: z.enum(["offer", "birthday"]).nullable(),
  photo_id: z.string().nullable(),
  content: z.object({ subject: z.string(), headline: z.string(), body: z.string(), cta: z.string() }),
  offer: GrowthOffer.nullable(),
  idea: z
    .object({ name: z.string(), uses_dishes: z.array(z.string()), ingredients: z.array(z.string()), steps: z.array(z.string()), why_now: z.string() })
    .nullable(),
  expected_outcome: z.string(),
  needs_owner_input: z.string().nullable(),
  sources_used: z.array(z.string()),
});
export type GrowthDraftOutput = z.infer<typeof GrowthDraft>;

// One call can give several drafts (the weekly plan: up to 2; special ideas: up to 2;
// an owner request: a second option only if it's genuinely different).
export const GrowthOutput = z.object({ drafts: z.array(GrowthDraft) });
export type GrowthOutputType = z.infer<typeof GrowthOutput>;

export type GrowthContext = {
  task: GrowthTask;
  today: string; // YYYY-MM-DD
  profile: VisibilityProfile & {
    menu?: unknown;
    discount_cap?: number | null;
    approved_offer_types?: string[] | null;
    birthday_offer?: string | null;
    signup_offer?: string | null;
    emoji_allowed?: { posts?: number; campaigns?: number } | null;
  };
  // How many customers each segment can email right now (code's count).
  segments: Record<string, number>;
  // Past campaigns and their results (history:<id>).
  history: { id: string; name: string; emailed: number; simulated: number; opened: number; clicked: number; redeemed: number }[];
  photoIds: string[];
  sendWindow: { start: string; end: string };
};

const FAKE_URGENCY = /\b(only \d+ (?:left|spaces?|tables?|places?)|last chance|hurry|selling fast|while stocks? lasts?|limited (?:spaces|tables|places)|don'?t miss out|ends (?:tonight|soon)|act now|before it'?s gone|almost gone)\b/i;
const TARGETING = /\b(?:muslim|hindu|sikh|christian|jewish|buddhist|asian|desi|arab|bengali|pakistani|indian|somali|turkish)\s+(?:customers|friends|community|communities|families|brothers|sisters|guests|people)\b|\b(?:to|for) (?:all )?(?:our )?(?:muslim|hindu|sikh|christian|jewish)s?\b/i;
const PRICE = /£\s?\d|\b\d+(?:\.\d{2})?\s?(?:pounds|quid)\b|\bprice\b/i;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const datePart = (s: string) => s.slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(datePart(s)) && !Number.isNaN(Date.parse(`${datePart(s)}T12:00:00Z`));
const days = (a: string, b: string) => Math.round((Date.parse(`${datePart(b)}T12:00:00Z`) - Date.parse(`${datePart(a)}T12:00:00Z`)) / 86_400_000);
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

const TYPE_FOR: Record<GrowthTask, GrowthDraftOutput["type"][]> = {
  owner_request: ["campaign"],
  weekly_plan: ["campaign"],
  calendar: ["campaign"],
  birthdays: ["birthday_batch"],
  special_ideas: ["special_idea"],
  revision: ["campaign", "birthday_batch", "special_idea"],
};
const COUNT: Record<GrowthTask, [number, number]> = {
  owner_request: [1, 2],
  weekly_plan: [0, 2],
  calendar: [1, 1],
  birthdays: [1, 1],
  special_ideas: [1, 2],
  revision: [1, 1],
};

export function growthOutputProblems(out: GrowthOutputType, ctx: GrowthContext): Problems {
  const [min, max] = COUNT[ctx.task];
  const problems: Problems = [];
  if (out.drafts.length < min || out.drafts.length > max) problems.push(`this task gives ${min === max ? `exactly ${min}` : `${min} to ${max}`} draft${max === 1 ? "" : "s"} (this has ${out.drafts.length})`);
  if (out.drafts.length > 1 && out.drafts.some((d) => d.needs_owner_input)) problems.push("a question for the owner comes on its own: one draft with needs_owner_input, nothing else");
  out.drafts.forEach((d, i) => problems.push(...growthProblems(d, ctx).map((p) => (out.drafts.length > 1 ? `draft ${i + 1}: ${p}` : p))));
  return problems;
}

export function growthProblems(d: GrowthDraftOutput, ctx: GrowthContext): Problems {
  const problems = draftProblems(d);
  if (!TYPE_FOR[ctx.task].includes(d.type)) problems.push(`this task's drafts have type ${TYPE_FOR[ctx.task].join(" or ")}`);
  if (d.needs_owner_input) return problems;
  const p = ctx.profile;
  const text = [d.content.subject, d.content.headline, d.content.body, d.content.cta].join("\n");

  if (d.type === "special_idea") {
    if (d.channel !== "owner") problems.push("a special idea goes to the owner only: channel owner");
    if (!d.idea) return [...problems, "a special idea needs idea (name, uses_dishes, ingredients, steps, why_now)"];
    for (const dish of d.idea.uses_dishes) if (!findDish(p.menu, dish)) problems.push(`"${dish}" isn't on the menu: a special uses only what the kitchen already has`);
    if (!d.idea.uses_dishes.length) problems.push("name the menu dishes the ingredients come from (uses_dishes)");
    if (d.idea.steps.length < 3 || d.idea.steps.length > 5) problems.push(`3 to 5 steps (this has ${d.idea.steps.length})`);
    const all = [text, d.idea.name, d.idea.why_now, ...d.idea.steps, ...d.idea.ingredients].join("\n");
    if (PRICE.test(all)) problems.push("never suggest a price for a special: the owner sets it");
    if (d.offer) problems.push("a special idea has no offer");
    problems.push(...textRules(all, p, "the idea", p.emoji_allowed?.campaigns ?? 0));
    return problems;
  }

  // Campaigns and the birthday batch.
  if (d.channel !== "email") problems.push("email only for now (WhatsApp is blocked until Meta verification): channel email");
  if (!d.name.trim()) problems.push("give the campaign a short name the owner will recognise");
  if (!d.segment) problems.push("pick an existing segment");
  else {
    const size = ctx.segments[d.segment] ?? 0;
    if (d.audience_size !== size) problems.push(`audience_size for ${d.segment} is ${size} (from the customer list), not ${d.audience_size}`);
    if (size === 0) problems.push(`nobody in ${d.segment} can be emailed right now: set needs_owner_input instead`);
  }
  if (d.type === "birthday_batch") {
    if (d.segment !== "birthdays_7d") problems.push("the birthday batch goes to birthdays_7d");
    if (d.template !== "birthday") problems.push("the birthday batch uses the birthday template");
    if (!p.birthday_offer?.trim()) problems.push("the profile has no birthday offer: set needs_owner_input and ask the owner for one");
    else if (d.offer && !d.offer.description.toLowerCase().includes(p.birthday_offer.trim().toLowerCase().replace(/[.!]$/, "").slice(0, 25))) {
      problems.push(`use the profile's birthday offer ("${p.birthday_offer}")`);
    }
  } else if (d.template !== "offer") problems.push("a campaign uses the offer template");

  // Copy that fits the template's slots.
  if (d.content.subject.length >= 50) problems.push(`subject under 50 characters (this is ${d.content.subject.length})`);
  if (words(d.content.headline) > 8) problems.push(`headline 8 words at most (this is ${words(d.content.headline)})`);
  if (words(d.content.body) > 60) problems.push(`body 60 words at most (this is ${words(d.content.body)})`);
  if (!d.content.cta.trim()) problems.push("a call to action (cta)");
  problems.push(...textRules(text, p, "the email", p.emoji_allowed?.campaigns ?? 0));
  // Every £ amount is a menu price, the offer's own value, or in the owner's own offers.
  const offerText = d.offer ? `${d.offer.description} ${d.offer.conditions}` : "";
  problems.push(...priceProblems(`${text}
${offerText}`, { menu: p.menu, values: [d.offer?.discount_value_gbp], ownerTexts: [p.birthday_offer, p.signup_offer] }, "the email"));
  if (FAKE_URGENCY.test(text)) problems.push(`no fake urgency ("${text.match(FAKE_URGENCY)![0]}")`);
  if (TARGETING.test(text) || TARGETING.test(d.name)) problems.push(`never word or target by religion or background ("${(text.match(TARGETING) ?? d.name.match(TARGETING))![0]}"): word it for everyone`);

  // The offer.
  if (!d.offer) problems.push("a campaign needs an offer (structured fields)");
  else {
    const o = d.offer;
    const approved = p.approved_offer_types ?? [];
    if (!approved.length) problems.push("the owner hasn't said which kinds of offer they're happy to run: set needs_owner_input");
    else if (!approved.includes(o.type)) problems.push(`${o.type} isn't one of the owner's approved kinds of offer (${approved.join(", ")}): pick one of those, or set needs_owner_input`);
    for (const item of o.items) if (!findDish(p.menu, item)) problems.push(`"${item}" isn't on the menu: offers must be things the kitchen can make from the current menu`);
    // The owner's own birthday offer or sign-up reward isn't capped (their decision in settings).
    const cap = offerCap(o, p.menu, Number(p.discount_cap ?? 0), { birthday_offer: p.birthday_offer, signup_reward: p.signup_offer });
    if (!cap.ok) problems.push(cap.reason === "over_cap" ? `${cap.detail}: set needs_owner_input instead of drafting it` : cap.detail);
    if (!isDate(o.valid_from) || !isDate(o.valid_to)) problems.push("offer dates as YYYY-MM-DD (or YYYY-MM-DDTHH:MM)");
    else {
      if (datePart(o.valid_from) < ctx.today) problems.push("the offer can't start in the past");
      if (datePart(o.valid_to) < datePart(o.valid_from)) problems.push("the offer ends before it starts");
      if (days(o.valid_from, o.valid_to) > 31) problems.push("an offer runs 31 days at most");
    }
    if (!o.conditions.trim()) problems.push("every offer has clear conditions (e.g. dine-in only, one per table)");
    if (!o.description.trim()) problems.push("describe the offer");
  }

  // When it goes out: inside the send window, on or before the offer's first day.
  if (!d.send_at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.send_at)) problems.push("send_at as YYYY-MM-DDTHH:MM (London time)");
  else {
    if (datePart(d.send_at) < ctx.today) problems.push("send_at can't be in the past");
    const t = minutes(d.send_at.slice(11, 16));
    if (t < minutes(ctx.sendWindow.start) || t >= minutes(ctx.sendWindow.end)) problems.push(`send_at must be inside the sending hours (${ctx.sendWindow.start.slice(0, 5)} to ${ctx.sendWindow.end.slice(0, 5)})`);
    if (d.offer && isDate(d.offer.valid_from) && datePart(d.send_at) > datePart(d.offer.valid_from)) problems.push("send it on or before the offer's first day");
  }

  if (d.photo_id && !ctx.photoIds.includes(d.photo_id)) problems.push(`photo ${d.photo_id} isn't in the photo library`);

  // Expected outcome: only past results, quoted exactly; with none comparable, say so.
  const cited = d.sources_used.filter((s) => s.startsWith("history:")).map((s) => s.slice("history:".length));
  // Figures only: dates, times and small period words ("Tue 29 Sep", "over 4 days") aren't results.
  const numbers = quotedNumbers(d.expected_outcome.replace(/[a-z]+_w*dw*/gi, " ")).map((q) => q.value);
  if (d.expected_outcome.trim() === NO_BASELINE) {
    // Fine: no comparable campaign.
  } else if (!cited.length) problems.push(`expected_outcome quotes past results only: cite the campaign (history:<id>) or write "${NO_BASELINE}"`);
  else {
    const known = ctx.history.filter((h) => cited.includes(h.id));
    if (!known.length) problems.push(`history:${cited[0]} isn't a past campaign`);
    const allowed = new Set(known.flatMap((h) => [h.emailed, h.simulated, h.opened, h.clicked, h.redeemed, h.emailed + h.simulated]));
    for (const n of numbers) if (!allowed.has(n)) problems.push(`expected_outcome says ${n}, which isn't in the cited campaign's results`);
  }
  return problems;
}

// The campaign as the email template takes it (today's campaign fields), from Growth's draft.
export function campaignFieldsFrom(d: GrowthDraftOutput) {
  const o = d.offer!;
  return {
    name: d.name,
    subject: d.content.subject,
    body: [d.content.headline, d.content.body, d.content.cta].filter((s) => s.trim()).join("\n\n"),
    // The conditions once: not again if the description already says them.
    offer: o.conditions.trim() && !o.description.toLowerCase().includes(o.conditions.trim().toLowerCase().replace(/\.$/, "")) ? `${o.description.replace(/\.$/, "")}. ${o.conditions}` : o.description,
    valid_from: datePart(o.valid_from),
    valid_until: datePart(o.valid_to),
    segment: d.segment!,
  };
}

// What the owner reads (and the checker checks): the email, or the special idea.
export function growthText(d: GrowthDraftOutput) {
  if (d.needs_owner_input) return d.needs_owner_input;
  if (d.type === "special_idea" && d.idea) {
    return `${d.idea.name}\nUses: ${d.idea.uses_dishes.join(", ")} (${d.idea.ingredients.join(", ")})\n${d.idea.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nWhy now: ${d.idea.why_now}`;
  }
  return [d.content.subject, d.content.headline, d.content.body, d.content.cta, d.offer ? `Offer: ${d.offer.description}. ${d.offer.conditions}` : "", `Expected: ${d.expected_outcome}`].filter(Boolean).join("\n");
}
