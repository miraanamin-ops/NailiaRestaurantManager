// Quantities in standard units: every ingredient is counted in grams, millilitres
// or "each". Invoices say "5kg", "2 x 1L", "12 x 400g", "case of 24": these turn
// them into the standard unit. No imports, so it's unit-tested.

export type StdUnit = "g" | "ml" | "each";

const UNITS: Record<string, { unit: StdUnit; factor: number }> = {
  mg: { unit: "g", factor: 0.001 },
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kgs: { unit: "g", factor: 1000 },
  kilo: { unit: "g", factor: 1000 },
  kilos: { unit: "g", factor: 1000 },
  lb: { unit: "g", factor: 453.592 },
  lbs: { unit: "g", factor: 453.592 },
  oz: { unit: "g", factor: 28.3495 },
  ml: { unit: "ml", factor: 1 },
  cl: { unit: "ml", factor: 10 },
  l: { unit: "ml", factor: 1000 },
  lt: { unit: "ml", factor: 1000 },
  ltr: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  litres: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  pint: { unit: "ml", factor: 568.261 },
  pints: { unit: "ml", factor: 568.261 },
  each: { unit: "each", factor: 1 },
  ea: { unit: "each", factor: 1 },
  pc: { unit: "each", factor: 1 },
  pcs: { unit: "each", factor: 1 },
  piece: { unit: "each", factor: 1 },
  pieces: { unit: "each", factor: 1 },
  unit: { unit: "each", factor: 1 },
  units: { unit: "each", factor: 1 },
  egg: { unit: "each", factor: 1 },
  eggs: { unit: "each", factor: 1 },
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// 5, "kg" -> { quantity: 5000, unit: "g" }. null for a unit we don't know.
export function toStandard(quantity: number, unit: string): { quantity: number; unit: StdUnit } | null {
  const u = UNITS[unit.trim().toLowerCase().replace(/\.$/, "")];
  if (!u || !Number.isFinite(quantity)) return null;
  return { quantity: round3(quantity * u.factor), unit: u.unit };
}

// "5kg" -> 5000 g, "2 x 1L" -> 2000 ml, "12x400g" -> 4800 g, "case of 24" -> 24 each,
// "30" -> 30 each. null if it can't be read.
export function parsePack(text: string): { quantity: number; unit: StdUnit } | null {
  const t = text.trim().toLowerCase().replace(/,/g, "");
  const caseOf = t.match(/^(?:case|box|tray|pack|bag)\s+of\s+(\d+(?:\.\d+)?)$/);
  if (caseOf) return { quantity: Number(caseOf[1]), unit: "each" };
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*([a-z]+\.?)?$/);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2]);
  const one = toStandard(size, m[3] ?? "each");
  return one ? { quantity: round3(count * one.quantity), unit: one.unit } : null;
}

// Converting between two amounts only works within one standard unit.
export function sameUnit(a: StdUnit, b: StdUnit) {
  return a === b;
}

// The cost in pence of using `quantity` (standard units) of an ingredient priced
// at pricePence per packQuantity, allowing for waste: 10% waste means buying
// quantity / 0.9. Fractions of a penny are kept (round when showing).
export function lineCostPence(quantity: number, pricePence: number, packQuantity: number, wastePct = 0) {
  if (packQuantity <= 0 || wastePct >= 100) return null;
  return (quantity / (1 - wastePct / 100)) * (pricePence / packQuantity);
}
