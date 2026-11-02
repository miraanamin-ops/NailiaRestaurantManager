// Logged in straight after sign-up (lib/auth.ts, lib/auth-rules.ts): the same
// Supabase login a login link gives, made without the email, only for a login
// account Supabase made just now, and limited to the one restaurant it signed up.
// An ordinary login (from an emailed link) keeps its usual access.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isFreshUser, scopeToSignup, sessionIdFromToken } from "@/lib/auth-rules";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const NOW = Date.parse("2026-10-28T12:00:00Z");

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (sessionId: string | null) => `${b64url({ alg: "HS256" })}.${b64url(sessionId ? { sub: "u1", session_id: sessionId } : { sub: "u1" })}.sig`;

describe("the rules", () => {
  test("the session id is read from a Supabase access token", () => {
    expect(sessionIdFromToken(token("5f0c-session"))).toBe("5f0c-session");
    expect(sessionIdFromToken(token(null))).toBeNull();
    expect(sessionIdFromToken("not a token")).toBeNull();
    expect(sessionIdFromToken("a.%%%.c")).toBeNull();
  });

  test("a sign-up login sees only its own restaurant, and is never the builder", () => {
    const owner = { email: "x@grill.test", isBuilder: false, restaurantIds: [A, B], allowed: true };
    expect(scopeToSignup(owner, A)).toEqual({ ...owner, restaurantIds: [A] });
    expect(scopeToSignup(owner, null)).toBe(owner);
    const builder = { ...owner, isBuilder: true };
    expect(scopeToSignup(builder, B)).toEqual({ ...owner, restaurantIds: [B] });
    // Its restaurant has since been given to another email: nothing.
    expect(scopeToSignup({ ...owner, restaurantIds: [B] }, A)).toMatchObject({ restaurantIds: [], allowed: false });
  });

  test("only a login account made just now, that has never logged in, counts as new", () => {
    expect(isFreshUser({ created_at: "2026-10-28T11:59:30Z", last_sign_in_at: null }, NOW)).toBe(true);
    expect(isFreshUser({ created_at: "2026-10-28T11:50:00Z", last_sign_in_at: null }, NOW)).toBe(false);
    expect(isFreshUser({ created_at: "2026-10-28T11:59:30Z", last_sign_in_at: "2026-10-28T11:59:40Z" }, NOW)).toBe(false);
    expect(isFreshUser(null, NOW)).toBe(false);
  });
});

describe("on the server", () => {
  let db: ReturnType<typeof memoryDb>;
  const generateLink = vi.fn();
  const verifyOtp = vi.fn();
  const signOut = vi.fn(async () => ({ error: null }));
  let cookieToken: string | null;

  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pk";
    db = memoryDb({
      restaurants: [
        { id: A, name: "A", owner_email: "x@grill.test" },
        { id: B, name: "B", owner_email: "x@grill.test" },
      ],
      signup_sessions: [],
    });
    generateLink.mockReset();
    verifyOtp.mockReset();
    signOut.mockClear();
    cookieToken = null;
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => ({ ...db.client, auth: { admin: { generateLink } } }) }));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          verifyOtp,
          signOut,
          getSession: async () => ({ data: { session: cookieToken ? { access_token: cookieToken } : null } }),
          getUser: async (t: string) => ({ data: { user: t === cookieToken ? { email: "x@grill.test" } : null } }),
        },
      }),
    }));
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "next/headers", "@supabase/ssr"]) vi.doUnmock(m);
  });

  const fresh = () => ({ data: { properties: { hashed_token: "hash-1" }, user: { created_at: new Date().toISOString(), last_sign_in_at: null } }, error: null });

  test("a new owner: the login is made with the same verifyOtp a login link uses, and recorded as a sign-up session", async () => {
    generateLink.mockResolvedValue(fresh());
    verifyOtp.mockResolvedValue({ data: { session: { access_token: token("sess-1") } }, error: null });
    const { startSignupSession } = await import("@/lib/auth");
    expect(await startSignupSession("x@grill.test", A)).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "x@grill.test" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "email" });
    expect(db.tables.signup_sessions).toEqual([expect.objectContaining({ session_id: "sess-1", restaurant_id: A })]);
  });

  test("an email Supabase already knew: no login is made", async () => {
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hash-1" }, user: { created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null } }, error: null });
    const { startSignupSession } = await import("@/lib/auth");
    expect(await startSignupSession("x@grill.test", A)).toEqual({ ok: false, reason: "existing_user" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  test("if the sign-up session can't be recorded, the login is undone at once", async () => {
    generateLink.mockResolvedValue(fresh());
    verifyOtp.mockResolvedValue({ data: { session: { access_token: token(null) } }, error: null });
    const { startSignupSession } = await import("@/lib/auth");
    expect(await startSignupSession("x@grill.test", A)).toEqual({ ok: false, reason: "failed" });
    expect(db.tables.signup_sessions).toEqual([]);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  test("currentOwner: a sign-up login sees only its restaurant; an emailed-link login sees all of that email's", async () => {
    db.tables.signup_sessions.push({ session_id: "sess-1", restaurant_id: A });
    const { currentOwner } = await import("@/lib/auth");
    cookieToken = token("sess-1");
    expect(await currentOwner()).toMatchObject({ restaurantIds: [A], isBuilder: false, allowed: true });
    cookieToken = token("sess-from-email-link");
    expect((await currentOwner())?.restaurantIds.sort()).toEqual([A, B].sort());
    cookieToken = null;
    expect(await currentOwner()).toBeNull();
  });

  test("a sign-up login asking for another restaurant's page (?r=) gets its own instead", async () => {
    db.tables.signup_sessions.push({ session_id: "sess-1", restaurant_id: A });
    const { currentOwner, pickRestaurantId } = await import("@/lib/auth");
    cookieToken = token("sess-1");
    const owner = (await currentOwner())!;
    expect(pickRestaurantId(owner, B)).toBe(A);
    expect(owner.restaurantIds.includes(B)).toBe(false);
  });
});
