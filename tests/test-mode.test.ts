// TEST_MODE: test commands and the TIME clock only work when it's on.
import { afterEach, describe, expect, test, vi } from "vitest";
import { restaurantNow } from "@/lib/supabase";
import { isTestCommand, TEST_MODE_OFF_MESSAGE } from "@/lib/test-mode";

afterEach(() => {
  delete process.env.TEST_MODE;
});

const turnWith = (send: (text: string) => Promise<void>) =>
  ({ ctx: { restaurant: { id: "r1", fake_now: null }, now: new Date() }, channel: {}, owner: "whatsapp:+44", send }) as never;

describe("test mode", () => {
  test("these are the test-only commands", () => {
    for (const c of ["time", "time_off", "test_send", "test_checker", "new_review", "run_reviews", "run_posts", "run_brief", "run_report"]) {
      expect(isTestCommand(c)).toBe(true);
    }
    for (const c of ["approve_all", "undo", "pause", "resume", "cap", "help", "status", "campaign_results"]) expect(isTestCommand(c)).toBe(false);
  });

  test("off by default: a test command does nothing and says so", async () => {
    const { runCommand } = await import("@/lib/bot/commands");
    const send = vi.fn(async () => {});
    await runCommand({ name: "time", hhmm: "22:00", plusDays: 0 }, turnWith(send));
    await runCommand({ name: "new_review", rating: 5 }, turnWith(send));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, TEST_MODE_OFF_MESSAGE);
  });

  test("HELP only lists test commands when test mode is on", async () => {
    const { runCommand } = await import("@/lib/bot/commands");
    const off = vi.fn(async () => {});
    await runCommand({ name: "help" }, turnWith(off));
    expect(String((off.mock.calls[0] as unknown[])[0])).not.toMatch(/NEW REVIEW/);
    process.env.TEST_MODE = "true";
    const on = vi.fn(async () => {});
    await runCommand({ name: "help" }, turnWith(on));
    expect(String((on.mock.calls[0] as unknown[])[0])).toMatch(/NEW REVIEW/);
  });

  test("the TIME test clock is ignored unless test mode is on", () => {
    const fake = "2026-01-01T22:00:00.000Z";
    expect(restaurantNow({ fake_now: fake }).toISOString()).not.toBe(fake);
    process.env.TEST_MODE = "true";
    expect(restaurantNow({ fake_now: fake }).toISOString()).toBe(fake);
  });
});
