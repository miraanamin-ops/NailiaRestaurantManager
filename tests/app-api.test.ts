// The mobile app's login (step 50, phase 0): the same rules as the website's
// /login (only allowed emails; wrong password, unknown email and not allowed all
// look the same; rate limits), a refresh that drops people no longer allowed,
// and every app route refusing a missing or bad token.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

type Session = { access_token: string; refresh_token: string; expires_at: number };
const good: Session = { access_token: "access-token-123456", refresh_token: "refresh-1", expires_at: 1_900_000_000 };

let allowed = true;
let limited = false;
let passwordOk = true;
let refreshOk = true;
let ownerForToken: { email: string; isBuilder: boolean; restaurantIds: string[]; allowed: boolean } | null = null;
const signOut = vi.fn(async () => ({ error: null }));

beforeEach(() => {
  vi.resetModules();
  allowed = true;
  limited = false;
  passwordOk = true;
  refreshOk = true;
  ownerForToken = { email: "sam@ember.test", isBuilder: false, restaurantIds: ["r1"], allowed: true };
  signOut.mockClear();
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "pk";
  vi.doMock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), overLimit: async () => limited }));
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    accessFor: async (email: string) => ({ email, isBuilder: false, restaurantIds: allowed ? ["r1"] : [], allowed }),
    ownerFromToken: async (token: string) => (token === good.access_token ? ownerForToken : null),
    tokenClient: () => ({
      auth: {
        signInWithPassword: async () => (passwordOk ? { data: { session: good, user: { email: "sam@ember.test" } }, error: null } : { data: { session: null }, error: { message: "Invalid login credentials" } }),
        refreshSession: async () => (refreshOk ? { data: { session: { ...good, refresh_token: "refresh-2" }, user: { email: "sam@ember.test" } }, error: null } : { data: { session: null, user: null }, error: { message: "expired" } }),
        signOut,
      },
    }),
  }));
});
afterEach(() => {
  vi.doUnmock("@/lib/rate-limit");
  vi.doUnmock("@/lib/auth");
});

const post = (body: unknown) => new NextRequest("https://app.test/api/app/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("app login", () => {
  test("an owner gets a session", async () => {
    const { POST } = await import("@/app/api/app/login/route");
    const res = await POST(post({ email: " Sam@Ember.test ", password: "correct horse" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(good);
  });

  test("wrong password and not allowed look the same, and a not-allowed session is ended", async () => {
    const { POST } = await import("@/app/api/app/login/route");
    passwordOk = false;
    const wrong = await POST(post({ email: "sam@ember.test", password: "nope" }));
    passwordOk = true;
    allowed = false;
    const notAllowed = await POST(post({ email: "stranger@x.test", password: "correct horse" }));
    expect([wrong.status, notAllowed.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await notAllowed.json());
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("rate-limited, and nonsense is refused before Supabase is asked", async () => {
    const { POST } = await import("@/app/api/app/login/route");
    expect((await POST(post({ email: "not-an-email", password: "x" }))).status).toBe(401);
    limited = true;
    const res = await POST(post({ email: "sam@ember.test", password: "correct horse" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "slow" });
  });
});

describe("app refresh", () => {
  test("a good refresh token gets a fresh session", async () => {
    const { POST } = await import("@/app/api/app/refresh/route");
    const res = await POST(post({ refresh_token: "refresh-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).refresh_token).toBe("refresh-2");
  });

  test("an expired token, or an owner no longer allowed, must log in again", async () => {
    const { POST } = await import("@/app/api/app/refresh/route");
    refreshOk = false;
    expect((await POST(post({ refresh_token: "old" }))).status).toBe(401);
    refreshOk = true;
    allowed = false;
    expect((await POST(post({ refresh_token: "refresh-1" }))).status).toBe(401);
  });
});

describe("app routes need a login", () => {
  const get = (auth?: string) => new NextRequest("https://app.test/api/app/me", { headers: auth ? { authorization: auth } : {} });

  test("no token, a bad token, or someone not allowed: 401", async () => {
    const { GET } = await import("@/app/api/app/me/route");
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get("Bearer not-a-real-token"))).status).toBe(401);
    ownerForToken = null;
    expect((await GET(get(`Bearer ${good.access_token}`))).status).toBe(401);
  });

  test("bearer tokens are read strictly", async () => {
    const { bearerToken } = await import("@/lib/app-api");
    const h = (v: string) => ({ headers: new Headers({ authorization: v }) });
    expect(bearerToken(h("Bearer abcdefghijkl"))).toBe("abcdefghijkl");
    expect(bearerToken(h("bearer abcdefghijkl"))).toBe("abcdefghijkl");
    expect(bearerToken(h("Basic abcdefghijkl"))).toBeNull();
    expect(bearerToken(h("Bearer short"))).toBeNull();
  });

  test("an owner only ever gets a restaurant they may see", async () => {
    const { restaurantFor } = await import("@/lib/app-api");
    const owner = { email: "sam@ember.test", isBuilder: false, restaurantIds: ["r1", "r2"], allowed: true };
    expect(restaurantFor(owner, "r2")).toBe("r2");
    expect(restaurantFor(owner, "someone-elses")).toBe("r1");
    expect(restaurantFor({ ...owner, restaurantIds: [] }, null)).toBeNull();
  });
});
