import "server-only";
import { logAction, type Actor } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { decryptCredentials, encryptCredentials } from "./crypto";
import { PROVIDERS } from "./providers";
import type { TillConnection, TillCredentials, TillProvider } from "./types";

// till_connections: at most one working connection per restaurant. Every query
// says which restaurant (tests/isolation.test.ts).

const COLUMNS = "id, restaurant_id, provider, mode, status, external_account, external_location, location_name, credentials_enc, synced_through, last_synced_at, last_error, connected_by, created_at";

// The restaurant's current connection (not disconnected), or null.
export async function tillFor(restaurantId: string) {
  return check(
    await getSupabase().from("till_connections").select(COLUMNS).eq("restaurant_id", restaurantId).neq("status", "disconnected").maybeSingle<TillConnection>(),
  );
}

export async function tillById(restaurantId: string, id: string) {
  return check(await getSupabase().from("till_connections").select(COLUMNS).eq("restaurant_id", restaurantId).eq("id", id).maybeSingle<TillConnection>());
}

// Restaurants with a working till, for the hourly sync.
export async function restaurantsWithTills(restaurantIds: string[]) {
  if (!restaurantIds.length) return new Set<string>();
  const rows = check(await getSupabase().from("till_connections").select("restaurant_id").in("restaurant_id", restaurantIds).eq("status", "ok").returns<{ restaurant_id: string }[]>()) ?? [];
  return new Set(rows.map((r) => r.restaurant_id));
}

export const credentialsOf = (c: TillConnection) => (c.credentials_enc ? decryptCredentials(c.credentials_enc) : null);

// Saves a new connection, replacing any earlier one (only one till per restaurant).
// Location may be empty: the owner then picks it on the settings page.
export async function saveTill(input: {
  restaurantId: string;
  provider: TillProvider;
  mode: "live" | "dummy";
  credentials: TillCredentials | null;
  account: string | null;
  location: string | null;
  locationName: string | null;
  connectedBy: string;
  actor: Actor;
}) {
  const supabase = getSupabase();
  const old = await tillFor(input.restaurantId);
  if (old) check(await supabase.from("till_connections").update({ status: "disconnected", credentials_enc: null, updated_at: new Date().toISOString() }).eq("restaurant_id", input.restaurantId).eq("id", old.id));
  const row = check(
    await supabase
      .from("till_connections")
      .insert({
        restaurant_id: input.restaurantId,
        provider: input.provider,
        mode: input.mode,
        status: "ok",
        external_account: input.account,
        external_location: input.location,
        location_name: input.locationName,
        credentials_enc: input.credentials ? encryptCredentials(input.credentials) : null,
        connected_by: input.connectedBy,
      })
      .select(COLUMNS)
      .single<TillConnection>(),
  )!;
  await logAction({
    restaurantId: input.restaurantId,
    actor: input.actor,
    action: "till",
    detail: `${PROVIDERS[input.provider].name} connected${input.mode === "dummy" ? " (dummy till, for testing)" : ""}${input.locationName ? `: ${input.locationName}` : ""}`,
    data: { connection: row.id, provider: input.provider, replaced: old?.id ?? null },
  });
  return row;
}

export async function updateTill(restaurantId: string, id: string, fields: Record<string, unknown>) {
  check(await getSupabase().from("till_connections").update({ ...fields, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("id", id));
}

export async function setTillCredentials(c: TillConnection, credentials: TillCredentials) {
  await updateTill(c.restaurant_id, c.id, { credentials_enc: encryptCredentials(credentials) });
}

// Disconnecting stops the sync and forgets the login. Sales already read stay.
export async function disconnectTill(restaurantId: string, actor: Actor) {
  const c = await tillFor(restaurantId);
  if (!c) return null;
  await updateTill(restaurantId, c.id, { status: "disconnected", credentials_enc: null });
  await logAction({ restaurantId, actor, action: "till", detail: `${PROVIDERS[c.provider].name} disconnected. Sales already read are kept.`, data: { connection: c.id, provider: c.provider } });
  return c;
}
