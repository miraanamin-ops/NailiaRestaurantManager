// The sign-up form (/start): pilot invite codes skip Stripe, an email that already
// has a running restaurant only gets a login link (nothing attached to it), and the
// live site stays invite-only until PUBLIC_SIGNUP=true.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { planSignup } from "@/lib/billing/signup-plan";
import { fakeAfter, flushAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";

const ACTIVE_ID = "33333333-3333-4333-8333-333333333333";
const emailLoginLink = vi.fn<(email: string, next: string, base: string) => Promise<null | "wait" | "send">>(async () => null);
const createTrialCheckout = vi.fn<(r: { id: string }, base: string) => Promise<string>>(async () => "https://checkout.stripe.test/c/pay");
const logAction = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
const startSignupSession = vi.fn<(email: string, restaurantId: string) => Promise<{ ok: true } | { ok: false; reason: "not_configured" | "existing_user" | "failed" }>>(
  async () => ({ ok: true }),
);
let db: ReturnType<typeof memoryDb>;

function seed(extra: Record<string, unknown>[] = []) {
  db = memoryDb(
    {
      restaurants: [...extra],
      onboarding: [],
      onboarding_sessions: [],
      pilot_invites: [
        { code: "PILOT-ONE", max_uses: 1, used_count: 0, active: true, expires_at: null },
        { code: "OLD", max_uses: 5, used_count: 0, active: true, expires_at: "2020-01-01T00:00:00Z" },
      ],
    },
    {
      // What claim_pilot_invite does in the database (025_billing.sql).
      rpc: {
        claim_pilot_invite: ({ p_code }, tables) => {
          const row = tables.pilot_invites.find((i) => i.code === String(p_code).trim().toUpperCase());
          const ok =
            row && row.active && (row.used_count as number) < (row.max_uses as number) && (!row.expires_at || Date.parse(String(row.expires_at)) > Date.now());
          if (ok) row.used_count = (row.used_count as number) + 1;
          return Boolean(ok);
        },
      },
    },
  );
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_PRICE_ID = "price_123";
  process.env.VERCEL_ENV = "preview";
  // The paid sign-up (the Stripe free trial), as before. "no paywall" below turns it off.
  process.env.ONBOARDING_REQUIRES_PAYMENT = "true";
  delete process.env.PUBLIC_SIGNUP;
  delete process.env.TURNSTILE_SECRET_KEY;
  emailLoginLink.mockClear();
  createTrialCheckout.mockClear();
  logAction.mockClear();
  startSignupSession.mockClear();
  seed();
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), emailLoginLink, startSignupSession }));
  vi.doMock("@/lib/billing/checkout", () => ({ createTrialCheckout }));
  vi.doMock("@/lib/audit", () => ({ logAction }));
  vi.doMock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), overLimit: async () => false }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
  vi.doMock("next/headers", () => ({ headers: async () => new Headers({ host: "app.test", "x-forwarded-for": "203.0.113.9" }) }));
  vi.doMock("next/navigation", () => ({
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/auth", "@/lib/billing/checkout", "@/lib/audit", "@/lib/rate-limit", "next/server", "next/headers", "next/navigation"]) vi.doUnmock(m);
  delete process.env.VERCEL_ENV;
  delete process.env.ONBOARDING_REQUIRES_PAYMENT;
  vi.resetModules();
});

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

async function submit(fields: Record<string, string>) {
  const { startSignup } = await import("@/app/start/actions");
  const form = new FormData();
  const all = { owner_name: "Aisha Khan", email: "aisha@grill.test", restaurant_name: "Ember Grill", whatsapp: "07700 900123", terms: "yes", ...fields };
  for (const [k, v] of Object.entries(all)) if (v !== "") form.set(k, v);
  try {
    await startSignup(form);
  } catch (e) {
    await flushAfter();
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  throw new Error("no redirect");
}

describe("pilot invite codes", () => {
  test("a valid code skips Stripe: the code is stored and a login link goes straight into onboarding", async () => {
    const to = await submit({ invite: "pilot-one" });
    expect(to).toBe("/start?sent=1");
    expect(createTrialCheckout).not.toHaveBeenCalled();
    const r = db.tables.restaurants[0];
    expect(r).toMatchObject({ pilot_invite_code: "PILOT-ONE", active: false, terms_version: expect.any(String) });
    expect(r.terms_accepted_at).toBeTruthy();
    expect(emailLoginLink).toHaveBeenCalledWith("aisha@grill.test", `/onboarding?r=${r.id}`, expect.any(String));
    expect(db.tables.pilot_invites[0].used_count).toBe(1);
  });

  test("a used-up, expired or unknown code is refused and nothing is made", async () => {
    await submit({ invite: "PILOT-ONE", email: "first@grill.test" });
    for (const code of ["PILOT-ONE", "OLD", "NOPE"]) {
      expect(await submit({ invite: code, email: `x-${code.toLowerCase()}@grill.test`, restaurant_name: `Grill ${code}` })).toBe(`/start?error=invite&invite=${code}`);
    }
    expect(db.tables.restaurants).toHaveLength(1);
  });

  test("works on the live site while sign-up is invite-only", async () => {
    process.env.VERCEL_ENV = "production";
    expect(await submit({ invite: "PILOT-ONE" })).toBe("/start?sent=1");
    expect(db.tables.restaurants[0].pilot_invite_code).toBe("PILOT-ONE");
  });

  test("codes are tidied: spaces and case don't matter, odd characters are refused", async () => {
    const { cleanInviteCode } = await import("@/lib/billing/invites");
    expect(cleanInviteCode(" pilot-one ")).toBe("PILOT-ONE");
    expect(cleanInviteCode("PI LOT")).toBe("PILOT");
    expect(cleanInviteCode("drop table;")).toBeNull();
    expect(cleanInviteCode("")).toBeNull();
  });
});

describe("an email that already has a running restaurant", () => {
  const running = { id: ACTIVE_ID, name: "Ember Grill", owner_email: "Aisha@Grill.test", active: true, billing_exempt: true, created_at: "2026-01-01T00:00:00Z" };

  test("just gets a login link: no Stripe customer, invite or terms attached", async () => {
    seed([{ ...running }]);
    expect(await submit({ invite: "PILOT-ONE" })).toBe("/start?sent=1");
    expect(emailLoginLink).toHaveBeenCalledWith("aisha@grill.test", "/", expect.any(String));
    expect(createTrialCheckout).not.toHaveBeenCalled();
    expect(db.tables.restaurants).toEqual([running]);
    expect(db.tables.pilot_invites[0].used_count).toBe(0);
    expect(logAction).not.toHaveBeenCalled();
  });

  test("the same on the live site while invite-only", async () => {
    process.env.VERCEL_ENV = "production";
    seed([{ ...running }]);
    expect(await submit({})).toBe("/start?sent=1");
    expect(db.tables.restaurants).toEqual([running]);
  });
});

describe("paid sign-up", () => {
  test("on the live site without PUBLIC_SIGNUP it's invite-only, even with Stripe keys", async () => {
    process.env.VERCEL_ENV = "production";
    expect(await submit({})).toBe("/start?error=invite_only");
    expect(db.tables.restaurants).toHaveLength(0);
    expect(createTrialCheckout).not.toHaveBeenCalled();
  });

  test("with PUBLIC_SIGNUP=true: an inactive restaurant is made and the owner goes to Stripe Checkout", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PUBLIC_SIGNUP = "true";
    expect(await submit({})).toBe("https://checkout.stripe.test/c/pay");
    const r = db.tables.restaurants[0];
    expect(r).toMatchObject({ name: "Ember Grill", owner_email: "aisha@grill.test", active: false });
    expect(r.pilot_invite_code ?? null).toBeNull();
    expect(r.terms_accepted_at).toBeTruthy();
    expect(createTrialCheckout).toHaveBeenCalledWith(expect.objectContaining({ id: r.id }), expect.any(String));
    expect(emailLoginLink).not.toHaveBeenCalled();
  });

  test("coming back after cancelling Checkout carries on with the same restaurant", async () => {
    await submit({});
    await submit({});
    expect(db.tables.restaurants).toHaveLength(1);
    expect(createTrialCheckout).toHaveBeenCalledTimes(2);
  });

  test("without Stripe set up, only invite codes work", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(await submit({})).toBe("/start?error=invite_only");
  });

  test("the terms box must be ticked", async () => {
    expect(await submit({ terms: "" })).toBe("/start?error=terms");
    expect(db.tables.restaurants).toHaveLength(0);
  });
});

describe("no paywall (ONBOARDING_REQUIRES_PAYMENT off, the default)", () => {
  beforeEach(() => {
    delete process.env.ONBOARDING_REQUIRES_PAYMENT;
  });

  test("an invite code is required everywhere, and Stripe is never opened", async () => {
    process.env.PUBLIC_SIGNUP = "true";
    for (const env of ["preview", "production"]) {
      process.env.VERCEL_ENV = env;
      expect(await submit({})).toBe("/start?error=invite_only");
    }
    expect(db.tables.restaurants).toHaveLength(0);
    expect(createTrialCheckout).not.toHaveBeenCalled();
  });

  test("a brand-new owner is logged straight in and lands in the chat with Dina; onboarding has started; the login email still goes", async () => {
    const to = await submit({ invite: "PILOT-ONE" });
    const r = db.tables.restaurants[0];
    expect(to).toBe(`/onboarding/chat?r=${r.id}`);
    expect(startSignupSession).toHaveBeenCalledWith("aisha@grill.test", r.id);
    expect(createTrialCheckout).not.toHaveBeenCalled();
    expect(r).toMatchObject({ pilot_invite_code: "PILOT-ONE", active: false, terms_version: expect.any(String), privacy_version: expect.any(String), dpa_version: expect.any(String) });
    expect(db.tables.onboarding_sessions).toEqual([expect.objectContaining({ restaurant_id: r.id, current_step: "hello", channel_last_used: "web" })]);
    expect(db.tables.onboarding[0]).toMatchObject({ restaurant_id: r.id, pending_whatsapp: "whatsapp:+447700900123" });
    expect(emailLoginLink).toHaveBeenCalledWith("aisha@grill.test", `/onboarding/chat?r=${r.id}`, expect.any(String));
  });

  test("if Supabase already had a login for that email, no automatic login: a login link instead", async () => {
    startSignupSession.mockResolvedValueOnce({ ok: false, reason: "existing_user" });
    const to = await submit({ invite: "PILOT-ONE" });
    const r = db.tables.restaurants[0];
    expect(to).toBe("/start?sent=1");
    expect(emailLoginLink).toHaveBeenCalledWith("aisha@grill.test", `/onboarding/chat?r=${r.id}`, expect.any(String));
    expect(db.tables.onboarding_sessions).toHaveLength(1);
  });

  test("an email with an earlier unfinished sign-up is never logged in automatically", async () => {
    seed([{ id: ACTIVE_ID, name: "Ember Grill", owner_email: "aisha@grill.test", active: false, created_at: new Date().toISOString() }]);
    db.tables.onboarding.push({ restaurant_id: ACTIVE_ID });
    expect(await submit({ invite: "PILOT-ONE" })).toBe("/start?sent=1");
    expect(startSignupSession).not.toHaveBeenCalled();
    expect(emailLoginLink).toHaveBeenCalledWith("aisha@grill.test", `/onboarding/chat?r=${ACTIVE_ID}`, expect.any(String));
  });

  test("an email with a running restaurant only gets a login link, as before", async () => {
    seed([{ id: ACTIVE_ID, name: "Ember Grill", owner_email: "aisha@grill.test", active: true, billing_exempt: true, created_at: "2026-01-01T00:00:00Z" }]);
    expect(await submit({ invite: "PILOT-ONE" })).toBe("/start?sent=1");
    expect(startSignupSession).not.toHaveBeenCalled();
    expect(db.tables.onboarding_sessions).toHaveLength(0);
  });
});

describe("planSignup", () => {
  const row = (fields: Record<string, unknown>) => ({ id: "r1", name: "Ember Grill", active: false, created_at: new Date().toISOString(), ...fields });
  test("paid (or pilot) but not finished setting up: login link into onboarding", () => {
    expect(planSignup([row({ subscription_status: "trialing" })], "Ember Grill")).toEqual({ kind: "login", next: "/onboarding?r=r1" });
    expect(planSignup([row({ pilot_invite_code: "P" })], "Other name")).toEqual({ kind: "login", next: "/onboarding?r=r1" });
  });
  test("an unpaid sign-up from today with the same name carries on; a different name is new", () => {
    expect(planSignup([row({})], "ember grill ")).toEqual({ kind: "continue", restaurantId: "r1" });
    expect(planSignup([row({})], "Another Place")).toEqual({ kind: "new" });
  });
  test("old unpaid sign-ups are left alone", () => {
    expect(planSignup([row({ created_at: "2026-01-01T00:00:00Z" })], "Ember Grill", Date.parse("2026-10-14T00:00:00Z"))).toEqual({ kind: "new" });
  });
});
