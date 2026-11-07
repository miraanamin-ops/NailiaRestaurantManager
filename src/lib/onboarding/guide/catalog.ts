import type { QuestionOption } from "@/components/chat/types";
import { OFFER_TYPE_LABELS, OFFER_TYPES } from "@/lib/offers";
import { AUDIENCE_LABELS, AUDIENCES } from "@/lib/review/calendar-events";
import type { FlowStepKey } from "../flow";
import { DEFAULT_ALLERGEN_STATEMENT } from "../dina/details-content";
import type { Facts, Level } from "./questions";

// The questions that each save one setting (owner's plan, 7 Nov 2026), as data:
// what's asked, the choices, what a typed answer means, the field it saves to,
// and how it reads on the chapter's recap. guide/cards.ts draws them,
// guide/answer.ts saves them. Plain code (tests/guide-catalog.test.ts).
//
// A catalog question is only answered once the owner has answered it (its
// record): a value already there (from Google, the website or a default) is
// shown picked for them to confirm, never taken as their answer.

export type CatalogOption = QuestionOption & { value?: unknown; exclusive?: boolean };

export type CatalogQuestion = {
  id: string;
  step: FlowStepKey;
  level: Level;
  decision: boolean;
  label: string;
  field: string;
  kind: "one" | "many" | "text";
  text: (f: Facts) => string;
  options?: (f: Facts) => CatalogOption[];
  // The most that can be picked (many).
  max?: number;
  input?: { optionId: string; placeholder: string };
  // A typed answer as the value to save (null: couldn't be read; `error` is said).
  parse?: (text: string) => unknown;
  error?: string;
  // What's wrong with this value given what's saved (null: fine).
  check?: (value: unknown, f: Facts) => string | null;
  layout?: "buttons" | "cards";
  applies?: (f: Facts) => boolean;
  skip?: boolean;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const dayOptions = (none: string): CatalogOption[] => [...DAYS.map((d) => ({ id: d, label: DAY_LABELS[d], short: DAY_LABELS[d].slice(0, 3), value: d })), { id: "none", label: none, value: null, exclusive: true }];

export const GOALS: Record<string, string> = {
  quiet_nights: "Fill quiet nights",
  reviews: "More 5-star reviews",
  regulars: "Bring customers back more often",
  delivery: "Grow delivery and takeaway",
  list: "Grow my customer list",
  profit: "Make more profit per dish",
  costs: "Cut waste and costs",
};
export const CUSTOMER_TYPES: Record<string, string> = {
  families: "Families",
  students: "Students",
  office: "Office workers at lunch",
  local: "The local community",
  late_night: "Late-night crowd",
  couples: "Couples and date nights",
  groups: "Groups and parties",
  tourists: "Visitors and tourists",
};
export const LANGUAGES = ["English", "Urdu", "Bengali", "Punjabi", "Hindi", "Gujarati", "Arabic", "Turkish", "Polish", "Somali"];

const url = (text: string) => {
  const t = text.trim();
  const m = t.match(/(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?/i);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
};
// "@ember.grill", "instagram.com/ember.grill", "ember.grill" -> "ember.grill"
export const instagramHandle = (text: string) => {
  const t = text.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[a-z0-9._]{1,30}$/i.test(t) ? t : null;
};
// A UK phone number as typed, tidied: "020 7946 0000", "07700 900123", "+44 20 7946 0000".
export const ukPhone = (text: string) => {
  const digits = text.replace(/[^\d+]/g, "");
  const national = digits.startsWith("+44") ? `0${digits.slice(3)}` : digits.startsWith("0044") ? `0${digits.slice(4)}` : digits;
  if (!/^0\d{9,10}$/.test(national)) return null;
  if (national.startsWith("02")) return `${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
  if (national.startsWith("07")) return `${national.slice(0, 5)} ${national.slice(5)}`;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
};
// "£2,500", "2500", "about 3k" -> pounds
export const pounds = (text: string) => {
  const t = text.toLowerCase().replace(/,/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k)?/);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
  return n >= 100 && n <= 10_000_000 ? n : null;
};

const money = (n: number) => `£${n.toLocaleString("en-GB")}`;
const salesHint = (f: Facts) => (f.r._sales ?? null) as { weeklyAverage: number | null; quietDays: string[]; busyDays: string[] } | null;

export const CATALOG: CatalogQuestion[] = [
  // ---------- Chapter 1: you and your restaurant (the Hello step) ----------
  {
    id: "restaurant.phone",
    step: "hello",
    level: "essential",
    decision: false,
    label: "Phone number",
    field: "phone",
    kind: "text",
    text: (f) => (str(f.r.phone) ? `Is ${f.r.phone} the right number for customers to call?` : "What's the restaurant's phone number, for customers to call?"),
    options: (f) => (str(f.r.phone) ? [{ id: "keep", label: "Yes, that's right", value: str(f.r.phone) }] : []),
    input: { optionId: "own", placeholder: "e.g. 020 7946 0000" },
    parse: ukPhone,
    error: "That doesn't look like a UK phone number. Could you type it again, for example 020 7946 0000?",
  },
  {
    id: "restaurant.venue",
    step: "hello",
    level: "essential",
    decision: true,
    label: "How you serve",
    field: "venue_types",
    kind: "many",
    text: () => "How do customers eat your food? Pick all that apply.",
    options: () => [
      { id: "dine_in", label: "They eat in", short: "Eat in", value: "dine_in" },
      { id: "takeaway", label: "Takeaway and collection", short: "Takeaway", value: "takeaway" },
      { id: "delivery", label: "Delivery", value: "delivery" },
    ],
  },
  {
    id: "restaurant.website",
    step: "hello",
    level: "important",
    decision: false,
    label: "Website",
    field: "website",
    kind: "text",
    text: (f) => (str(f.r.website) ? `Is ${f.r.website} your website? I'll read your logo, colours and the way you write from it.` : "What's your website? I'll read your logo, colours and the way you write from it."),
    options: (f) => [
      ...(str(f.r.website) ? [{ id: "keep", label: "Yes, that's it", value: str(f.r.website) }] : []),
      { id: "none", label: "We don't have one", value: null },
    ],
    input: { optionId: "own", placeholder: "e.g. www.emberandspice.co.uk" },
    parse: url,
    error: "That doesn't look like a web address. Could you type it again, for example www.emberandspice.co.uk?",
  },
  {
    id: "restaurant.seats",
    step: "hello",
    level: "important",
    decision: false,
    label: "Seats",
    field: "seats",
    kind: "one",
    text: () => "Roughly how many seats do you have?",
    options: () => [
      { id: "under_30", label: "Under 30", value: "under_30" },
      { id: "30_60", label: "30 to 60", value: "30_60" },
      { id: "60_100", label: "60 to 100", value: "60_100" },
      { id: "over_100", label: "Over 100", value: "over_100" },
      { id: "none", label: "No seating", value: "none" },
    ],
    skip: true,
  },
  {
    id: "restaurant.spend",
    step: "hello",
    level: "important",
    decision: false,
    label: "Spend per head",
    field: "avg_spend",
    kind: "one",
    text: () => "Roughly what does a customer spend with you on a visit?",
    options: () => [
      { id: "under_15", label: "Under £15", value: "under_15" },
      { id: "15_25", label: "£15 to £25", value: "15_25" },
      { id: "25_40", label: "£25 to £40", value: "25_40" },
      { id: "over_40", label: "Over £40", value: "over_40" },
    ],
    skip: true,
  },
  {
    id: "restaurant.customers",
    step: "hello",
    level: "important",
    decision: false,
    label: "Your customers",
    field: "customer_types",
    kind: "many",
    text: () => "Who are your main customers? Pick all that fit, and I'll write for them.",
    options: () => Object.entries(CUSTOMER_TYPES).map(([id, label]) => ({ id, label, value: id })),
    skip: true,
  },
  {
    id: "restaurant.instagram",
    step: "hello",
    level: "important",
    decision: false,
    label: "Instagram",
    field: "instagram",
    kind: "text",
    text: () => "Are you on Instagram? Type your handle and I'll link it in your posts and emails.",
    options: () => [{ id: "none", label: "We're not on Instagram", short: "Not on Instagram", value: null }],
    input: { optionId: "own", placeholder: "e.g. @emberandspice" },
    parse: instagramHandle,
    error: "I couldn't read that as an Instagram handle. Try it like @emberandspice.",
  },
  {
    id: "restaurant.ordering",
    step: "hello",
    level: "important",
    decision: false,
    label: "Ordering link",
    field: "ordering_url",
    kind: "text",
    text: () => "Where can customers order online? Paste the link you'd like them sent to (your own site, Deliveroo, Uber Eats or Just Eat).",
    options: () => [{ id: "none", label: "We don't take orders online", short: "No online orders", value: null }],
    input: { optionId: "own", placeholder: "e.g. https://deliveroo.co.uk/menu/..." },
    parse: url,
    error: "That doesn't look like a web link. Could you paste the whole address?",
  },
  {
    id: "restaurant.booking",
    step: "hello",
    level: "important",
    decision: false,
    label: "Booking link",
    field: "booking_url",
    kind: "text",
    text: () => "And where can customers book a table online?",
    options: () => [{ id: "none", label: "We don't take online bookings", short: "No online bookings", value: null }],
    input: { optionId: "own", placeholder: "e.g. https://www.opentable.co.uk/..." },
    parse: url,
    error: "That doesn't look like a web link. Could you paste the whole address?",
    applies: (f) => arr(f.r.venue_types).includes("dine_in") || !arr(f.r.venue_types).length,
  },
  {
    id: "restaurant.goals",
    step: "hello",
    level: "essential",
    decision: true,
    label: "Your goals",
    field: "goals",
    kind: "many",
    max: 3,
    text: () => "Last one for this chapter: what matters most to you right now? Pick up to 3, and I'll work on those first.",
    options: () => Object.entries(GOALS).map(([id, label]) => ({ id, label, value: id })),
  },

  // ---------- Chapter 4: menu and margins ----------
  {
    id: "menu.allergen_statement",
    step: "menu",
    level: "essential",
    decision: true,
    label: "Allergen statement",
    field: "allergen_statement",
    kind: "text",
    text: () => "When a customer asks about allergens, which wording should I use?",
    options: (f) => [{ id: "standard", label: "Use this wording", body: str(f.r.allergen_statement) ?? DEFAULT_ALLERGEN_STATEMENT, value: str(f.r.allergen_statement) ?? DEFAULT_ALLERGEN_STATEMENT }],
    input: { optionId: "own", placeholder: "Your own wording" },
    parse: (t) => (t.trim().length >= 20 && t.trim().length <= 500 ? t.trim().replace(/\s+/g, " ") : null),
    error: "That's a bit short for an allergen statement. A sentence or two works best.",
    layout: "cards",
  },

  // ---------- Chapter 5: offers and limits (the rewards step) ----------
  {
    id: "offers.reward",
    step: "rewards",
    level: "essential",
    decision: true,
    label: "Sign-up reward",
    field: "signup_reward",
    kind: "text",
    text: () => "What should new customers get when they join your list?",
    options: (f) => [
      ...(str(f.r.signup_reward) && !["A free dessert", "A free soft drink", "10% off their next visit"].includes(String(f.r.signup_reward)) ? [{ id: "current", label: String(f.r.signup_reward), value: String(f.r.signup_reward) }] : []),
      { id: "dessert", label: "A free dessert", value: "A free dessert" },
      { id: "drink", label: "A free soft drink", value: "A free soft drink" },
      { id: "pct10", label: "10% off their next visit", short: "10% off next visit", value: "10% off their next visit" },
    ],
    input: { optionId: "own", placeholder: "e.g. A free starter with any main" },
    parse: (t) => (t.trim().length >= 3 && t.trim().length <= 100 ? t.trim() : null),
    error: "Could you describe the reward in a few words, for example a free starter with any main?",
  },
  {
    id: "offers.birthday",
    step: "rewards",
    level: "important",
    decision: true,
    label: "Birthday treat",
    field: "birthday_offer",
    kind: "text",
    text: () => "And in a customer's birthday week, what should I offer them?",
    options: (f) => [
      ...(str(f.r.signup_reward) ? [{ id: "same", label: `The same: ${f.r.signup_reward}`.slice(0, 60), value: str(f.r.signup_reward) }] : []),
      { id: "dessert", label: "A free dessert", value: "A free dessert" },
      { id: "none", label: "No birthday offer", value: null },
    ],
    input: { optionId: "own", placeholder: "e.g. A free birthday dessert with a candle" },
    parse: (t) => (t.trim().length >= 3 && t.trim().length <= 100 ? t.trim() : null),
    error: "Could you describe it in a few words?",
  },
  {
    id: "offers.types",
    step: "rewards",
    level: "essential",
    decision: true,
    label: "Kinds of offer",
    field: "approved_offer_types",
    kind: "many",
    text: () => "Which kinds of offer are you happy for me to suggest? Pick all you're happy with.",
    options: () => OFFER_TYPES.map((t) => ({ id: t, label: OFFER_TYPE_LABELS[t], value: t })),
  },
  {
    id: "offers.cap",
    step: "rewards",
    level: "essential",
    decision: true,
    label: "Biggest discount",
    field: "discount_cap_percent",
    kind: "one",
    text: () => "What's the most off any offer should ever be? I'll never go over it.",
    options: () => [10, 15, 20, 25].map((n) => ({ id: `cap${n}`, label: `${n}% off`, value: n })),
  },
  {
    id: "offers.margin",
    step: "rewards",
    level: "essential",
    decision: true,
    label: "Least a dish makes after a discount",
    field: "min_margin_pct",
    kind: "one",
    text: (f) =>
      `After a discount, what's the least a dish should still make, as a share of its price? I'd recommend 50%.${(f.r.menu as { items?: { cost?: number | null }[] }[] | undefined)?.some((c) => c.items?.some((i) => typeof i.cost === "number")) ? "" : " It's checked once your dish costs are in."}`,
    options: () => [
      { id: "m40", label: "40%", value: 40 },
      { id: "m50", label: "50% (recommended)", value: 50 },
      { id: "m60", label: "60%", value: 60 },
    ],
  },
  {
    id: "offers.no_discount",
    step: "rewards",
    level: "important",
    decision: true,
    label: "Days never to discount",
    field: "no_discount_days",
    kind: "many",
    text: () => "Are there days you're full anyway, so I should never put offers on them?",
    options: () => dayOptions("No, any day is fine"),
  },

  // ---------- Chapter 7: sales and team (after the sales history) ----------
  {
    id: "sales.target",
    step: "sales",
    level: "important",
    decision: true,
    label: "Weekly sales target",
    field: "weekly_sales_target",
    kind: "text",
    text: (f) => {
      const avg = salesHint(f)?.weeklyAverage;
      return avg ? `What would you like to take in a week, before VAT? Your recent weeks average about ${money(avg)}.` : "What would you like to take in a week, before VAT? A rough figure is fine.";
    },
    options: (f) => {
      const avg = salesHint(f)?.weeklyAverage;
      if (!avg) return [];
      const round = (n: number) => Math.round(n / 100) * 100;
      return [
        { id: "avg", label: `${money(round(avg))} (your average)`, value: round(avg) },
        { id: "up10", label: `${money(round(avg * 1.1))} (10% more)`, value: round(avg * 1.1) },
        { id: "up20", label: `${money(round(avg * 1.2))} (20% more)`, value: round(avg * 1.2) },
      ];
    },
    input: { optionId: "own", placeholder: "e.g. £8,000" },
    parse: pounds,
    error: "Could you type it as a number of pounds, for example £8,000?",
    skip: true,
  },
  {
    id: "sales.quiet",
    step: "sales",
    level: "important",
    decision: false,
    label: "Quiet days",
    field: "quiet_days",
    kind: "many",
    text: (f) => (salesHint(f)?.quietDays.length ? "Your sales say these are your quietest days. Are they right? Change any that aren't." : "Which days are usually quiet? Pick all that apply."),
    options: () => dayOptions("None really"),
    skip: true,
  },
  {
    id: "sales.busy",
    step: "sales",
    level: "important",
    decision: false,
    label: "Busy days",
    field: "busy_days",
    kind: "many",
    text: () => "And which days are usually your busiest?",
    options: () => dayOptions("None really"),
    skip: true,
  },

  // ---------- Chapter 8: your calendar ----------
  {
    id: "calendar.languages",
    step: "languages_dates",
    level: "important",
    decision: true,
    label: "Your customers' languages",
    field: "customer_languages",
    kind: "many",
    text: () => "Which languages do your customers speak? Pick all that apply, and I can write in them.",
    options: () => LANGUAGES.map((l) => ({ id: l.toLowerCase(), label: l, value: l })),
    input: { optionId: "own", placeholder: "Another language" },
    parse: (t) => (/^[a-z ]{3,30}$/i.test(t.trim()) ? t.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : null),
    error: "Just the name of the language, please.",
  },
  {
    id: "calendar.dates",
    step: "languages_dates",
    level: "important",
    decision: true,
    label: "Dates that matter",
    field: "event_audiences",
    kind: "many",
    text: () => "Besides Christmas and the bank holidays, which of these do your customers celebrate or follow? I'll plan offers around them.",
    options: () => [...AUDIENCES.filter((a) => a !== "all").map((a) => ({ id: a, label: AUDIENCE_LABELS[a as Exclude<typeof a, "all">], value: a })), { id: "none", label: "None of these", value: null, exclusive: true }],
  },
  {
    id: "calendar.closures",
    step: "languages_dates",
    level: "important",
    decision: false,
    label: "Holiday closures",
    field: "closures_note",
    kind: "text",
    text: () => "Any days you close in the year ahead, like Christmas Day or a summer break? I'll make sure no offers go out then.",
    options: () => [{ id: "none", label: "No closures planned", value: null }],
    input: { optionId: "own", placeholder: "e.g. Closed 25 and 26 December, and 1 to 14 August" },
    parse: (t) => (t.trim().length >= 3 && t.trim().length <= 300 ? t.trim() : null),
    error: "Could you write the dates in a few words?",
  },

  // ---------- Chapter 9: working together (the approvals and timing step) ----------
  {
    id: "working.brief",
    step: "approvals_timing",
    level: "essential",
    decision: true,
    label: "Morning brief",
    field: "brief_hour",
    kind: "one",
    text: () => "When should your morning brief arrive on WhatsApp? It's everything waiting for you, in one message.",
    options: () => [7, 8, 9, 10, 11].map((h) => ({ id: `h${h}`, label: `${h}am`, value: h })),
  },
  {
    id: "working.language",
    step: "approvals_timing",
    level: "important",
    decision: false,
    label: "Your language",
    field: "owner_language",
    kind: "one",
    text: () => "Which language would you like my messages to you in?",
    options: () => ["English", "Urdu", "Bengali", "Punjabi", "Arabic", "Turkish"].map((l) => ({ id: l.toLowerCase(), label: l, value: l })),
    input: { optionId: "own", placeholder: "Another language" },
    parse: (t) => (/^[a-z ]{3,30}$/i.test(t.trim()) ? t.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : null),
    error: "Just the name of the language, please.",
  },
  {
    id: "working.style",
    step: "approvals_timing",
    level: "important",
    decision: false,
    label: "How you like my messages",
    field: "message_style",
    kind: "one",
    text: () => "And how do you like my messages?",
    options: () => [
      { id: "short", label: "Short and to the point", short: "Short", value: "short" },
      { id: "detailed", label: "A bit more detail", short: "More detail", value: "detailed" },
    ],
  },
];

export const catalogById = new Map(CATALOG.map((q) => [q.id, q]));

// The value a pick (and any words typed) means, or why it can't be used.
export function catalogValue(q: CatalogQuestion, f: Facts, picked: string[], typed: string | null): { value: unknown } | { error: string } {
  const options = q.options?.(f) ?? [];
  const usesWords = q.input && (picked.includes(q.input.optionId) || (!picked.length && typed));
  if (usesWords) {
    if (!typed) return { error: "Type your answer, then confirm." };
    const v = q.parse ? q.parse(typed) : typed.trim();
    if (v === null || v === undefined) return { error: q.error ?? "I couldn't use that. Could you try again?" };
    if (q.kind === "many") {
      const others = picked.filter((p) => p !== q.input!.optionId).map((p) => options.find((o) => o.id === p)?.value ?? p);
      return { value: [...new Set([...others.map(String), String(v)])] };
    }
    return { value: v };
  }
  const chosen = picked.map((p) => options.find((o) => o.id === p)).filter((o): o is CatalogOption => Boolean(o));
  if (!chosen.length) return { error: "Pick one of the choices, or type your own." };
  if (q.kind === "many") {
    if (chosen.some((o) => o.exclusive)) return { value: [] };
    if (q.max && chosen.length > q.max) return { error: `Pick up to ${q.max}.` };
    return { value: chosen.map((o) => o.value ?? o.id) };
  }
  const o = chosen[0];
  return { value: o.value === undefined ? o.id : o.value };
}

// What's saved now, as the options it matches (shown picked on the card).
export function catalogSelected(q: CatalogQuestion, f: Facts): string[] {
  const options = q.options?.(f) ?? [];
  const v = f.r[q.field];
  if (q.kind === "many") {
    const vals = arr(v);
    const fromSales = q.id === "sales.quiet" ? salesHint(f)?.quietDays : q.id === "sales.busy" ? salesHint(f)?.busyDays : null;
    const use = vals.length ? vals : (fromSales ?? []);
    return options.filter((o) => o.value !== null && use.includes(String(o.value ?? o.id))).map((o) => o.id);
  }
  if (v === null || v === undefined || v === "") return [];
  return options.filter((o) => o.value !== null && JSON.stringify(o.value) === JSON.stringify(v)).map((o) => o.id).slice(0, 1);
}

// How the saved value reads on a recap.
export function catalogRecap(q: CatalogQuestion, f: Facts): string {
  const v = f.r[q.field];
  const options = q.options?.(f) ?? [];
  const label = (x: unknown) => options.find((o) => o.value !== null && JSON.stringify(o.value) === JSON.stringify(x))?.label ?? String(x);
  if (q.kind === "many") {
    const vals = arr(v);
    return vals.length ? vals.map((x) => (q.field === "event_audiences" || q.field === "goals" || q.field === "customer_types" || q.field.endsWith("_days") || q.field === "venue_types" || q.field === "approved_offer_types" ? label(x) : x)).join(", ") : "None";
  }
  if (v === null || v === undefined || v === "") return "None";
  if (q.field === "weekly_sales_target") return money(Number(v));
  if (q.field === "instagram") return `@${v}`;
  return q.kind === "text" ? String(v) : label(v);
}
