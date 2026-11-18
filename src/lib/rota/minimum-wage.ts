// The UK minimum wage, for a warning when an owner saves a pay rate below it
// (security review R2). A warning only: the rate is saved as the owner said, and
// nothing is blocked. The owner may know better (an apprentice, someone under 21).
// Pure, unit-tested in tests/minimum-wage.test.ts, which also checks these numbers
// match agents/uk-facts.md. Update both each April.

export type WageRates = { from: string; adult: number; age18to20: number; under18: number; apprentice: number };

// £ an hour, by the date each set started (GOV.UK, "The National Minimum Wage in 2026").
export const MINIMUM_WAGE: WageRates[] = [
  { from: "2025-04-01", adult: 12.21, age18to20: 10.0, under18: 7.55, apprentice: 7.55 },
  { from: "2026-04-01", adult: 12.71, age18to20: 10.85, under18: 8.0, apprentice: 8.0 },
  { from: "2027-04-01", adult: 13.21, age18to20: 11.27, under18: 8.31, apprentice: 8.31 },
];

export function ratesOn(ymd: string): WageRates {
  return [...MINIMUM_WAGE].reverse().find((r) => r.from <= ymd) ?? MINIMUM_WAGE[0];
}

const money = (n: number) => `£${n.toFixed(2)}`;

// One line for the owner, or null when the rate is at or above the 21-and-over rate.
export function wageWarning(name: string, ratePence: number | null | undefined, today: string): string | null {
  if (ratePence == null || ratePence <= 0) return null;
  const rate = ratePence / 100;
  const r = ratesOn(today);
  if (rate >= r.adult - 1e-9) return null;
  const who = name.trim() || "This person";
  if (rate < r.under18 - 1e-9)
    return `⚠️ ${money(rate)} an hour for ${who} is below every UK minimum wage rate (the lowest, for under 18s and apprentices, is ${money(r.under18)}). I've saved it as you said; please check it.`;
  return `⚠️ ${money(rate)} an hour for ${who} is below the minimum wage for staff aged 21 and over (${money(r.adult)}). It can be right for someone aged 18 to 20 (${money(r.age18to20)}), under 18 or an apprentice (${money(r.apprentice)}). I've saved it as you said.`;
}
