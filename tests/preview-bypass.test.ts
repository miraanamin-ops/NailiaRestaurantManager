// Calls into a protected preview (Twilio's pictures, our worker start) carry
// Vercel's bypass key; production and local copies never do.
import { expect, test } from "vitest";
import { bypassHeaders, bypassUrl } from "@/lib/preview-bypass";

test("on a preview with the key: a header for our own calls, a query for Twilio's pictures", () => {
  const env = { VERCEL_ENV: "preview", VERCEL_AUTOMATION_BYPASS_SECRET: "abc 123" };
  expect(bypassHeaders(env)).toEqual({ "x-vercel-protection-bypass": "abc 123" });
  expect(bypassUrl("https://p.vercel.app/onboarding/google/phone-1.png", env)).toBe("https://p.vercel.app/onboarding/google/phone-1.png?x-vercel-protection-bypass=abc%20123");
  expect(bypassUrl("https://p.vercel.app/x?s=1", env)).toBe("https://p.vercel.app/x?s=1&x-vercel-protection-bypass=abc%20123");
});

test("production, a local copy, or no key: nothing added", () => {
  for (const env of [{ VERCEL_ENV: "production", VERCEL_AUTOMATION_BYPASS_SECRET: "abc" }, {}, { VERCEL_ENV: "preview" }]) {
    expect(bypassHeaders(env)).toEqual({});
    expect(bypassUrl("https://app.test/a.png", env)).toBe("https://app.test/a.png");
  }
});
