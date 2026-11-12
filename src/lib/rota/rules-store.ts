import "server-only";
import { logAction, type Actor } from "@/lib/audit";
import { db, must } from "@/lib/ops/db";
import type { OpsSource } from "@/lib/ops/types";
import { suggestedRules, type Suggestion } from "./presets";
import { channelShares, roleKey, type ChannelShares } from "./rules";
import type { RotaRule, RotaStaff } from "./types";

// Saving a restaurant's staffing rules (rota_rules), and the suggestion for its
// size. One place, so the Team page, setup and WhatsApp all save the same way.

type Sized = { seats?: string | null; venue_types?: string[] | null };

// The suggestion for this restaurant's size, once setup has asked its seats or
// how it serves; null for an older restaurant that never said (its rota keeps the
// defaults it always had).
export function suggestionFor(r: Sized, staff: Pick<RotaStaff, "roles">[]): Suggestion | null {
  if (!r.seats && !(r.venue_types ?? []).length) return null;
  return suggestedRules({
    seats: r.seats ?? null,
    venueTypes: r.venue_types ?? null,
    staff,
  });
}

export const sharesFor = (r: Sized): ChannelShares => channelShares(r.venue_types ?? null);

const missingColumn = (e: unknown) => /column .* does not exist|could not find the .* column/i.test(String((e as { message?: string })?.message ?? e));

// Upserts each rule (one per role). Without migration 069 the new columns are
// left out, so the minimum and "1 more per" still save.
export async function saveRotaRules(
  restaurantId: string,
  rules: RotaRule[],
  opts: {
    source: OpsSource;
    actor: Actor;
    detail: string;
    before?: RotaRule[];
  },
) {
  if (!rules.length) return;
  const now = new Date().toISOString();
  const rows = rules.map((r) => ({
    restaurant_id: restaurantId,
    role: roleKey(r.role),
    min_on_shift: Math.max(0, Math.min(20, Math.round(r.min_on_shift))),
    orders_per_extra_staff: r.orders_per_extra_staff && r.orders_per_extra_staff > 0 ? r.orders_per_extra_staff : null,
    driver: r.driver ?? null,
    before_open_minutes: Math.max(0, Math.min(180, Math.round(r.before_open_minutes ?? 0))),
    after_close_minutes: Math.max(0, Math.min(180, Math.round(r.after_close_minutes ?? 0))),
    preset: r.preset ?? null,
    source: opts.source,
    updated_at: now,
  }));
  const res = await db().from("rota_rules").upsert(rows, { onConflict: "restaurant_id,role" });
  if (res.error && missingColumn(res.error)) {
    const older = rows.map((x) => ({
      restaurant_id: x.restaurant_id,
      role: x.role,
      min_on_shift: x.min_on_shift,
      orders_per_extra_staff: x.orders_per_extra_staff,
      source: x.source,
      updated_at: x.updated_at,
    }));
    must(await db().from("rota_rules").upsert(older, { onConflict: "restaurant_id,role" }), "save rota rules");
  } else must(res, "save rota rules");
  await logAction({
    restaurantId,
    actor: opts.actor,
    action: "rota_settings",
    detail: opts.detail,
    data: {
      rules: rows.map((x) => ({
        role: x.role,
        min: x.min_on_shift,
        per: x.orders_per_extra_staff,
        driver: x.driver,
        before: x.before_open_minutes,
        after: x.after_close_minutes,
        preset: x.preset,
      })),
      before_rules: opts.before ?? null,
    },
  });
}

// The saved rules as they are now.
export async function savedRotaRules(restaurantId: string): Promise<RotaRule[]> {
  const rows = (must(await db().from("rota_rules").select("*").eq("restaurant_id", restaurantId), "rota rules") ?? []) as (RotaRule & { orders_per_extra_staff: number | string | null })[];
  return rows.map((r) => ({
    role: r.role,
    min_on_shift: r.min_on_shift,
    orders_per_extra_staff: r.orders_per_extra_staff === null ? null : Number(r.orders_per_extra_staff),
    driver: r.driver ?? null,
    before_open_minutes: r.before_open_minutes ?? 0,
    after_close_minutes: r.after_close_minutes ?? 0,
    preset: r.preset ?? null,
  }));
}

// Takes out the rules for roles nobody on the team does any more (only ones code
// suggested, never a rule the owner set by hand on the Team page).
export async function dropSuggestedRules(restaurantId: string, keep: string[]) {
  const saved = await savedRotaRules(restaurantId);
  const gone = saved.filter((r) => !keep.includes(roleKey(r.role)) && (r.preset?.startsWith("seats:") || r.preset === "learned")).map((r) => r.role);
  if (gone.length) must(await db().from("rota_rules").delete().eq("restaurant_id", restaurantId).in("role", gone), "drop rota rules");
  return gone;
}
