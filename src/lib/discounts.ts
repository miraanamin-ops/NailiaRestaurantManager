// Finds discounts in a message, in plain code, so the cap can be enforced.
// Only counts percentages that are clearly discounts ("25% off", "save 30%"),
// so things like "100% halal" are ignored.

const NUM = String.raw`(\d{1,3}(?:\.\d+)?)`;
const PCT = String.raw`\s*(?:%|percent|per\s*cent)`;

const PERCENT_PATTERNS = [
  // "25% off", "30 percent discount", "20% reduction"
  new RegExp(`${NUM}${PCT}\\s*(?:off|discount|reduction|saving|savings|cheaper)`, "gi"),
  // "save 30%", "discount of 25%", "up to 40%"
  new RegExp(`(?:save|saving|savings\\s+of|discount\\s+of|discounted\\s+by|reduced\\s+by|knock(?:ing)?|up\\s+to)\\s+(?:an?\\s+)?(?:extra\\s+)?${NUM}${PCT}`, "gi"),
];

// Deals that work out as 50% off.
const HALF_OFF_PATTERNS = [
  /half[\s-]?price/i,
  /half\s+off/i,
  /\bbogof\b/i,
  /buy\s+(?:one|1)\s*,?\s*get\s+(?:one|1)\s+free/i,
  /\b(?:2|two)[\s-]*for[\s-]*(?:1|one)\b/i,
];

export type DiscountFinding = { percent: number; phrase: string };

export function findDiscounts(text: string): DiscountFinding[] {
  const found: DiscountFinding[] = [];
  for (const re of PERCENT_PATTERNS) {
    for (const match of text.matchAll(re)) {
      found.push({ percent: Number(match[1]), phrase: match[0].trim() });
    }
  }
  for (const re of HALF_OFF_PATTERNS) {
    const match = text.match(re);
    if (match) found.push({ percent: 50, phrase: match[0].trim() });
  }
  return found;
}

// The biggest discount above the cap, or null if the message is within it.
export function overCap(text: string, capPercent: number): DiscountFinding | null {
  const over = findDiscounts(text).filter((d) => d.percent > capPercent);
  if (!over.length) return null;
  return over.reduce((a, b) => (b.percent > a.percent ? b : a));
}
