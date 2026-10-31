import type { ConfirmationData } from "@/components/chat/types";
import { DAYS, formatPrice, parseHoursText, type Hours, type MenuCategory } from "../profile-data";

// Steps 4 to 6 in plain code (unit-tested in tests/dina-facts.test.ts): what a
// recovery offer may be, the seven common questions, the hours and menu cards,
// and the order allergens are checked in, one dish at a time.

// ---------- 4. Making it right ----------

// An offer to an unhappy customer can't go over the discount cap: a percentage
// above it, or a whole free meal (100% off), is refused with the reason. A free
// dessert or drink, an invitation back, or taking it offline are fine. (Replies
// are checked again when they're written: lib/agents/reputation-rules.ts.)
export function offerProblems(offers: string[], capPercent: number): string[] {
  const problems: string[] = [];
  for (const o of offers) {
    const pct = [...o.matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1]));
    if (pct.some((p) => p > capPercent)) problems.push(`"${o}" is more than your ${capPercent}% discount cap.`);
    else if (/\b(free|complimentary)\s+(meal|dinner|lunch|food|visit|order|takeaway|bill)\b|\b(full|100%)\s+refund\b|\bon the house\b/i.test(o))
      problems.push(`"${o}" is a whole meal free, which is more than your ${capPercent}% discount cap.`);
  }
  return problems;
}

// ---------- 6. Hours and FAQs ----------

export const FAQ_TOPICS = [
  { id: "halal", label: "Halal certification", question: "Is the food halal, and is it certified (by whom)?" },
  { id: "parking", label: "Parking", question: "Is there parking nearby?" },
  { id: "delivery", label: "Delivery and collection", question: "Do you deliver, or do collection (and through which apps)?" },
  { id: "bookings", label: "Bookings", question: "Do you take bookings, and how?" },
  { id: "accessibility", label: "Accessibility", question: "Is it accessible for wheelchairs and pushchairs?" },
  { id: "kids", label: "Children", question: "Are children welcome (high chairs, a kids' menu)?" },
  { id: "private_hire", label: "Private hire", question: "Can people hire the restaurant, or a room, for events?" },
] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number]["id"];
export const FAQ_IDS = FAQ_TOPICS.map((t) => t.id) as FaqTopic[];

// "skip" for a topic: asked, and they'd rather not say (it isn't asked again).
export const FAQ_SKIPPED = "(not answered)";

export function faqsLeft(answers: Record<string, string> | null | undefined) {
  return FAQ_TOPICS.filter((t) => !answers?.[t.id]?.trim());
}

// What she noted of the hours, day by day, tidied: "12-10pm" -> "12:00 – 22:00", "closed" -> "Closed".
export function hoursFromNotes(notes: Record<string, string>): { hours: Hours; problems: string[] } {
  const hours: Hours = {};
  const problems: string[] = [];
  for (const [day, text] of Object.entries(notes)) {
    const d = DAYS.find((x) => x.toLowerCase() === day.trim().toLowerCase());
    if (!d) {
      problems.push(`"${day}" isn't a day of the week.`);
      continue;
    }
    const tidy = parseHoursText(text);
    if (tidy) hours[d] = tidy;
    else problems.push(`${d}'s hours ("${text}") aren't clear.`);
  }
  return { hours, problems };
}

export function hoursCard(hours: Hours): ConfirmationData {
  return { title: "Your opening hours", fields: DAYS.map((d) => ({ key: d, label: d, value: hours[d] ?? null })) };
}

// ---------- 5. Menu ----------

// A dish as the menu card shows it: one row each, with its section and price.
// unsure: dishes the reading wasn't sure of ("price unclear"), flagged on the card.
export function menuCard(menu: MenuCategory[], unsure: Record<string, string> = {}): ConfirmationData {
  return {
    title: "Your menu",
    fields: menu.flatMap((c) =>
      c.items.map((i) => {
        const flag = unsure[dishKey(c.category, i.name)];
        return { key: dishKey(c.category, i.name), label: i.name, value: `${i.price ? formatPrice(i.price) : "no price"} · ${c.category}${flag ? ` (${flag})` : ""}` };
      }),
    ),
  };
}

export const dishKey = (section: string, name: string) => `${section.trim()}::${name.trim()}`.toLowerCase();

// The next dish whose allergens the owner hasn't checked (or said "not sure" to).
export function nextAllergenDish(menu: MenuCategory[], notSure: string[] = []) {
  for (const c of menu)
    for (const i of c.items) {
      const key = dishKey(c.category, i.name);
      if (!i.allergens_confirmed && !notSure.includes(key)) return { key, section: c.category, name: i.name, suggested: i.allergens ?? [] };
    }
  return null;
}

export function allergenProgress(menu: MenuCategory[], notSure: string[] = []) {
  const all = menu.flatMap((c) => c.items.map((i) => ({ key: dishKey(c.category, i.name), confirmed: Boolean(i.allergens_confirmed) })));
  const confirmed = all.filter((d) => d.confirmed).length;
  const unknown = all.filter((d) => !d.confirmed && notSure.includes(d.key)).length;
  return { total: all.length, confirmed, unknown, left: all.length - confirmed - unknown };
}

// "milk, mustard" or "no allergens" (as suggested; the owner confirms).
export const allergenList = (a: string[]) => (a.length ? a.join(", ") : "none of the 14");
