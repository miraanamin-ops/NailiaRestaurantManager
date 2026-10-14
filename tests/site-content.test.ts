// The landing page copy (src/content/site.ts): house rules that are easy to break
// while editing words.
import { describe, expect, test } from "vitest";
import { fill, site } from "@/content/site";

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("landing page copy", () => {
  test("no em-dashes or en-dashes anywhere", () => {
    const bad = strings(site).filter((s) => /[—–]/.test(s));
    expect(bad).toEqual([]);
  });

  test("made-up numbers are marked as examples", () => {
    expect(site.outcomes.example).toBe("Example");
    expect(site.problem.pileExample).toBe("Example");
    expect(site.report.stamp).toMatch(/^Example/);
    expect(site.hero.phoneLabel).toMatch(/^Example/);
  });

  test("things not built yet are marked coming soon", () => {
    expect(site.outcomes.soonLabel).toBe("Coming soon");
    expect(site.outcomes.soon).toContain("Automatic Google sync");
  });

  test("trial length and price are filled in", () => {
    expect(fill(site.hero.note, { days: 14, price: 99 })).toBe("14 days free, then £99 a month. No contract, no setup fee.");
    expect(strings(site).map((s) => fill(s, { days: 14, price: 99 })).filter((s) => /\{(days|price)\}/.test(s))).toEqual([]);
  });
});
