"use server";
import { redirect } from "next/navigation";
import { logAction } from "@/lib/audit";
import { currentOwner } from "@/lib/auth";
import { listLocations } from "@/lib/google/api";
import { disconnect, getConnection, linkLocation } from "@/lib/google/connections";
import { importFromGoogle } from "@/lib/google/import";
import { confirmFromGoogleImport } from "@/lib/onboarding/engine";

// The buttons on /settings/google. Every change is in the audit log.

async function allowed(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/settings/google?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return owner;
}

const back = (rid: string, params: string): never => redirect(`/settings/google?r=${rid}&${params}`);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

// "This is us": links the location, then imports from it straight away.
export async function chooseLocation(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const rid = get("r");
  const owner = await allowed(rid);
  const conn = await getConnection(get("c"));
  // The owner's own login for this restaurant, or (builder only) the manager account.
  const usable = conn && conn.status === "ok" && (conn.kind === "owner" ? conn.restaurant_id === rid : owner.isBuilder);
  if (!usable) back(rid, `error=${encodeURIComponent("That Google login can't be used here. Connect Google again.")}`);
  // Only a location this login can really see (the form could have been changed).
  const visible = await listLocations(conn!, get("account")).catch(() => []);
  const location = visible.find((l) => l.name === get("location"));
  if (!location) back(rid, `error=${encodeURIComponent("That location isn't visible to this Google login.")}`);

  await linkLocation(rid, { connectionId: conn!.id, accountId: get("account"), locationId: location!.name, title: location!.title ?? null });
  const actor = owner.isBuilder ? "builder" : "owner";
  await logAction({ restaurantId: rid, actor, action: "google", detail: `Linked Google location "${location!.title ?? location!.name}"${conn!.kind === "manager" ? " through DinerAI's manager account" : ""}` });
  try {
    await importFromGoogle(rid, actor);
    // Still setting up: the import completes onboarding's Google step.
    await confirmFromGoogleImport(rid);
  } catch (err) {
    console.error("Google import failed", err);
    back(rid, `saved=linked&error=${encodeURIComponent(`Linked, but the import didn't finish: ${message(err)}. Try "Import again".`)}`);
  }
  back(rid, "saved=linked");
}

export async function importAgain(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  try {
    await importFromGoogle(rid, owner.isBuilder ? "builder" : "owner");
  } catch (err) {
    back(rid, `error=${encodeURIComponent(`The import didn't finish: ${message(err)}`)}`);
  }
  back(rid, "saved=imported");
}

export async function disconnectGoogle(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const owner = await allowed(rid);
  await disconnect(rid);
  await logAction({ restaurantId: rid, actor: owner.isBuilder ? "builder" : "owner", action: "google", detail: "Disconnected Google" });
  back(rid, "saved=disconnected");
}
