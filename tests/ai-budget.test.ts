import { describe, expect, test } from "vitest";
import { budgetVerdict, positiveNumber, REFUSAL_TEXT } from "@/lib/ai-budget-rules";

describe("AI limits for owner chat (review A2)", () => {
  test("under both limits: let through", () => {
    expect(budgetVerdict({ overHourly: false, spentToday: 0.4, capUsd: 3 })).toEqual({ ok: true, warn: false });
  });

  test("80% of the day's cap: let through, and the builder is warned", () => {
    expect(budgetVerdict({ overHourly: false, spentToday: 2.4, capUsd: 3 })).toEqual({ ok: true, warn: true });
  });

  test("the day's cap reached: chat pauses until midnight", () => {
    expect(budgetVerdict({ overHourly: false, spentToday: 3, capUsd: 3 })).toEqual({ ok: false, why: "budget" });
  });

  test("too many messages this hour wins over money", () => {
    expect(budgetVerdict({ overHourly: true, spentToday: 0, capUsd: 3 })).toEqual({ ok: false, why: "busy" });
  });

  test("settings: a positive number, otherwise the default", () => {
    expect(positiveNumber("5", 3)).toBe(5);
    expect(positiveNumber("0.5", 3)).toBe(0.5);
    expect(positiveNumber(undefined, 3)).toBe(3);
    expect(positiveNumber("", 3)).toBe(3);
    expect(positiveNumber("-1", 3)).toBe(3);
    expect(positiveNumber("lots", 3)).toBe(3);
  });

  test("the owner's words never mention money or tokens, and say what still works", () => {
    for (const text of Object.values(REFUSAL_TEXT)) {
      expect(text).not.toMatch(/\$|£|cost|token|budget|cap/i);
      expect(text).not.toMatch(/[—–]/);
    }
    expect(REFUSAL_TEXT.budget).toMatch(/9am brief/);
    expect(REFUSAL_TEXT.busy).toMatch(/Approve/);
  });
});
