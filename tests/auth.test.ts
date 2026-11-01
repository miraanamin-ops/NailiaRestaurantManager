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
            { id: "r3", owner_email: "me+pilot0@builder.dev" },
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
    expect(await accessFor("OTHER@builder.dev")).toMatchObject({ allowed: true, isBuilder: true, restaurantIds: ["r1", "r2", "r3"] });
  });
  test("anyone else isn't allowed (and gets no login link)", async () => {
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("stranger@example.com")).toMatchObject({ allowed: false, restaurantIds: [] });
  });
});

describe("plus-addresses (name+tag@)", () => {
  test("a plus-address owner logs in as an owner of their restaurant only, even when it's the builder's own inbox", async () => {
    process.env.BUILDER_EMAIL = "me@builder.dev";
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("Me+Pilot0@builder.dev")).toMatchObject({ allowed: true, isBuilder: false, restaurantIds: ["r3"] });
    expect(await accessFor("me@builder.dev")).toMatchObject({ isBuilder: true });
  });
  test("another tag on the same inbox gets nothing", async () => {
    const { accessFor } = await import("@/lib/auth");
    expect(await accessFor("me+other@builder.dev")).toMatchObject({ allowed: false, restaurantIds: [] });
  });
  test("the email check accepts them", async () => {
    const { looksLikeEmail } = await import("@/lib/auth");
    expect(looksLikeEmail("miraan.amin+pilot0@gmail.com")).toBe(true);
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
