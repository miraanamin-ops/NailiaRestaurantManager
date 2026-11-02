// Login rules with no imports, so they're unit-tested (tests/signup-session.test.ts).
//
// A brand-new owner is logged in as soon as they sign up (lib/auth.ts
// startSignupSession). Nobody has proved they own that email yet, so that login
// (its Supabase session, by id) only ever sees the one restaurant it signed up:
// someone typing another person's email can't see that person's restaurants,
// now or later. A login from an emailed link is a separate session, with the
// usual access.

// The session id inside a Supabase access token (a JWT). Only read from a token
// that Supabase has just checked (getUser), never trusted on its own.
export function sessionIdFromToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof json.session_id === "string" ? json.session_id : null;
  } catch {
    return null;
  }
}

type Access = { email: string; isBuilder: boolean; restaurantIds: string[]; allowed: boolean };

// A sign-up login sees only its own restaurant, and never as the builder.
export function scopeToSignup<T extends Access>(access: T, signupRestaurantId: string | null): T {
  if (!signupRestaurantId) return access;
  const restaurantIds = access.restaurantIds.includes(signupRestaurantId) ? [signupRestaurantId] : [];
  return { ...access, isBuilder: false, restaurantIds, allowed: restaurantIds.length > 0 };
}

// Logging in straight after sign-up is only for a login account Supabase made
// just now, for this sign-up. An email with an older account (it has logged in
// before, or signed up before) gets a login link instead.
export const FRESH_USER_MS = 2 * 60_000;
export function isFreshUser(user: { created_at?: string | null; last_sign_in_at?: string | null } | null | undefined, now = Date.now()) {
  if (!user?.created_at || user.last_sign_in_at) return false;
  const age = now - Date.parse(user.created_at);
  return age >= -FRESH_USER_MS && age <= FRESH_USER_MS;
}
