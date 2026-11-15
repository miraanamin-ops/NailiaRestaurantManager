// The app's one-time web link (lib/auth.ts appWebLink, 15 Nov 2026): a page opened from
// the app opens already logged in, through a fresh session of its own. Never for a
// sign-up login that hasn't proved its email, never for someone not allowed in, and
// only to a path on our own site.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (sessionId: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", session_id: sessionId })}.sig`;

let db: ReturnType<typeof memoryDb>;
let user: { id: string; email: string; app_metadata: Record<string, unknown> } | null;
const generateLink = vi.fn();

describe("appWebLink", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pk";
    db = memoryDb({ restaurants: [{ id: A, name: "A", owner_email: "x@grill.test" }], signup_sessions: [] });
    user = { id: "u1", email: "x@grill.test", app_metadata: {} };
    generateLink.mockReset().mockResolvedValue({ data: { properties: { hashed_token: "h4sh" } }, error: null });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => ({ ...db.client, auth: { admin: { generateLink } } }) }));
    vi.doMock("@supabase/supabase-js", async (orig) => ({ ...(await orig<object>()), createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "@supabase/supabase-js"]) vi.doUnmock(m);
  });

  test("an ordinary login gets a one-time link to that page", async () => {
    const { appWebLink } = await import("@/lib/auth");
    expect(await appWebLink(token("s1"), "/report/abc", "https://app.test")).toBe("https://app.test/auth/app?token_hash=h4sh&next=%2Freport%2Fabc");
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "x@grill.test" });
  });

  test("a sign-up login that hasn't proved its email gets none (by its account, or by its session)", async () => {
    const { appWebLink } = await import("@/lib/auth");
    user!.app_metadata = { signup_restaurant_id: A };
    expect(await appWebLink(token("s1"), "/settings", "https://app.test")).toBeNull();
    user!.app_metadata = {};
    db.tables.signup_sessions.push({ session_id: "s2", restaurant_id: A });
    expect(await appWebLink(token("s2"), "/settings", "https://app.test")).toBeNull();
    expect(generateLink).not.toHaveBeenCalled();
  });

  test("nobody who isn't allowed in, and only paths on our own site", async () => {
    const { appWebLink } = await import("@/lib/auth");
    user = { id: "u2", email: "stranger@else.test", app_metadata: {} };
    expect(await appWebLink(token("s1"), "/", "https://app.test")).toBeNull();
    user = { id: "u1", email: "x@grill.test", app_metadata: {} };
    expect(await appWebLink(token("s1"), "//evil.test/x", "https://app.test")).toBe("https://app.test/auth/app?token_hash=h4sh&next=%2F");
  });
});
