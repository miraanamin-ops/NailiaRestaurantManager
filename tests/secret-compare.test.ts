import { describe, expect, test } from "vitest";
import { bearerMatches } from "@/lib/secret-compare";

// Cron and worker passwords are compared in constant time (review S3).
describe("bearerMatches", () => {
  test("only the exact Bearer header matches", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret ", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });

  test("nothing matches a missing secret or header", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
  });
});
