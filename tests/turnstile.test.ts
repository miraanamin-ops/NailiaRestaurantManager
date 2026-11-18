import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The robot check on sign-up forms fails closed on the live site (review S3):
// a missing key or Cloudflare being down must never quietly switch it off there.
describe("Turnstile", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.VERCEL_ENV;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  test("no key on the live site: refused", async () => {
    process.env.VERCEL_ENV = "production";
    const { verifyTurnstile } = await import("@/lib/turnstile");
    expect(await verifyTurnstile("token", "1.2.3.4")).toEqual({ ok: false, error: "not-configured" });
  });

  test("no key on a preview or locally: skipped, so testing still works", async () => {
    process.env.VERCEL_ENV = "preview";
    const { verifyTurnstile } = await import("@/lib/turnstile");
    expect(await verifyTurnstile("", "1.2.3.4")).toEqual({ ok: true, skipped: true });
  });

  test("Cloudflare unreachable on the live site: refused", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { verifyTurnstile } = await import("@/lib/turnstile");
    expect(await verifyTurnstile("token", "1.2.3.4")).toEqual({ ok: false, error: "unavailable" });
  });

  test("Cloudflare unreachable on a preview: let through", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { verifyTurnstile } = await import("@/lib/turnstile");
    expect(await verifyTurnstile("token", "1.2.3.4")).toEqual({ ok: true, skipped: true });
  });

  test("a real answer from Cloudflare is used as it is", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })));
    const { verifyTurnstile } = await import("@/lib/turnstile");
    expect(await verifyTurnstile("token", "1.2.3.4")).toEqual({ ok: false, error: "invalid-input-response" });
  });
});
