// A smoke test against the REAL dev database (dinerai-dev), for what the in-memory
// stand-in used by npm test can't prove (security review T1): the real tables,
// columns, unique indexes and the atomic claims. No Claude, no email, no Google:
// a fresh test restaurant (is_test and demo: nothing it does reaches anyone real)
// gets a customer who signs up, confirms and redeems the welcome reward; the reward
// can only be claimed once; the rate limiter and the AI spend check work on the real
// tables. The restaurant is deleted at the end.
//
// Run by hand:  node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/smoke-dev.e2e.ts
// In GitHub: Actions > Dev database smoke test (needs the DEV_SUPABASE_URL and
// DEV_SUPABASE_SECRET_KEY repository secrets). Never against live: the live guard refuses.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const LIVE_REF = "gfrkcvcqmdhdhpcytlkc";

describe("dev database smoke test", () => {
  let restaurantId = "";

  beforeAll(async () => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY to the dev project");
    if (process.env.SUPABASE_URL.includes(LIVE_REF)) throw new Error("This smoke test never runs against the live database");
    process.env.EMAIL_REDIRECT = "true";
    const { startTestSite } = await import("@/lib/onboarding/dina/test-sites");
    restaurantId = await startTestSite();
  });

  afterAll(async () => {
    if (!restaurantId) return;
    const { deleteTestSite } = await import("@/lib/onboarding/dina/test-sites");
    await deleteTestSite(restaurantId);
  });

  test("a customer signs up, confirms, and the welcome reward is claimed exactly once", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { confirmEmail, redeemReward, signUp } = await import("@/lib/signups");
    const restaurant = (await getSupabase().from("restaurants").select("*").eq("id", restaurantId).single()).data!;

    const signed = await signUp(restaurant, { firstName: "Smoke", email: `smoke-${Date.now()}@example.com`, birthday: null, consent: true, userAgent: "smoke test" });
    expect(signed.plan).toBe("new");
    expect(signed.customer.confirm_token).toBeTruthy();

    const confirmed = await confirmEmail(restaurant, signed.customer.confirm_token!);
    expect(confirmed.state).toBe("confirmed");
    if (confirmed.state !== "confirmed") return;
    expect(confirmed.customer.marketing_opt_in).toBe(true);
    expect(confirmed.reward?.token).toBeTruthy();

    // Two taps at the same moment: only one starts the 10-minute window.
    const [a, b] = await Promise.all([redeemReward(confirmed.reward!.token), redeemReward(confirmed.reward!.token)]);
    expect([a.justRedeemed, b.justRedeemed].filter(Boolean)).toHaveLength(1);
  });

  test("the rate limiter records and counts on the real table", async () => {
    const { limitKey, overLimit } = await import("@/lib/rate-limit");
    const limit = [{ key: limitKey("smoke", restaurantId, String(Date.now())), max: 2, windowMs: 60_000 }];
    expect(await overLimit(limit)).toBe(false);
    expect(await overLimit(limit)).toBe(false);
    expect(await overLimit(limit)).toBe(true);
  });

  test("the AI spend check reads the real ai_usage table", async () => {
    const { chatBudget } = await import("@/lib/ai-budget");
    expect(await chatBudget(restaurantId)).toEqual({ ok: true, warn: false });
  });
});
