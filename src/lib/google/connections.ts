import "server-only";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { decryptToken, encryptToken } from "./crypto";
import { GoogleAuthError, refreshAccess, revokeToken, type TokenResponse } from "./oauth";

// Google logins (google_connections) and the restaurant's chosen location.
// A restaurant uses either its owner's own login, or DinerAI's manager account
// (when the owner added us as a Manager and the builder linked the location).

export type GoogleConnection = {
  id: string;
  restaurant_id: string | null;
  kind: "owner" | "manager";
  google_email: string | null;
  google_sub: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  status: "ok" | "needs_reconnect" | "disconnected";
  last_error: string | null;
  last_refreshed_at: string | null;
  reconnect_sent_on: string | null;
  created_at: string;
};

export type GoogleLink = {
  restaurant: Restaurant;
  connection: GoogleConnection;
  accountId: string; // accounts/123
  locationId: string; // locations/456
};

const CONNECTION_COLUMNS = "id, restaurant_id, kind, google_email, google_sub, refresh_token_enc, access_token_enc, access_expires_at, status, last_error, last_refreshed_at, reconnect_sent_on, created_at";

export async function getConnection(id: string) {
  return check(await getSupabase().from("google_connections").select(CONNECTION_COLUMNS).eq("id", id).maybeSingle<GoogleConnection>());
}

// DinerAI's manager account (the newest working one).
export async function managerConnection() {
  const rows =
    check(
      await getSupabase()
        .from("google_connections")
        .select(CONNECTION_COLUMNS)
        .is("restaurant_id", null)
        .eq("kind", "manager")
        .neq("status", "disconnected")
        .order("created_at", { ascending: false })
        .returns<GoogleConnection[]>(),
    ) ?? [];
  return rows[0] ?? null;
}

// The owner's own logins for one restaurant, newest first.
export async function ownerConnections(restaurantId: string) {
  return (
    check(
      await getSupabase()
        .from("google_connections")
        .select(CONNECTION_COLUMNS)
        .eq("restaurant_id", restaurantId)
        .neq("status", "disconnected")
        .order("created_at", { ascending: false })
        .returns<GoogleConnection[]>(),
    ) ?? []
  );
}

// Saves a fresh login. Logging in again with the same Google account replaces
// the old tokens (and clears a "needs reconnecting" flag).
export async function saveConnection(input: { restaurantId: string | null; kind: "owner" | "manager"; sub: string; email: string | null; tokens: TokenResponse; connectedBy: string }) {
  if (!input.tokens.refresh_token) throw new Error("Google didn't send a refresh token. Remove DinerAI under myaccount.google.com > Security > Third-party connections, then connect again.");
  const supabase = getSupabase();
  const values = {
    google_email: input.email,
    refresh_token_enc: encryptToken(input.tokens.refresh_token),
    access_token_enc: encryptToken(input.tokens.access_token),
    access_expires_at: new Date(Date.now() + (input.tokens.expires_in - 60) * 1000).toISOString(),
    scopes: input.tokens.scope ?? null,
    status: "ok",
    last_error: null,
    last_refreshed_at: new Date().toISOString(),
    reconnect_sent_on: null,
    connected_by: input.connectedBy,
    updated_at: new Date().toISOString(),
  };
  const existing = input.restaurantId
    ? check(await supabase.from("google_connections").select("id").eq("restaurant_id", input.restaurantId).eq("google_sub", input.sub).maybeSingle<{ id: string }>())
    : check(await supabase.from("google_connections").select("id").is("restaurant_id", null).eq("kind", "manager").eq("google_sub", input.sub).maybeSingle<{ id: string }>());
  if (existing) {
    check(await supabase.from("google_connections").update(values).eq("id", existing.id));
    return existing.id;
  }
  const row = check(
    await supabase
      .from("google_connections")
      .insert({ ...values, restaurant_id: input.restaurantId, kind: input.kind, google_sub: input.sub })
      .select("id")
      .single<{ id: string }>(),
  );
  return row!.id;
}

// The restaurant's linked location and the login that can reach it, or null
// if it hasn't been connected (it then uses dummy Google).
export async function linkFor(restaurantId: string): Promise<GoogleLink | null> {
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  if (!restaurant?.google_connection_id || !restaurant.google_account_id || !restaurant.google_location_id) return null;
  const connection = await getConnection(restaurant.google_connection_id);
  if (!connection || connection.status === "disconnected") return null;
  // A login may only serve its own restaurant (or be the shared manager account).
  if (connection.kind === "owner" && connection.restaurant_id !== restaurantId) return null;
  return { restaurant, connection, accountId: restaurant.google_account_id, locationId: restaurant.google_location_id };
}

export const isLinked = (r: Pick<Restaurant, "google_connection_id" | "google_location_id">) => Boolean(r.google_connection_id && r.google_location_id);

// A working access token: the stored one if it has a minute left, else a new one.
// A refresh Google refuses marks the login as needing reconnecting (and tells
// people, see loginBroken) and throws GoogleAuthError.
export async function accessToken(conn: GoogleConnection, forLink?: Restaurant | null): Promise<string> {
  if (conn.status === "needs_reconnect") throw new GoogleAuthError("This Google login needs reconnecting");
  if (conn.access_token_enc && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now()) return decryptToken(conn.access_token_enc);
  let tokens: TokenResponse;
  try {
    tokens = await refreshAccess(decryptToken(conn.refresh_token_enc));
  } catch (err) {
    if (err instanceof GoogleAuthError) await loginBroken(conn, err.message, forLink ?? null);
    throw err;
  }
  const access_expires_at = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  check(
    await getSupabase()
      .from("google_connections")
      .update({ access_token_enc: encryptToken(tokens.access_token), access_expires_at, last_refreshed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
      .eq("id", conn.id),
  );
  conn.access_token_enc = encryptToken(tokens.access_token);
  conn.access_expires_at = access_expires_at;
  return tokens.access_token;
}

// Google has stopped accepting a login. Flag it (the builder sees it on
// /settings/google), alert the builder, and for an owner's own login send the
// owner a reconnect link on WhatsApp, at most once a day. The manager account
// is ours to fix, so its restaurants' owners are never told.
export async function loginBroken(conn: GoogleConnection, reason: string, restaurant: Restaurant | null) {
  const supabase = getSupabase();
  const today = londonYmd(new Date());
  check(
    await supabase
      .from("google_connections")
      .update({ status: "needs_reconnect", last_error: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", conn.id),
  );
  conn.status = "needs_reconnect";
  const who = conn.kind === "manager" ? `DinerAI's manager Google account (${conn.google_email ?? conn.google_sub})` : `${restaurant?.name ?? "A restaurant"}'s Google login (${conn.google_email ?? "unknown account"})`;
  await alertBuilder(`google-login:${conn.id}`, `${who} stopped working: ${reason}. ${conn.kind === "manager" ? "Reconnect it on /settings/google." : "The owner has been sent a reconnect link."}`).catch(() => {});

  const owned = conn.kind === "owner" && conn.restaurant_id ? (restaurant?.id === conn.restaurant_id ? restaurant : check(await supabase.from("restaurants").select("*").eq("id", conn.restaurant_id).maybeSingle<Restaurant>())) : null;
  if (!owned) return;
  await logAction({ restaurantId: owned.id, actor: "system", action: "google", detail: `Google login stopped working (${reason}); reconnect link sent` });
  if (conn.reconnect_sent_on === today) return;
  const channel = ownerChannel(owned);
  if (!channel) return;
  // Only marked as sent once it's really gone, so a failed message is retried next time.
  await messageOwner(
    channel,
    `🔌 *Google needs you to sign in again.* I can't see new reviews or post replies until you do. It takes 30 seconds:\n${appUrl()}/settings/google?r=${owned.id}`,
  );
  check(await supabase.from("google_connections").update({ reconnect_sent_on: today }).eq("id", conn.id));
}

// Links a location to a restaurant. The caller has checked the login can see it.
export async function linkLocation(restaurantId: string, input: { connectionId: string; accountId: string; locationId: string; title: string | null }) {
  check(
    await getSupabase()
      .from("restaurants")
      .update({
        google_connection_id: input.connectionId,
        google_account_id: input.accountId,
        google_location_id: input.locationId,
        google_location_title: input.title,
        google_linked_at: new Date().toISOString(),
      })
      .eq("id", restaurantId),
  );
}

// Disconnect: unlink the location, and for an owner's own login revoke it at
// Google and mark it disconnected. (The manager account stays: it serves others.)
export async function disconnect(restaurantId: string) {
  const supabase = getSupabase();
  const r = check(await supabase.from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  if (!r) return;
  check(
    await supabase
      .from("restaurants")
      .update({ google_connection_id: null, google_account_id: null, google_location_id: null, google_location_title: null, google_linked_at: null })
      .eq("id", restaurantId),
  );
  for (const conn of await ownerConnections(restaurantId)) {
    await revokeToken(decryptToken(conn.refresh_token_enc)).catch(() => {});
    check(await supabase.from("google_connections").update({ status: "disconnected", access_token_enc: null, updated_at: new Date().toISOString() }).eq("id", conn.id).eq("restaurant_id", restaurantId));
  }
}

// Every restaurant's Google state, for the builder's view on /settings/google.
export async function googleHealth() {
  const supabase = getSupabase();
  const restaurants =
    check(
      await supabase
        .from("restaurants")
        .select("id, name, active, google_connection_id, google_location_title, google_linked_at, google_imported_at")
        .order("created_at")
        .returns<Pick<Restaurant, "id" | "name" | "active" | "google_connection_id" | "google_location_title" | "google_linked_at" | "google_imported_at">[]>(),
    ) ?? [];
  const ids = restaurants.map((r) => r.google_connection_id).filter((x): x is string => Boolean(x));
  const manager = await managerConnection();
  const conns = ids.length
    ? (check(await supabase.from("google_connections").select(CONNECTION_COLUMNS).in("id", ids).returns<GoogleConnection[]>()) ?? [])
    : [];
  const byId = new Map(conns.map((c) => [c.id, c]));
  return {
    manager,
    rows: restaurants.map((r) => ({ ...r, connection: r.google_connection_id ? (byId.get(r.google_connection_id) ?? null) : null })),
  };
}
