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

// A dish on the menu by name ("lamb chops" finds "Lamb Chops (4 pcs)").
export function findDish(menu: unknown, name: string | null | undefined): Dish | null {
  if (!name) return null;
  const want = norm(name);
  const list = dishes(menu);
  return list.find((d) => norm(d.name) === want) ?? list.find((d) => norm(d.name).includes(want) || (want.length > 3 && want.includes(norm(d.name)))) ?? null;
}

export type CapResult =
  | { ok: true; percent: number }
  | { ok: false; reason: "over_cap"; percent: number; detail: string }
  | { ok: false; reason: "unknown"; detail: string };

// The offer's discount as a percentage, against the cap.
export function offerCap(offer: Pick<StructuredOffer, "type" | "applies_to" | "discount_percent" | "discount_value_gbp" | "description">, menu: unknown, capPercent: number): CapResult {
  let percent: number;
  if (offer.type === "percent_off") {
    if (offer.discount_percent == null || !(offer.discount_percent > 0)) return { ok: false, reason: "unknown", detail: "a % off offer needs its percentage" };
    percent = offer.discount_percent;
  } else if (offer.type === "two_for_one") {
    // Two for the price of one is half off the pair.
    percent = 50;
  } else {
    const dish = findDish(menu, offer.applies_to);
    if (!dish || !(dish.price > 0)) return { ok: false, reason: "unknown", detail: `can't check "${offer.description}" against the cap: name the menu dish it comes with` };
    if (offer.discount_value_gbp == null || !(offer.discount_value_gbp > 0)) return { ok: false, reason: "unknown", detail: `can't check "${offer.description}" against the cap: it needs its value in £` };
    percent = (offer.discount_value_gbp / dish.price) * 100;
  }
  const rounded = Math.round(percent);
  if (percent > capPercent + 1e-9) return { ok: false, reason: "over_cap", percent: rounded, detail: `"${offer.description}" is worth ${rounded}% off, above the ${capPercent}% cap` };
  return { ok: true, percent: rounded };
}
