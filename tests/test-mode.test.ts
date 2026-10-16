// TEST_TOOLS: test commands, the TIME clock, RESET ONBOARDING and moving a test
// phone between demo restaurants. Only with TEST_TOOLS on (or the deprecated
// TEST_MODE=true), and only ever for a demo restaurant: a real one is never affected.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { restaurantNow } from "@/lib/supabase";
import { isTestCommand, TEST_TOOLS_OFF_MESSAGE, TEST_TOOLS_REAL_RESTAURANT_MESSAGE } from "@/lib/test-mode";

beforeEach(() => {
  vi.stubEnv("TEST_MODE", "");
  vi.stubEnv("TEST_TOOLS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const turnWith = (send: (text: string) => Promise<void>, isDemo = true) =>
  ({ ctx: { restaurant: { id: "r1", fake_now: null, is_demo: isDemo }, now: new Date() }, channel: {}, owner: "whatsapp:+44", send }) as never;
const firstText = (send: ReturnType<typeof vi.fn>) => String((send.mock.calls[0] as unknown[])[0]);

describe("test tools", () => {
  test("these are the test-only commands", () => {
    for (const c of ["time", "time_off", "test_send", "test_checker", "new_review", "run_reviews", "run_posts", "run_brief", "run_report", "reset_onboarding"]) {
      expect(isTestCommand(c)).toBe(true);
    }
    for (const c of ["approve_all", "undo", "pause", "resume", "cap", "help", "status", "campaign_results"]) expect(isTestCommand(c)).toBe(false);
  });

  test("off by default: a test command does nothing and says so, even for a demo restaurant", async () => {
    const { runCommand } = await import("@/lib/bot/commands");
    const send = vi.fn(async () => {});
    await runCommand({ name: "time", hhmm: "22:00", plusDays: 0 }, turnWith(send));
    await runCommand({ name: "new_review", rating: 5 }, turnWith(send));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, TEST_TOOLS_OFF_MESSAGE);
  });

  test("with TEST_TOOLS on, a real restaurant's test commands still do nothing", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    const { runCommand } = await import("@/lib/bot/commands");
    const send = vi.fn(async () => {});
    await runCommand({ name: "time", hhmm: "22:00", plusDays: 0 }, turnWith(send, false));
    await runCommand({ name: "reset_onboarding" }, turnWith(send, false));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, TEST_TOOLS_REAL_RESTAURANT_MESSAGE);
    expect(send).toHaveBeenNthCalledWith(2, TEST_TOOLS_REAL_RESTAURANT_MESSAGE);
  });

  test("HELP lists test commands only with TEST_TOOLS on and only for a demo restaurant", async () => {
    const { runCommand } = await import("@/lib/bot/commands");
    const off = vi.fn(async () => {});
    await runCommand({ name: "help" }, turnWith(off));
    expect(firstText(off)).not.toMatch(/NEW REVIEW/);
    vi.stubEnv("TEST_TOOLS", "true");
    const real = vi.fn(async () => {});
    await runCommand({ name: "help" }, turnWith(real, false));
    expect(firstText(real)).not.toMatch(/NEW REVIEW/);
    const demo = vi.fn(async () => {});
    await runCommand({ name: "help" }, turnWith(demo));
    expect(firstText(demo)).toMatch(/NEW REVIEW/);
  });

  test("the TIME test clock only counts with TEST_TOOLS on, for a demo restaurant", () => {
    const fake = "2026-01-01T22:00:00.000Z";
    expect(restaurantNow({ fake_now: fake, is_demo: true }).toISOString()).not.toBe(fake);
    vi.stubEnv("TEST_TOOLS", "true");
    expect(restaurantNow({ fake_now: fake, is_demo: false }).toISOString()).not.toBe(fake);
    expect(restaurantNow({ fake_now: fake, is_demo: true }).toISOString()).toBe(fake);
  });

  test("TEST_MODE=true (deprecated) still turns test tools on, and TEST_TOOLS=false beats it", () => {
    const fake = "2026-01-01T22:00:00.000Z";
    vi.stubEnv("TEST_MODE", "true");
    expect(restaurantNow({ fake_now: fake, is_demo: true }).toISOString()).toBe(fake);
    vi.stubEnv("TEST_TOOLS", "false");
    expect(restaurantNow({ fake_now: fake, is_demo: true }).toISOString()).not.toBe(fake);
  });
});

describe("RESET ONBOARDING", () => {
  test("never resets a real restaurant, and needs TEST_TOOLS for a demo one", async () => {
    vi.resetModules();
    const resetOnboarding = vi.fn(async () => {});
    vi.doMock("@/lib/onboarding/engine", () => ({ resetOnboarding }));
    const { resetOnboardingText } = await import("@/lib/onboarding/whatsapp-flow");
    vi.stubEnv("TEST_TOOLS", "true");
    expect(await resetOnboardingText({ id: "r1", is_demo: false, name: "Real Grill" })).toMatch(/Only demo/);
    vi.stubEnv("TEST_TOOLS", "false");
    expect(await resetOnboardingText({ id: "r2", is_demo: true, name: "Demo Grill" })).toMatch(/Test tools are off/);
    expect(resetOnboarding).not.toHaveBeenCalled();
    vi.stubEnv("TEST_TOOLS", "true");
    expect(await resetOnboardingText({ id: "r2", is_demo: true, name: "Demo Grill" })).toMatch(/Reset/);
    expect(resetOnboarding).toHaveBeenCalledWith("r2");
    vi.doUnmock("@/lib/onboarding/engine");
  });
});

describe("moving a test phone between restaurants", () => {
  const PHONE = "whatsapp:+447700900123";
  async function link(current: { is_demo: boolean }, target: { is_demo: boolean }) {
    vi.resetModules();
    const { memoryDb } = await import("./support/memory-db");
    const db = memoryDb({
      restaurants: [
        { id: "cur", name: "Current", owner_whatsapp: PHONE, is_demo: current.is_demo },
        { id: "new", name: "New", owner_whatsapp: null, is_demo: target.is_demo },
      ],
      onboarding: [{ restaurant_id: "new", link_code: "ABC123", link_code_expires_at: null }],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    const { linkWhatsApp } = await import("@/lib/onboarding/store");
    const result = await linkWhatsApp("ABC123", PHONE, "whatsapp:+14155238886");
    vi.doUnmock("@/lib/supabase");
    return { result, owner: (id: string) => db.tables.restaurants.find((r) => r.id === id)?.owner_whatsapp ?? null };
  }

  test("with TEST_TOOLS on, a phone moves from one demo restaurant to another", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    const { result, owner } = await link({ is_demo: true }, { is_demo: true });
    expect(result.ok).toBe(true);
    expect(owner("cur")).toBeNull();
    expect(owner("new")).toBe(PHONE);
  });

  test("a real restaurant's number is never taken away, test tools or not", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    const { result, owner } = await link({ is_demo: false }, { is_demo: true });
    expect(result).toEqual({ ok: false, reason: "number_taken" });
    expect(owner("cur")).toBe(PHONE);
  });

  test("a demo restaurant's phone is never moved onto a real restaurant", async () => {
    vi.stubEnv("TEST_TOOLS", "true");
    const { result, owner } = await link({ is_demo: true }, { is_demo: false });
    expect(result).toEqual({ ok: false, reason: "number_taken" });
    expect(owner("cur")).toBe(PHONE);
    expect(owner("new")).toBeNull();
  });

  test("with TEST_TOOLS off, nothing moves", async () => {
    const { result } = await link({ is_demo: true }, { is_demo: true });
    expect(result).toEqual({ ok: false, reason: "number_taken" });
  });
});
