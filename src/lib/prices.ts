// Prices in customer-facing text, checked in plain code (defence in depth: the
// checker once passed a wrong price). Every £ amount must be a price on the menu,
// a value in the draft's structured offer, or written in one of the owner's own
// offers (recovery offers, the sign-up reward, the birthday offer). Anything else
// fails before the checker runs. No imports, so it's unit-tested (tests/prices.test.ts).

const POUNDS = /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

// Every £ amount in a text, as numbers ("£13.95" -> 13.95, "£1,200" -> 1200).
export function poundsIn(text: string) {
  return [...text.matchAll(POUNDS)].map((m) => ({ text: m[0], value: Number(m[1].replace(/,/g, "")) }));
}

type Dish = { price?: unknown };
const menuPrices = (menu: unknown) =>
  (Array.isArray(menu) ? menu : [])
    .flatMap((c: { items?: Dish[] }) => (Array.isArray(c?.items) ? c.items : []))
    .map((d) => Number(d?.price))
    .filter((p) => Number.isFinite(p) && p > 0);

// The £ amounts that aren't a menu price, an offer value, or in the owner's own offers' wording.
export function unknownPrices(text: string, allowed: { menu: unknown; values?: (number | null | undefined)[]; ownerTexts?: (string | null | undefined)[] }) {
  const known = [
    ...menuPrices(allowed.menu),
    ...(allowed.values ?? []).filter((v): v is number => typeof v === "number" && v > 0),
    ...(allowed.ownerTexts ?? []).flatMap((t) => (t ? poundsIn(t).map((p) => p.value) : [])),
  ];
  return poundsIn(text)
    .filter((p) => !known.some((k) => Math.abs(k - p.value) < 0.005))
    .map((p) => p.text);
}

// The rule's wording for the agent (one problem per unknown amount).
export function priceProblems(text: string, allowed: Parameters<typeof unknownPrices>[1], where = "the text") {
  return unknownPrices(text, allowed).map((p) => `${p} in ${where} isn't a price on the menu or a value in the offer: use the menu's prices exactly`);
}
