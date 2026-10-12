// Offers as structured fields: the kinds of offer, and the discount cap worked
// out from the fields (not the wording). The cap is a percentage: a percent-off
// offer is checked as it is; a free item or money off is checked as a percentage
// of the menu price of the dish it comes with (a free £3.50 lassi with an £18.50
// platter is 19%). If code can't work the percentage out, the offer is blocked
// and the owner asked. No imports, so every rule is unit-tested (tests/offers.test.ts).

export const OFFER_TYPES = ["percent_off", "money_off", "free_item", "kids_eat_free", "two_for_one"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  percent_off: "% off",
  money_off: "£ off",
  free_item: "A free item with a purchase",
  kids_eat_free: "Kids eat free",
  two_for_one: "2 for 1",
};

export type StructuredOffer = {
  type: OfferType;
  description: string;
  // Menu dishes the offer involves (the free item, the dish that's discounted).
  items: string[];
  // The dish (or main) the offer comes with: what a free item or £ off is measured against.
  applies_to: string | null;
  discount_percent: number | null;
  discount_value_gbp: number | null;
  valid_from: string;
  valid_to: string;
  conditions: string;
};

type Dish = { name: string; price: number };
const dishes = (menu: unknown): Dish[] =>
  (Array.isArray(menu) ? menu : []).flatMap((c: { items?: Dish[] }) => (Array.isArray(c?.items) ? c.items : [])).filter((d) => d && typeof d.name === "string");

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// "with any main" / "with any grill": the cheapest dish it could come with. "any grill"
// means a category with that word; "any main" means every dish outside sides, drinks,
// desserts, starters and extras.
const NOT_MAINS = /side|drink|dessert|sweet|starter|extra|sauce|bread|kids|dip/i;
export function cheapestFor(menu: unknown, appliesTo: string): Dish | null {
  const m = appliesTo.trim().toLowerCase().match(/^any\s+(.+?)s?$/);
  if (!m) return null;
  const cats = (Array.isArray(menu) ? menu : []) as { category?: string; items?: Dish[] }[];
  const word = m[1];
  const pick = word === "main" || word === "dish" || word === "meal" ? cats.filter((c) => !NOT_MAINS.test(c.category ?? "")) : cats.filter((c) => (c.category ?? "").toLowerCase().includes(word));
  const list = pick.flatMap((c) => c.items ?? []).filter((d) => d && d.price > 0);
  return list.length ? list.reduce((a, b) => (b.price < a.price ? b : a)) : null;
}

// The owner's own offers (typed in settings): the gate doesn't cap them, but only when
// the offer's description is that offer, word for word (code decides, never the agent).
// A campaign that merely gives away the same item ("free Mango Lassi with any platter")
// is a new offer and is capped.
export type OwnerOffers = { birthday_offer?: string | null; signup_reward?: string | null };
const same = (a: string, b: string) => {
  // Lower case, words only, without a leading "a", "an" or "the" ("a free Mango Lassi" = "Free Mango Lassi").
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9£%]+/g, " ").trim().replace(/^(?:a|an|the) /, "");
  return Boolean(n(b)) && n(a) === n(b);
};
export function ownerSetOffer(description: string, owner: OwnerOffers): "birthday_offer" | "signup_reward" | null {
  if (owner.birthday_offer && same(description, owner.birthday_offer)) return "birthday_offer";
  if (owner.signup_reward && same(description, owner.signup_reward)) return "signup_reward";
  return null;
}

// A dish on the menu by name ("lamb chops" finds "Lamb Chops (4 pcs)").
export function findDish(menu: unknown, name: string | null | undefined): Dish | null {
  if (!name) return null;
  const want = norm(name);
  const list = dishes(menu);
  return list.find((d) => norm(d.name) === want) ?? list.find((d) => norm(d.name).includes(want) || (want.length > 3 && want.includes(norm(d.name)))) ?? null;
}

export type CapResult =
  | { ok: true; percent: number; ownerSet?: boolean }
  | { ok: false; reason: "over_cap"; percent: number; detail: string }
  | { ok: false; reason: "unknown"; detail: string };

// The offer's discount as a percentage, against the cap.
export function offerCap(
  offer: Pick<StructuredOffer, "type" | "applies_to" | "discount_percent" | "discount_value_gbp" | "description">,
  menu: unknown,
  capPercent: number,
  owner: OwnerOffers = {},
): CapResult {
  // The owner's own birthday offer or sign-up reward: their decision, not capped.
  if (ownerSetOffer(offer.description, owner)) return { ok: true, percent: 0, ownerSet: true };
  let percent: number;
  if (offer.type === "percent_off") {
    if (offer.discount_percent == null || !(offer.discount_percent > 0)) return { ok: false, reason: "unknown", detail: "a % off offer needs its percentage" };
    percent = offer.discount_percent;
  } else if (offer.type === "two_for_one") {
    // Two for the price of one is half off the pair.
    percent = 50;
  } else {
    const dish = findDish(menu, offer.applies_to) ?? (offer.applies_to ? cheapestFor(menu, offer.applies_to) : null);
    if (!dish || !(dish.price > 0)) return { ok: false, reason: "unknown", detail: `can't check "${offer.description}" against the cap: name the menu dish it comes with` };
    if (offer.discount_value_gbp == null || !(offer.discount_value_gbp > 0)) return { ok: false, reason: "unknown", detail: `can't check "${offer.description}" against the cap: it needs its value in £` };
    percent = (offer.discount_value_gbp / dish.price) * 100;
  }
  const rounded = Math.round(percent);
  if (percent > capPercent + 1e-9) return { ok: false, reason: "over_cap", percent: rounded, detail: `"${offer.description}" is worth ${rounded}% off, above the ${capPercent}% cap` };
  return { ok: true, percent: rounded };
}
