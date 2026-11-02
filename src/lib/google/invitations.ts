import "server-only";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import * as api from "./api";
import { linkLocation, managerConnection, type GoogleConnection } from "./connections";
import { matchesRestaurant, matchInvitation, type Waiting } from "./invitations-rules";
import type { GLocation } from "./mapping";

// Owners add our manager account (GOOGLE_MANAGER_EMAIL, e.g. dina@dinerai.co.uk) to
// their Google profile. Nobody has to accept that by hand: this accepts the
// invitations it can match to a restaurant that's waiting for Google (rules in
// invitations-rules.ts), then links the location, imports from it and finishes
// Dina's Google step ("I'm in!"). A profile our account can already see (accepted
// by hand, or before) is linked the same way. Anything it can't match is left on
// Google for the builder, who gets an alert: never accepted on a guess.
// Runs right after the owner taps "Done, I've invited you", a few minutes later,
// and every hour (the setup_nudges job).

// said: what Dina's Google step said for each restaurant it finished ("I'm in!...").
export type InvitationRun = { accepted: string[]; linked: string[]; left: string[]; said: Record<string, string>; skipped?: string };

// Restaurants that said they invited us and have no location linked yet (never test sites).
// (Across restaurants on purpose, like the hourly Google nudges: each row is matched to one restaurant.)
async function waitingRestaurants(): Promise<Waiting[]> {
  const supabase = getSupabase();
  const steps = (check(await supabase.from("onboarding_steps").select("restaurant_id, data").eq("step_key", "google")) ?? []) as { restaurant_id: string; data: Record<string, unknown> | null }[];
  const invited = [...new Set(steps.filter((s) => s.data?.invited_at).map((s) => s.restaurant_id))];
  if (!invited.length) return [];
  const rows = (check(await supabase.from("restaurants").select("*").in("id", invited)) ?? []) as Restaurant[];
  return rows.filter((r) => !r.google_location_id && r.is_test !== true).map((r) => ({ id: r.id, name: r.name, address: r.address ?? null }));
}

const addressText = (l: GLocation) => [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality, l.storefrontAddress?.postalCode].filter(Boolean).join(", ");

async function link(conn: GoogleConnection, accountId: string, location: GLocation, r: Waiting, quiet: boolean): Promise<string | null> {
  await linkLocation(r.id, { connectionId: conn.id, accountId, locationId: location.name, title: location.title ?? null });
  await logAction({ restaurantId: r.id, actor: "system", action: "google", detail: `Linked Google location "${location.title ?? location.name}" through DinerAI's manager account (their invitation, accepted automatically)` });
  try {
    const { importFromGoogle } = await import("./import");
    await importFromGoogle(r.id, "builder");
    const { confirmFromGoogleImport } = await import("@/lib/onboarding/engine");
    await confirmFromGoogleImport(r.id);
  } catch (err) {
    console.error("Google import after an accepted invitation failed", err);
  }
  // Dina's Google step, if it's still waiting: done, and she says "I'm in!".
  const step = check(await getSupabase().from("onboarding_steps").select("status").eq("restaurant_id", r.id).eq("step_key", "google").maybeSingle<{ status: string }>());
  if (step && step.status !== "done") {
    const { markGoogleAccepted } = await import("@/lib/onboarding/dina/google-step");
    return markGoogleAccepted(r.id, { by: "connected", quiet });
  }
  return null;
}

// only: just this restaurant (the owner's own tap); quiet: the caller tells the owner.
export async function acceptManagerInvitations(opts: { only?: string; quiet?: boolean } = {}): Promise<InvitationRun> {
  const run: InvitationRun = { accepted: [], linked: [], left: [], said: {} };
  const conn = await managerConnection();
  if (!conn || conn.status !== "ok") return { ...run, skipped: "no manager account connected" };
  const waitingAll = await waitingRestaurants();
  const waiting = opts.only ? waitingAll.filter((w) => w.id === opts.only) : waitingAll;
  let accounts = await api.listAccounts(conn);

  // 1. Invitations waiting for us: accept the ones that match one waiting restaurant.
  for (const a of accounts) {
    for (const inv of await api.listInvitations(conn, a.name).catch(() => [])) {
      const target = inv.targetLocation ?? null;
      const m = target ? matchInvitation(target, waitingAll) : ({ restaurantId: null, reason: "it's for a whole business account, not one location" } as const);
      if (m.restaurantId === null) {
        run.left.push(inv.name);
        await alertBuilder(
          `google-invite:${inv.name}`,
          `A Google invitation for "${target?.locationName ?? inv.targetAccount?.accountName ?? "?"}"${target?.address ? ` (${target.address})` : ""} is waiting on our manager account, and wasn't accepted: ${m.reason}. Accept or decline it on Google, then link it from /settings/google.`,
        );
        continue;
      }
      if (opts.only && m.restaurantId !== opts.only) continue;
      await api.acceptInvitation(conn, inv.name);
      run.accepted.push(m.restaurantId);
    }
  }
  if (!waiting.length) return run;

  // 2. Waiting restaurants whose profile we can now see: link (exactly one match each).
  if (run.accepted.length) accounts = await api.listAccounts(conn);
  const visible: { accountId: string; location: GLocation }[] = [];
  for (const a of accounts) for (const l of await api.listLocations(conn, a.name).catch(() => [])) visible.push({ accountId: a.name, location: l });
  for (const r of waiting) {
    const hits = visible.filter((v) => matchesRestaurant({ locationName: v.location.title, address: addressText(v.location) }, r));
    const unique = [...new Map(hits.map((h) => [h.location.name, h])).values()];
    if (unique.length === 1) {
      const said = await link(conn, unique[0].accountId, unique[0].location, r, opts.quiet ?? false);
      if (said) run.said[r.id] = said;
      run.linked.push(r.id);
    } else if (unique.length > 1) {
      await alertBuilder(`google-link-ambiguous:${r.id}`, `${r.name}: our manager account can see ${unique.length} Google profiles that match it, so none was linked. Pick it on /settings/google?r=${r.id}.`);
    }
  }
  return run;
}
