// Login: who's allowed in, where they're sent afterwards, and report links expiring.
import { afterEach, describe, expect, test, vi } from "vitest";
import { reportExpired } from "@/lib/report/types";

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        returns: async () => ({
          data: [
            { id: "r1", owner_email: "Owner@Example.com" },
            { id: "r2", owner_email: "someone@else.com" },
          ],
          error: null,
        }),
      }),
    }),
  }),
}));

afterEach(() => {
  delete process.env.BUILDER_EMAIL;
});

describe("who can log in", () => {
  test("a restaurant's owner email sees only that restaurant (any capitals)", async () => {
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("owner@example.com")).toMatchObject({ allowed: true, isBuilder: false, restaurantIds: ["r1"] });
  });
  test("the builder sees every restaurant", async () => {
    process.env.BUILDER_EMAIL = "me@builder.dev, other@builder.dev";
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("OTHER@builder.dev")).toMatchObject({ allowed: true, isBuilder: true, restaurantIds: ["r1", "r2"] });
  });
  test("anyone else isn't allowed (and gets no login link)", async () => {
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("stranger@example.com")).toMatchObject({ allowed: false, restaurantIds: [] });
  });
});

describe("after logging in", () => {
  test("only ever goes to a page on this site", async () => {
    const { safeNext } = await import("@/lib/auth");
    expect(safeNext("/report/abc")).toBe("/report/abc");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("report links", () => {
  test("expire after their date; older reports without a date don't", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(reportExpired("2026-11-09T12:00:00Z", now)).toBe(true);
    expect(reportExpired("2026-11-11T12:00:00Z", now)).toBe(false);
    expect(reportExpired(null, now)).toBe(false);
  });
});
