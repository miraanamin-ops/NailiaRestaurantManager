// Customer email designs (phase 3 of the Inbox and emails plan, 15 Nov 2026), from the
// owner's Stitch mock-ups (project "Restaurant Email Marketing Templates"). Every
// campaign email belongs to a family (a discount on a dish, an occasion, a quiet night,
// a new dish, a birthday) and each family has three looks that take turns, so customers
// don't see the same format every time. The same looks redraw themselves in every
// restaurant's own logo, colours and sign-off.
//
// Plain code (tests/email-designs.test.ts): which family, which look, and the facts each
// look shows, worked out only from what the restaurant and the approved campaign say.
// Nothing here is invented: no "Est. 2014", no certificates, no table sizes.

export type Family = "discount" | "occasion" | "quiet" | "new_dish" | "birthday";

export const LOOKS = {
  discount: ["photo_hero", "big_number", "menu_card"],
  occasion: ["banner", "invitation", "date_led"],
  quiet: ["big_day", "table_for_two", "receipt"],
  new_dish: ["magazine", "just_landed", "chefs_note"],
  birthday: ["birthday"],
} as const satisfies Record<Family, readonly string[]>;
export type Look = (typeof LOOKS)[Family][number];

// What the owner sees on "Try another look" (one or two words each).
export const LOOK_NAMES: Record<Look, string> = {
  photo_hero: "Photo first",
  big_number: "Big number",
  menu_card: "Menu card",
  banner: "Banner",
  invitation: "Invitation",
  date_led: "Date first",
  big_day: "Big day",
  table_for_two: "Table for two",
  receipt: "Receipt",
  magazine: "Magazine",
  just_landed: "Just landed",
  chefs_note: "Chef's note",
  birthday: "Birthday",
};

// Saved on the campaign (campaigns.email_design, migration 071) when it's drafted, so
// the preview the owner approves is the email that goes. photo_url: the dish's photo.
export type EmailDesign = { family: Family; look: Look; photo_url: string | null };

export type CampaignLike = {
  id: string;
  name: string;
  subject: string;
  body: string;
  offer: string;
  valid_from: string;
  valid_until: string;
  is_birthday: boolean;
  offer_details?: {
    type: string;
    items: string[];
    applies_to: string | null;
    discount_percent: number | null;
    discount_value_gbp: number | null;
    conditions: string;
  } | null;
  email_design?: EmailDesign | null;
};

// ---------- Which family ----------

// Occasions the calendar knows, each with its own colours for the banner only (the
// restaurant's colours stay on the logo and button).
export type Occasion = { key: string; title: string; subtitle: string | null; icon: string; bg: string; accent: string; on: string };
const OCCASIONS: { re: RegExp; o: Omit<Occasion, "subtitle"> & { subtitle?: string } }[] = [
  { re: /\beid\b/i, o: { key: "eid", title: "Eid Mubarak", icon: "☾", bg: "#14432a", accent: "#d4a531", on: "#ffffff" } },
  { re: /\b(ramadan|iftar|suhoor|sehri)\b/i, o: { key: "ramadan", title: "Ramadan Kareem", icon: "☾", bg: "#1d2b4f", accent: "#d4a531", on: "#ffffff" } },
  { re: /\bdiwali\b/i, o: { key: "diwali", title: "Happy Diwali", icon: "✦", bg: "#4a1450", accent: "#f2a516", on: "#ffffff" } },
  { re: /\b(christmas|xmas|festive)\b/i, o: { key: "christmas", title: "Merry Christmas", icon: "✦", bg: "#14432a", accent: "#c8102e", on: "#ffffff" } },
  { re: /\bnew year/i, o: { key: "new_year", title: "Happy New Year", icon: "✦", bg: "#111827", accent: "#d4a531", on: "#ffffff" } },
  { re: /\bvalentine/i, o: { key: "valentines", title: "Valentine's Day", icon: "♥", bg: "#7a1230", accent: "#f7a8b8", on: "#ffffff" } },
  { re: /\bmother'?s day\b/i, o: { key: "mothers_day", title: "Mother's Day", icon: "✿", bg: "#5b2a4a", accent: "#f2b8c6", on: "#ffffff" } },
  { re: /\bfather'?s day\b/i, o: { key: "fathers_day", title: "Father's Day", icon: "★", bg: "#1f3a5f", accent: "#9cc3e8", on: "#ffffff" } },
  { re: /\b(match|derby|kick-?off|world cup|euros?|final)\b|\bv\.? [A-Z]/, o: { key: "match", title: "Match night", icon: "⚽", bg: "#14213d", accent: "#fca311", on: "#ffffff" } },
  { re: /\bbank holiday\b/i, o: { key: "bank_holiday", title: "Bank holiday", icon: "☀", bg: "#1f3a5f", accent: "#f2c14e", on: "#ffffff" } },
  { re: /\b(half[- ]term|school holidays?|easter)\b/i, o: { key: "holidays", title: "Holiday treat", icon: "☀", bg: "#215e61", accent: "#f2c14e", on: "#ffffff" } },
];

export function occasionOf(text: string): Occasion | null {
  for (const { re, o } of OCCASIONS) if (re.test(text)) return { subtitle: null, ...o };
  return null;
}

const QUIET = /\b(quiet|midweek|mid-week|calmer|slow)\b|\b(monday|tuesday|wednesday|thursday)s?\b.*\b(night|evening|lunch|only)\b/i;
const NEW_DISH = /\b(new on (the|our) menu|new dish|just landed|brand new|now on the menu|finally on the menu|introducing)\b/i;

export function familyOf(c: Pick<CampaignLike, "is_birthday" | "name" | "subject" | "body">): Family {
  if (c.is_birthday) return "birthday";
  const text = `${c.name}\n${c.subject}\n${c.body}`;
  if (occasionOf(`${c.name}\n${c.subject}`) ?? occasionOf(c.body)) return "occasion";
  if (NEW_DISH.test(text)) return "new_dish";
  if (QUIET.test(text)) return "quiet";
  return "discount";
}

// ---------- Which look ----------

// The next look after the last one this restaurant sent in that family (the first, if
// none), so two in a row never look the same.
export function nextLook(family: Family, lastLook: string | null): Look {
  const looks = LOOKS[family] as readonly Look[];
  const i = lastLook ? looks.indexOf(lastLook as Look) : -1;
  return looks[(i + 1) % looks.length];
}

// "Try another look": the next one round in the same family.
export function anotherLook(design: EmailDesign): EmailDesign {
  return { ...design, look: nextLook(design.family, design.look) };
}

// A campaign drafted before designs were saved (or with no 071): a steady choice from its id.
export function fallbackDesign(c: CampaignLike): EmailDesign {
  const family = familyOf(c);
  const looks = LOOKS[family] as readonly Look[];
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { family, look: looks[h % looks.length], photo_url: null };
}

export function designOf(c: CampaignLike): EmailDesign {
  const d = c.email_design;
  if (d && d.family in LOOKS && (LOOKS[d.family] as readonly string[]).includes(d.look)) return d;
  return fallbackDesign(c);
}

// ---------- What each look shows ----------

type MenuItem = { name: string; price: number; description: string | null };
type MenuCategory = { category: string; items: MenuItem[] };
export type DishFact = { name: string; description: string | null; price: number | null; section: string | null };

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function dishOn(menu: unknown, name: string | null | undefined): DishFact | null {
  if (!name) return null;
  const want = norm(name);
  for (const cat of (Array.isArray(menu) ? menu : []) as MenuCategory[]) {
    for (const d of Array.isArray(cat?.items) ? cat.items : []) {
      if (d && typeof d.name === "string" && norm(d.name) === want) {
        return { name: d.name, description: d.description ?? null, price: Number.isFinite(Number(d.price)) ? Number(d.price) : null, section: cat.category ?? null };
      }
    }
  }
  return null;
}

// The dish an offer is about: its first item, else what it comes with.
export function offerDish(c: CampaignLike, menu: unknown): DishFact | null {
  const o = c.offer_details;
  const names = [...(o?.items ?? []), o?.applies_to ?? null].filter(Boolean) as string[];
  for (const n of names) {
    const d = dishOn(menu, n);
    if (d) return d;
  }
  return names[0] && !/^any\b/i.test(names[0]) ? { name: names[0], description: null, price: null, section: null } : null;
}

const pounds = (n: number) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);

// The big type: "10%", "£5", "2 for 1", "Free". Null when the offer has no number to show.
export function bigNumber(c: CampaignLike): { big: string; rest: string } | null {
  const o = c.offer_details;
  if (o?.type === "percent_off" && o.discount_percent) return { big: `${o.discount_percent}%`, rest: "off" };
  if (o?.type === "money_off" && o.discount_value_gbp) return { big: pounds(o.discount_value_gbp), rest: "off" };
  if (o?.type === "two_for_one") return { big: "2 for 1", rest: "" };
  if (o?.type === "free_item" || o?.type === "kids_eat_free") return { big: "Free", rest: "" };
  const m = c.offer.match(/(\d{1,2})\s*%\s*off/i) ?? c.offer.match(/£\s?(\d+(?:\.\d{2})?)\s*off/i);
  if (m) return { big: m[0].includes("%") ? `${m[1]}%` : `£${m[1]}`, rest: "off" };
  return null;
}

// The new price on a menu card, for a % or £ off one dish only.
export function prices(c: CampaignLike, dish: DishFact | null): { was: number; now: number } | null {
  const o = c.offer_details;
  if (!dish?.price || !o) return null;
  if (o.type === "percent_off" && o.discount_percent) return { was: dish.price, now: Math.round(dish.price * (100 - o.discount_percent)) / 100 };
  if (o.type === "money_off" && o.discount_value_gbp && o.discount_value_gbp < dish.price) return { was: dish.price, now: Math.round((dish.price - o.discount_value_gbp) * 100) / 100 };
  return null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

// The day in big type on a quiet-night email: the day itself for a one-day offer, the
// weekday the words name, else "This week".
export function bigDay(c: CampaignLike): string {
  if (c.valid_from && c.valid_from === c.valid_until) return WEEKDAYS[ymdDate(c.valid_from).getUTCDay()];
  const named = `${c.subject} ${c.body}`.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (named) return named[1][0].toUpperCase() + named[1].slice(1).toLowerCase();
  const days = c.valid_from && c.valid_until ? spanDays(c.valid_from, c.valid_until) : [];
  if (days.length && days.every((d) => d >= 1 && d <= 4)) return "Midweek";
  return "This week";
}

function spanDays(from: string, to: string) {
  const out: number[] = [];
  for (let t = ymdDate(from).getTime(); t <= ymdDate(to).getTime() && out.length < 15; t += 86_400_000) out.push(new Date(t).getUTCDay());
  return out;
}

// The calendar tile on a date-led email: the offer's first day.
export function dateTile(ymd: string | null) {
  if (!ymd) return null;
  const d = ymdDate(ymd);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: String(d.getUTCDate()), month: MONTHS[d.getUTCMonth()] };
}

// A photo from the library that is plainly of this dish (its caption names it). Only
// the restaurant's own or Google photos, never one made up.
export function photoFor(library: { url: string; caption: string | null }[] | null | undefined, dish: string | null) {
  if (!dish || !library?.length) return null;
  const want = norm(dish);
  const hit = library.find((p) => p.caption && /^https:\/\//.test(p.url) && norm(p.caption).includes(want));
  return hit?.url ?? null;
}

// The design a new campaign gets: its family, the next look in turn, and the dish's
// photo if the library has one.
export function chooseDesign(c: Omit<CampaignLike, "id">, lastLook: string | null, menu: unknown, library: { url: string; caption: string | null }[] | null | undefined): EmailDesign {
  const family = familyOf(c);
  const dish = offerDish({ ...c, id: "" }, menu);
  return { family, look: nextLook(family, lastLook), photo_url: photoFor(library, dish?.name ?? null) };
}
