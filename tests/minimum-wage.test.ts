import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MINIMUM_WAGE, ratesOn, wageWarning } from "@/lib/rota/minimum-wage";

// A pay rate below the minimum wage is saved with a warning, never blocked (review R2).
describe("minimum wage warning", () => {
  test("the rates change on 1 April", () => {
    expect(ratesOn("2026-03-31").adult).toBe(12.21);
    expect(ratesOn("2026-04-01").adult).toBe(12.71);
    expect(ratesOn("2027-04-01").adult).toBe(13.21);
  });

  test("at or above the 21-and-over rate: no warning", () => {
    expect(wageWarning("Ali", 1271, "2026-11-18")).toBeNull();
    expect(wageWarning("Ali", 1500, "2026-11-18")).toBeNull();
    expect(wageWarning("Ali", null, "2026-11-18")).toBeNull();
  });

  test("below it: saved as said, with the lower rates that might apply", () => {
    const w = wageWarning("Ali", 1100, "2026-11-18");
    expect(w).toMatch(/£11\.00 an hour for Ali is below the minimum wage for staff aged 21 and over \(£12\.71\)/);
    expect(w).toMatch(/18 to 20 \(£10\.85\)/);
    expect(w).toMatch(/I've saved it as you said/);
  });

  test("below every rate: said plainly", () => {
    expect(wageWarning("Ali", 800 - 1, "2026-11-18")).toMatch(/below every UK minimum wage rate/);
  });

  test("no dashes in the owner's words", () => {
    expect(wageWarning("Ali", 900, "2026-11-18")).not.toMatch(/[—–]/);
  });

  test("the numbers match the UK facts file the AI answers from", () => {
    const facts = readFileSync("agents/uk-facts.md", "utf8");
    const current = MINIMUM_WAGE.find((r) => r.from === "2026-04-01")!;
    expect(facts).toContain(`21 and over: £${current.adult.toFixed(2)}`);
    expect(facts).toContain(`18 to 20: £${current.age18to20.toFixed(2)}`);
    expect(facts).toContain(`Apprentice rate: £${current.apprentice.toFixed(2)}`);
    const next = MINIMUM_WAGE.find((r) => r.from === "2027-04-01")!;
    expect(facts).toContain(`£${next.adult.toFixed(2)} (21 and over)`);
  });
});
