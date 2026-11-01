import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { googleDryRun, type GoogleWriteKind } from "@/lib/gate-rules";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Pilot Zero (docs/pilot-zero.md, migration 056): the builder's own restaurant on
// live, and its Google dry run switches. Builder only: the admin console page
// (/onboarding/admin/pilot-zero) and its actions check the login. Nothing here
// is reachable from WhatsApp, Dina or the owner's settings, and
// tests/pilot-zero.test.ts fails if any other file writes these columns.
// Only a test restaurant or one on the builder's own number can be marked, so a
// real pilot's restaurant can never be.

export class PilotZeroError extends Error {}

// Before 056 has run, the columns aren't there.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);
const NEEDS_056 = "Run supabase/056_pilot_zero.sql on this database first.";

const digits = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "");

export function canBePilotZero(r: Pick<Restaurant, "is_demo" | "owner_whatsapp"> & { is_test?: boolean | null }, builderWhatsApp: string | undefined) {
  // Test sites are demo restaurants too; Ember & Spice and Cardamom Corner aren't test sites.
  if (r.is_test) return true;
  if (r.is_demo) return false;
  return digits(builderWhatsApp) !== "" && digits(r.owner_whatsapp) === digits(builderWhatsApp);
}

export type DryRunState = { replies: boolean; profile: boolean };
export const dryRunState = (r: Restaurant): DryRunState => ({ replies: googleDryRun(r, "replies"), profile: googleDryRun(r, "profile") });

// The Pilot Zero restaurants, and the ones that could be marked. null: 056 hasn't run.
export async function pilotZeroOverview() {
  const supabase = getSupabase();
  const marked = await supabase.from("restaurants").select("*").eq("pilot_zero", true).order("name").returns<Restaurant[]>();
  if (marked.error && MISSING_COLUMN.has(marked.error.code)) return null;
  const all = check(await supabase.from("restaurants").select("*").eq("pilot_zero", false).order("name").returns<Restaurant[]>()) ?? [];
  return { marked: check(marked) ?? [], markable: all.filter((r) => canBePilotZero(r, process.env.BUILDER_WHATSAPP)) };
}

async function load(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  if (!r) throw new PilotZeroError("That restaurant wasn't found");
  if (!("pilot_zero" in r)) throw new PilotZeroError(NEEDS_056);
  return r;
}

// Marks a restaurant for Pilot Zero. Its Google writes are dry run from now on
// (the default for a Pilot Zero restaurant), until switched here.
export async function markPilotZero(restaurantId: string, builderEmail: string) {
  const r = await load(restaurantId);
  if (r.pilot_zero) return r;
  if (!canBePilotZero(r, process.env.BUILDER_WHATSAPP)) {
    throw new PilotZeroError(`${r.name} isn't a test restaurant or on your own number, so it can't be your Pilot Zero restaurant`);
  }
  check(await getSupabase().from("restaurants").update({ pilot_zero: true, google_dry_run: null, google_profile_writes: null }).eq("id", r.id).eq("pilot_zero", false));
  await logAction({ restaurantId: r.id, actor: "builder", action: "setting", detail: `Marked for Pilot Zero by ${builderEmail}: Google writes are dry run` });
  return r;
}

const what = (kind: GoogleWriteKind) => (kind === "replies" ? "review replies and posts" : "hours and photo changes");

// Switches one kind of Google write between dry run and live. Going live needs
// the Google profile's name typed exactly (the confirmation names the profile).
// Back to dry run needs nothing.
export async function setGoogleDryRun(input: { restaurantId: string; kind: GoogleWriteKind; dryRun: boolean; confirm?: string; builderEmail: string }) {
  const r = await load(input.restaurantId);
  if (!r.pilot_zero) throw new PilotZeroError(`${r.name} isn't marked for Pilot Zero`);
  const profile = r.google_location_title?.trim() ?? "";
  if (!input.dryRun) {
    if (!r.google_location_id || !profile) throw new PilotZeroError("Connect the Google profile first: there's no profile to switch on.");
    if ((input.confirm ?? "").trim().toLowerCase() !== profile.toLowerCase()) {
      throw new PilotZeroError(`Not switched: type the profile's name exactly (${profile}) to confirm.`);
    }
  }
  const field = input.kind === "replies" ? "google_dry_run" : "google_profile_writes";
  const value = input.kind === "replies" ? input.dryRun : !input.dryRun;
  const before = dryRunState(r);
  check(await getSupabase().from("restaurants").update({ [field]: value }).eq("id", r.id).eq("pilot_zero", true));
  const after = dryRunState({ ...r, [field]: value });
  const where = profile ? ` on ${profile}` : "";
  await logAction({
    restaurantId: r.id,
    actor: "builder",
    action: "google",
    detail: `Google ${what(input.kind)}${where}: ${input.dryRun ? "dry run" : "LIVE"} (by ${input.builderEmail})${input.kind === "profile" && !input.dryRun && after.profile ? "" : input.kind === "profile" && !input.dryRun ? "; still dry run until replies and posts are live too" : ""}`,
    data: { field, before, after, profile: profile || null },
  });
  return after;
}
