"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { getRestaurant } from "@/lib/onboarding/store";
import { queueTillSync } from "@/lib/tills/actions";
import { eposNowCheck, lightspeedLocations, squareLocations, toastRestaurants } from "@/lib/tills/clients";
import { isProvider, liveReady, PROVIDERS } from "@/lib/tills/providers";
import { credentialsOf, disconnectTill, saveTill, tillFor, updateTill } from "@/lib/tills/store";
import { dummyTillAllowed } from "@/lib/tills/sync";
import { TillAuthError } from "@/lib/tills/types";

// The buttons on /settings/till. Connecting and disconnecting are in the audit log.

async function allowed(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/settings/till?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return owner;
}

const back = (rid: string, params: string): never => redirect(`/settings/till?r=${rid}&${params}`);
const err = (rid: string, text: string): never => back(rid, `error=${encodeURIComponent(text.slice(0, 300))}`);
const actorOf = (o: { isBuilder: boolean }) => (o.isBuilder ? "builder" : "owner") as "builder" | "owner";

// Epos Now: the API key and secret of a device the owner added in their Back Office.
export async function connectEposNow(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  const key = String(form.get("key") ?? "").trim();
  const secret = String(form.get("secret") ?? "").trim();
  if (!liveReady("eposnow", process.env)) err(rid, "Till connections aren't switched on yet (TILL_TOKEN_KEY is missing).");
  if (!/^[A-Za-z0-9]{16,64}$/.test(key) || !/^[A-Za-z0-9]{16,64}$/.test(secret)) err(rid, "That doesn't look like an Epos Now API key and secret (each is a long code of letters and numbers).");
  const credentials = { kind: "api_key" as const, key, secret };
  try {
    await eposNowCheck(credentials);
  } catch (e) {
    err(rid, e instanceof TillAuthError ? "Epos Now didn't accept that key and secret. Please copy them again from the API device." : `Couldn't reach Epos Now: ${e instanceof Error ? e.message : String(e)}`);
  }
  const c = await saveTill({ restaurantId: rid, provider: "eposnow", mode: "live", credentials, account: null, location: null, locationName: "Epos Now API device", connectedBy: owner.email, actor: actorOf(owner) });
  await queueTillSync(rid, c.id);
  back(rid, "saved=connected");
}

// Square or Lightspeed with several locations: the one to read.
export async function chooseTillLocation(form: FormData) {
  const rid = String(form.get("r") ?? "");
  await allowed(rid);
  const c = await tillFor(rid);
  const creds = c ? credentialsOf(c) : null;
  if (!c || c.mode !== "live" || (c.provider !== "square" && c.provider !== "lightspeed") || creds?.kind !== "oauth") return err(rid, "Connect your till again first.");
  // Only a location this login can really see (the form could have been changed).
  const list = await (c.provider === "square" ? squareLocations(creds.access_token) : lightspeedLocations(creds.access_token)).catch(() => []);
  const chosen = list.find((l) => l.id === String(form.get("location") ?? ""));
  if (!chosen) err(rid, "That location isn't on this till account.");
  await updateTill(rid, c!.id, { external_location: chosen!.id, location_name: [c!.location_name, chosen!.name].filter(Boolean).join(", ") });
  await queueTillSync(rid, c!.id);
  back(rid, "saved=connected");
}

export async function syncTillNow(form: FormData) {
  const rid = String(form.get("r") ?? "");
  await allowed(rid);
  const c = await tillFor(rid);
  if (!c) err(rid, "No till is connected.");
  await queueTillSync(rid, c!.id);
  back(rid, "saved=syncing");
}

export async function disconnectTillAction(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  const c = await disconnectTill(rid, actorOf(owner));
  if (c?.provider === "square") {
    const creds = credentialsOf(c);
    if (creds?.kind === "oauth") await (await import("@/lib/tills/clients")).squareRevoke(creds.access_token);
  }
  back(rid, "saved=disconnected");
}

// Testing: a pretend till of any kind, for a demo restaurant away from the live site.
export async function connectDummyTill(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  const provider = String(form.get("provider") ?? "");
  const r = await getRestaurant(rid);
  if (!isProvider(provider)) err(rid, "Unknown till.");
  if (!dummyTillAllowed(r)) err(rid, "Dummy tills only work for demo restaurants with test tools on, away from the live site.");
  const c = await saveTill({ restaurantId: rid, provider: provider as never, mode: "dummy", credentials: null, account: "dummy", location: "dummy", locationName: `Dummy ${PROVIDERS[provider as keyof typeof PROVIDERS].name} till`, connectedBy: owner.email, actor: actorOf(owner) });
  await queueTillSync(rid, c.id);
  back(rid, "saved=connected");
}

// Builder only: links a Toast restaurant that has switched DinerAI on in Toast.
export async function linkToast(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  if (!owner.isBuilder) err(rid, "Only DinerAI can link a Toast restaurant.");
  if (!liveReady("toast", process.env)) err(rid, "Toast isn't switched on yet (TOAST_CLIENT_ID, TOAST_CLIENT_SECRET).");
  const guid = String(form.get("guid") ?? "");
  const list = await toastRestaurants().catch((e) => err(rid, `Couldn't reach Toast: ${e instanceof Error ? e.message : String(e)}`));
  const chosen = list.find((t) => t.id === guid);
  if (!chosen) err(rid, "That restaurant hasn't switched DinerAI on in Toast.");
  const c = await saveTill({ restaurantId: rid, provider: "toast", mode: "live", credentials: null, account: chosen!.id, location: null, locationName: chosen!.name, connectedBy: owner.email, actor: "builder" });
  await queueTillSync(rid, c.id);
  back(rid, "saved=connected");
}
