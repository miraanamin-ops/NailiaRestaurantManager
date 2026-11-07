// Login rules with no imports, so they're unit-tested (tests/signup-session.test.ts).
//
// A brand-new owner is logged in as soon as they sign up. Nobody has proved they
// own that email yet, so that login only ever sees the one restaurant it signed up:
// someone typing another person's email can't see that person's restaurants, now
// or later (signupScope, below). Opening a link we emailed lifts the limit.

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

// ---------- Passwords (since 7 Nov 2026: email + password, a link only to reset) ----------

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // what Supabase's password hashing keeps

// Why a new password won't do ("short" / "long"), or null.
export function passwordProblem(password: string): "short" | "long" | null {
  if (password.trim().length < PASSWORD_MIN) return "short";
  if (password.length > PASSWORD_MAX) return "long";
  return null;
}

// A login account made with a password at sign-up hasn't proved it owns its email,
// so it's limited to the restaurant it signed up (`app_metadata.signup_restaurant_id`,
// which only our server can set) until the owner opens a link we emailed (a password
// reset), which clears it. A sign-up session from before passwords (its own table)
// counts the same way.
export function signupScope(sessionRestaurantId: string | null, appMetadata: unknown): string | null {
  if (sessionRestaurantId) return sessionRestaurantId;
  const id = (appMetadata as { signup_restaurant_id?: unknown } | null | undefined)?.signup_restaurant_id;
  return typeof id === "string" && id ? id : null;
}
