import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The older six-step setup is retired (review AR1): anyone part-way through it is
// moved into Dina's chapters, never put back into setup if they're already running.
describe("moving an unfinished older setup into Dina's chapters", () => {
  let session: { completed_at: string | null } | null;
  let old: { completed_at: string | null } | null;
  let active: boolean;
  const started: string[] = [];

  beforeEach(() => {
    session = null;
    old = { completed_at: null };
    active = false;
    started.length = 0;
    vi.resetModules();
    vi.doMock("@/lib/onboarding/sessions", () => ({
      getSession: async () => session,
      startOnboarding: async (id: string) => (started.push(id), { completed_at: null }),
    }));
    vi.doMock("@/lib/onboarding/store", () => ({ getOnboarding: async () => old }));
    vi.doMock("@/lib/supabase", () => ({
      getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { active } }) }) }) }) }),
    }));
  });
  afterEach(() => {
    vi.doUnmock("@/lib/onboarding/sessions");
    vi.doUnmock("@/lib/onboarding/store");
    vi.doUnmock("@/lib/supabase");
  });

  const move = async () => (await import("@/lib/onboarding/retire-old")).moveOldSetupToDina("r1");

  test("part-way through the older setup: Dina's setup starts", async () => {
    expect(await move()).toBe(true);
    expect(started).toEqual(["r1"]);
  });

  test("already on Dina's setup: nothing new is started", async () => {
    session = { completed_at: null };
    expect(await move()).toBe(true);
    session = { completed_at: "2026-11-01T10:00:00Z" };
    expect(await move()).toBe(false);
    expect(started).toEqual([]);
  });

  test("older setup finished, or never started: nothing to move", async () => {
    old = { completed_at: "2026-10-01T10:00:00Z" };
    expect(await move()).toBe(false);
    old = null;
    expect(await move()).toBe(false);
    expect(started).toEqual([]);
  });

  test("a running restaurant is never put back into setup", async () => {
    active = true;
    expect(await move()).toBe(false);
    expect(started).toEqual([]);
  });
});
