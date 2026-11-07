// Logging in (lib/auth.ts, lib/auth-rules.ts), since 7 Nov 2026 with email and
// password. A brand-new owner gets a login account with the password they chose at
// sign-up and is logged straight in, but nobody has proved the email is theirs, so
// that account only sees the restaurant it signed up until they open a link we
// emailed (a password reset). Older sign-up sessions (their own table) are limited
// the same way. An ordinary login keeps its usual access.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { passwordProblem, scopeToSignup, sessionIdFromToken, signupScope } from "@/lib/auth-rules";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

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

  test("the limit comes from an older sign-up session, else the account's server-only metadata", () => {
    expect(signupScope(A, { signup_restaurant_id: B })).toBe(A);
    expect(signupScope(null, { signup_restaurant_id: B })).toBe(B);
    expect(signupScope(null, { signup_restaurant_id: null })).toBeNull();
    expect(signupScope(null, { signup_restaurant_id: 42 })).toBeNull();
    expect(signupScope(null, undefined)).toBeNull();
  });

  test("passwords: at least 8 characters (spaces alone don't count), at most 72", () => {
    expect(passwordProblem("")).toBe("short");
    expect(passwordProblem("        ")).toBe("short");
    expect(passwordProblem("seven77")).toBe("short");
    expect(passwordProblem("eight888")).toBeNull();
    expect(passwordProblem("x".repeat(72))).toBeNull();
    expect(passwordProblem("x".repeat(73))).toBe("long");
  });
});

describe("on the server", () => {
  let db: ReturnType<typeof memoryDb>;
  const createUser = vi.fn();
  const updateUserById = vi.fn(async () => ({ error: null }));
  const signInWithPassword = vi.fn();
  let cookieToken: string | null;
  let appMetadata: Record<string, unknown>;

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
    createUser.mockReset();
    updateUserById.mockClear();
    signInWithPassword.mockReset();
    cookieToken = null;
    appMetadata = {};
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => ({ ...db.client, auth: { admin: { createUser, updateUserById } } }) }));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          signInWithPassword,
          signOut: async () => ({ error: null }),
          getSession: async () => ({ data: { session: cookieToken ? { access_token: cookieToken } : null } }),
          getUser: async (t?: string) => ({
            data: { user: cookieToken && (t === undefined || t === cookieToken) ? { id: "u1", email: "x@grill.test", app_metadata: appMetadata } : null },
          }),
        },
      }),
    }));
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "next/headers", "@supabase/ssr"]) vi.doUnmock(m);
  });

  test("a new owner: the account is made with their password, limited to the restaurant it signed up, then logged in", async () => {
    createUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const { createPasswordAccount } = await import("@/lib/auth");
    expect(await createPasswordAccount("x@grill.test", "correct horse", A)).toEqual({ ok: true });
    expect(createUser).toHaveBeenCalledWith({ email: "x@grill.test", password: "correct horse", email_confirm: true, app_metadata: { signup_restaurant_id: A } });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "x@grill.test", password: "correct horse" });
  });

  test("an email Supabase already knew: nothing is changed and nobody is logged in", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { status: 422, message: "A user with this email address has already been registered" } });
    const { createPasswordAccount } = await import("@/lib/auth");
    expect(await createPasswordAccount("x@grill.test", "correct horse", A)).toEqual({ ok: false, reason: "existing_user" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  test("currentOwner: a sign-up account sees only its restaurant until the email is proved, then all of that email's", async () => {
    const { currentOwner, markEmailProven } = await import("@/lib/auth");
    cookieToken = token("sess-9");
    appMetadata = { signup_restaurant_id: A };
    expect(await currentOwner()).toMatchObject({ restaurantIds: [A], isBuilder: false, allowed: true });
    await markEmailProven();
    expect(updateUserById).toHaveBeenCalledWith("u1", { app_metadata: { signup_restaurant_id: null } });
    appMetadata = { signup_restaurant_id: null };
    expect((await currentOwner())?.restaurantIds.sort()).toEqual([A, B].sort());
    cookieToken = null;
    expect(await currentOwner()).toBeNull();
  });

  test("an older sign-up session is still limited to its restaurant", async () => {
    db.tables.signup_sessions.push({ session_id: "sess-1", restaurant_id: A });
    const { currentOwner, pickRestaurantId } = await import("@/lib/auth");
    cookieToken = token("sess-1");
    const owner = (await currentOwner())!;
    expect(owner).toMatchObject({ restaurantIds: [A], allowed: true });
    expect(pickRestaurantId(owner, B)).toBe(A);
  });

  test("an ordinary login with nothing to lift changes nothing", async () => {
    const { markEmailProven } = await import("@/lib/auth");
    cookieToken = token("sess-2");
    await markEmailProven();
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
