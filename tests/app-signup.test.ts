// Signing up and setting up in the app (step 50, phase 4): the website's sign-up
// rules through /api/app/signup (tokens instead of cookies), Sign in with Apple /
// Google, where /api/app/me sends each restaurant (pay, setup, ready), the setup chat
// with Dina on the website's engine, and Delete account through the close-account flow.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { appLimits, APP_SIGNUPS_PER_DAY, formProblem } from "@/lib/signup/signup";
import { memoryDb } from "./support/memory-db";

const RUNNING = "33333333-3333-4333-8333-333333333333";
const session = { access_token: "access-token-123456", refresh_token: "refresh-1", expires_at: 1_900_000_000 };
const createPasswordAccount = vi.fn(async (_e: string, _p: string, _r: string, _o?: { logIn?: boolean }) => ({ ok: true as const }));
const signInWithPassword = vi.fn(async ({ password }: { email: string; password: string }) =>
  password === "correct horse" ? { data: { session }, error: null } : { data: { session: null }, error: { message: "Invalid login credentials" } },
);
let social: { email: string; provider: string; name: string | null } | null = null;
let limited = false;
let db: ReturnType<typeof memoryDb>;

function seed() {
  db = memoryDb(
    {
      restaurants: [{ id: RUNNING, name: "Ember Grill", owner_email: "busy@grill.test", active: true, created_at: "2026-01-01T00:00:00Z", billing_exempt: true }],
      onboarding: [],
      onboarding_sessions: [],
      onboarding_steps: [],
      pilot_invites: [{ code: "PILOT-APP", max_uses: 5, used_count: 0, active: true, expires_at: null }],
    },
    {
      rpc: {
        claim_pilot_invite: ({ p_code }, tables) => {
          const row = tables.pilot_invites.find((i) => i.code === String(p_code).trim().toUpperCase());
          if (!row || (row.used_count as number) >= (row.max_uses as number)) return false;
          row.used_count = (row.used_count as number) + 1;
          return true;
        },
      },
    },
  );
}

beforeEach(() => {
  vi.resetModules();
  seed();
  social = null;
  limited = false;
  createPasswordAccount.mockClear();
  signInWithPassword.mockClear();
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "pk";
  process.env.VERCEL_ENV = "preview";
  // The tests set these switches themselves; Vercel's build has its own values.
  for (const k of ["ONBOARDING_REQUIRES_PAYMENT", "REVENUECAT_WEBHOOK_SECRET", "PUBLIC_SIGNUP", "STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "TURNSTILE_SECRET_KEY"]) delete process.env[k];
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/audit", () => ({ logAction: async () => {} }));
  vi.doMock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), overLimit: async () => limited }));
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    authConfigured: () => true,
    createPasswordAccount,
    verifiedUserFromToken: async (t: string) => (t === "social-token-1234567" ? social : null),
    tokenClient: () => ({ auth: { signInWithPassword } }),
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/audit", "@/lib/rate-limit", "@/lib/auth", "@/lib/onboarding/dina/chat", "@/lib/onboarding/dina/chat-action", "@/lib/closure"]) vi.doUnmock(m);
  delete process.env.VERCEL_ENV;
});

const form = { ownerName: "Aisha Khan", restaurantName: "Rose & Thyme", email: "miraan.amin+app1@gmail.com", password: "correct horse", whatsapp: "07700 900123", terms: true };
const signup = async (body: object, token?: string) => {
  const { POST } = await import("@/app/api/app/signup/route");
  const res = await POST(new NextRequest("https://app.test/api/app/signup", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const made = () => (db.tables.restaurants as Record<string, unknown>[]).filter((r) => r.id !== RUNNING);

describe("the shared sign-up rules", () => {
  test("the form's own checks", () => {
    const ok = { ...form, invite: "" };
    expect(formProblem(ok)).toBeNull();
    expect(formProblem({ ...ok, terms: false })).toEqual({ kind: "error", code: "terms" });
    expect(formProblem({ ...ok, password: "short" })).toMatchObject({ code: "password_short" });
    expect(formProblem({ ...ok, whatsapp: "12" })).toEqual({ kind: "error", code: "whatsapp" });
    // Apple / Google: no password, but only the email they vouched for.
    expect(formProblem({ ...ok, password: null, verifiedEmail: "miraan.amin+app1@gmail.com" })).toBeNull();
    expect(formProblem({ ...ok, password: null, verifiedEmail: "someone@else.test" })).toEqual({ kind: "error", code: "email" });
  });

  test("the app has no Cloudflare check, so it has the same limits per connection, per email, and a daily cap", () => {
    const keys = appLimits("203.0.113.9", "a@b.test").map((l) => l.max);
    expect(keys).toEqual([5, 20, 5, APP_SIGNUPS_PER_DAY]);
  });
});

describe("signing up in the app", () => {
  test("with an invite code: straight into setup, logged in with tokens, the login made without cookies", async () => {
    const { status, json } = await signup({ ...form, invite: "pilot-app" });
    expect(status).toBe(200);
    expect(json).toMatchObject({ next: "setup", tokens: { access_token: session.access_token } });
    expect(made()).toHaveLength(1);
    expect(made()[0]).toMatchObject({ name: "Rose & Thyme", owner_email: "miraan.amin+app1@gmail.com", pilot_invite_code: "PILOT-APP" });
    expect(json.restaurantId).toBe(made()[0].id);
    expect(createPasswordAccount).toHaveBeenCalledWith("miraan.amin+app1@gmail.com", "correct horse", made()[0].id, { logIn: false });
    expect(db.tables.onboarding_sessions).toHaveLength(1);
  });

  test("no invite while paying is off: invite-only, nothing made", async () => {
    expect(await signup(form)).toEqual({ status: 400, json: { error: "invite_only" } });
    expect(made()).toEqual([]);
  });

  test("paying open in the app (RevenueCat set up): made, logged in, and sent to start the free month", async () => {
    process.env.ONBOARDING_REQUIRES_PAYMENT = "true";
    process.env.REVENUECAT_WEBHOOK_SECRET = "s";
    const { json } = await signup(form);
    expect(json).toMatchObject({ next: "pay", tokens: { access_token: session.access_token } });
    expect(made()[0]).toMatchObject({ terms_version: expect.any(String) });
    expect(made()[0].pilot_invite_code ?? null).toBeNull();
    expect(db.tables.onboarding_sessions).toHaveLength(0); // setup starts once the free month does
    // On the live site it waits for PUBLIC_SIGNUP, like the website.
    process.env.VERCEL_ENV = "production";
    seed();
    expect((await signup(form)).json).toEqual({ error: "invite_only" });
  });

  test("an email with a running restaurant is told to log in; a wrong password on an existing login too", async () => {
    expect(await signup({ ...form, email: "busy@grill.test", invite: "PILOT-APP" })).toEqual({ status: 409, json: { error: "exists" } });
    const { status } = await signup({ ...form, password: "not the one", invite: "PILOT-APP" });
    expect(status).toBe(409); // a brand-new email whose login already existed elsewhere: only its own password
  });

  test("form problems and the rate limit come back as the website's codes", async () => {
    expect((await signup({ ...form, terms: false })).json).toEqual({ error: "terms" });
    expect((await signup({ ...form, invite: "!!" })).json).toEqual({ error: "invite" });
    expect((await signup({ ...form, invite: "PILOT-APP", referral: "NOBODY-1" })).json).toEqual({ error: "referral" });
    limited = true;
    expect(await signup({ ...form, invite: "PILOT-APP" })).toEqual({ status: 429, json: { error: "slow" } });
  });

  test("after Sign in with Apple: the vouched-for email, no password, and the app keeps its tokens", async () => {
    social = { email: "relay123@privaterelay.appleid.com", provider: "apple", name: "Aisha Khan" };
    const { status, json } = await signup({ ...form, email: "typed@else.test", password: "", invite: "PILOT-APP" }, "social-token-1234567");
    expect(status).toBe(200);
    expect(json).toEqual({ restaurantId: made()[0].id, next: "setup" });
    expect(made()[0].owner_email).toBe("relay123@privaterelay.appleid.com");
    expect(createPasswordAccount).not.toHaveBeenCalled();
    // A token that isn't an Apple / Google login is refused.
    expect((await signup(form, "some-other-token-123")).status).toBe(401);
  });
});

describe("Sign in with Apple / Google", () => {
  const login = async (body: object, user: { email: string; user_metadata?: object } | null, allowed: boolean) => {
    vi.doMock("@/lib/auth", async (orig) => ({
      ...(await orig<object>()),
      authConfigured: () => true,
      accessFor: async (email: string) => ({ email, isBuilder: false, restaurantIds: allowed ? [RUNNING] : [], allowed }),
      tokenClient: () => ({ auth: { signInWithIdToken: async () => (user ? { data: { session, user }, error: null } : { data: { session: null, user: null }, error: { message: "bad token" } }) } }),
    }));
    const { POST } = await import("@/app/api/app/login/social/route");
    const res = await POST(new NextRequest("https://app.test/api/app/login/social", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    return { status: res.status, json: await res.json() };
  };

  test("an owner is logged in; someone new goes on to sign up with that email; a bad token or provider is refused", async () => {
    expect(await login({ provider: "apple", idToken: "x.y.z" }, { email: "Busy@Grill.test" }, true)).toEqual({ status: 200, json: { known: true, tokens: expect.objectContaining({ access_token: session.access_token }) } });
    vi.resetModules();
    expect((await login({ provider: "google", idToken: "x.y.z" }, { email: "new@cafe.test", user_metadata: { full_name: "Sam Lee" } }, false)).json).toMatchObject({ known: false, email: "new@cafe.test", name: "Sam Lee" });
    vi.resetModules();
    expect((await login({ provider: "apple", idToken: "x.y.z", name: "Aisha Khan" }, { email: "relay@privaterelay.appleid.com" }, false)).json).toMatchObject({ name: "Aisha Khan" });
    vi.resetModules();
    expect((await login({ provider: "apple", idToken: "bad" }, null, false)).status).toBe(401);
    expect((await login({ provider: "facebook", idToken: "x" }, null, false)).status).toBe(400);
  });
});

// ---------- Logged-in app routes ----------

const TOKEN = "owner-token-1234567";
const A = "a0000000-0000-4000-8000-00000000000a";
function asOwner(owner: { isBuilder?: boolean; restaurantIds?: string[] } = {}) {
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    ownerFromToken: async (t: string) => (t === TOKEN ? { email: "sam@rose.test", isBuilder: owner.isBuilder ?? false, restaurantIds: owner.restaurantIds ?? [A], allowed: true } : null),
  }));
}
const call = (url: string, method = "GET", body?: object) =>
  new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });

describe("where the app sends each restaurant", () => {
  test("/api/app/me: pay, setup or ready", async () => {
    const B = "b0000000-0000-4000-8000-00000000000b";
    const C = "c0000000-0000-4000-8000-00000000000c";
    db.tables.restaurants.push(
      { id: A, name: "Unpaid", owner_name: "Sam Lee", active: false, created_at: "2026-11-01" },
      { id: B, name: "In setup", active: false, store_status: "trialing", store_platform: "app_store", store_period_end: "2026-12-12T00:00:00Z", created_at: "2026-11-02" },
      { id: C, name: "Running", active: true, billing_exempt: true, created_at: "2026-11-03" },
    );
    db.tables.onboarding.push({ restaurant_id: A, completed_at: null }, { restaurant_id: B, completed_at: null }, { restaurant_id: C, completed_at: "2026-11-04" });
    asOwner({ restaurantIds: [A, B, C] });
    const { GET } = await import("@/app/api/app/me/route");
    const json = await (await GET(call("https://app.test/api/app/me"))).json();
    expect(json.firstName).toBe("Sam");
    expect(json.restaurants.map((r: { stage: string }) => r.stage)).toEqual(["pay", "setup", "ready"]);
    expect(json.restaurants[1].billing).toMatchObject({ standing: "trialing", viaStore: true, platform: "app_store", renewsOrEnds: "2026-12-12T00:00:00Z" });
  });
});

describe("setup with Dina in the app", () => {
  test("loads the chat and runs a turn on the website's engine; only the owner's own restaurant", async () => {
    asOwner();
    vi.doMock("@/lib/onboarding/dina/chat", () => ({ loadChat: async () => ({ restaurantName: "Rose & Thyme", messages: [], chosen: {}, progress: { steps: [], position: 1, total: 9 }, skippable: false, needsStart: true }) }));
    vi.doMock("@/lib/onboarding/dina/chat-action", async (orig) => ({
      ...(await orig<object>()),
      overTurnLimit: async () => false,
      runChatAction: async (_r: string, _a: unknown, send: (e: object) => void, opts: { gapMs?: number }) => {
        expect(opts.gapMs).toBe(0); // the app gets every message at once
        send({ type: "typing" });
        send({ type: "message", message: { id: "m1", role: "dina", text: "Hi Sam!" } });
        send({ type: "message", message: { id: "m2", role: "dina", text: "What's the restaurant called?" } });
        send({ type: "state", progress: { position: 1, total: 9 }, skippable: true });
        send({ type: "done" });
      },
    }));
    const route = await import("@/app/api/app/setup/route");
    expect(await (await route.GET(call(`https://app.test/api/app/setup?r=${A}`))).json()).toMatchObject({ restaurantId: A, needsStart: true });
    const turn = await route.POST(call("https://app.test/api/app/setup", "POST", { r: A, action: { kind: "start" } }));
    expect(await turn.json()).toEqual({ messages: [{ id: "m1", role: "dina", text: "Hi Sam!" }, { id: "m2", role: "dina", text: "What's the restaurant called?" }], progress: { position: 1, total: 9 }, skippable: true, error: null });
    const other = await route.POST(call("https://app.test/api/app/setup", "POST", { r: "b0000000-0000-4000-8000-00000000000b", action: { kind: "start" } }));
    expect(other.status).toBe(403);
    expect((await route.POST(call("https://app.test/api/app/setup", "POST", { r: A, action: { kind: "nonsense" } }))).status).toBe(400);
  });
});

describe("Delete account in the app", () => {
  const steps: string[] = [];
  beforeEach(() => {
    steps.length = 0;
    db.tables.restaurants.push({ id: A, name: "Rose & Thyme", is_demo: false, store_status: "trialing", created_at: "2026-11-01" });
    vi.doMock("@/lib/closure", async (orig) => {
      const real = await orig<typeof import("@/lib/closure")>();
      return {
        ...real,
        openClosureFor: async () => null,
        requestClosure: async (id: string, typed: string, _who: string, by: string) => {
          if (typed !== "Rose & Thyme") throw new real.ClosureError("Nothing changed: type the restaurant's name exactly (Rose & Thyme).");
          steps.push(`request ${id} by ${by}`);
          return { id: "c1" };
        },
        confirmClosure: async (input: { skipCoolingOff: boolean; by?: string }) => {
          steps.push(`confirm skip=${input.skipCoolingOff} by ${input.by}`);
          return { closesAt: new Date("2026-11-13T10:00:00Z") };
        },
      };
    });
  });

  test("the owner types the name: asked and confirmed, with 24 hours to change their mind and a note to cancel the store subscription", async () => {
    asOwner();
    const { POST } = await import("@/app/api/app/account/delete/route");
    expect(await (await POST(call("https://app.test/api/app/account/delete", "POST", { r: A, typedName: "rose" }))).json()).toMatchObject({ refused: expect.stringMatching(/exactly/) });
    const json = await (await POST(call("https://app.test/api/app/account/delete", "POST", { r: A, typedName: "Rose & Thyme" }))).json();
    expect(steps).toEqual([`request ${A} by owner`, "confirm skip=false by owner"]);
    expect(json).toMatchObject({ closesAt: "2026-11-13T10:00:00.000Z", now: false, storeNote: expect.stringMatching(/isn't cancelled/) });
  });

  test("the builder can't close a real restaurant from the app", async () => {
    asOwner({ isBuilder: true });
    const { POST } = await import("@/app/api/app/account/delete/route");
    expect((await POST(call("https://app.test/api/app/account/delete", "POST", { r: A, typedName: "Rose & Thyme" }))).status).toBe(403);
    expect(steps).toEqual([]);
  });
});
