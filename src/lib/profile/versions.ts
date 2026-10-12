import "server-only";
import type { AgentName } from "@/lib/agents/definition";
import { customerSafeMenu } from "@/lib/onboarding/profile-data";
import { getSupabase } from "@/lib/supabase";
import { columnsFor, fieldForColumn, PROFILE_FIELDS, profileView, type ProfileFieldName } from "./fields";

// Profile versions. Every change to a profile field writes a new version (field,
// old value, new value, who, evidence, when), and restaurants.profile_version
// goes up by one. Revert puts one field back to its previous value, as a new
// version. Agents always read the current profile; drafts record its version.
// (This is not UNDO: UNDO is the owner's WhatsApp command for their last action.)

export type ProfileVersion = {
  id: string;
  restaurant_id: string;
  version: number;
  field: ProfileFieldName;
  section: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string;
  evidence: Record<string, unknown> | null;
  reverts: string | null;
  reverted_at: string | null;
  created_at: string;
};

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Takes the next version number for this restaurant, safely when two changes race.
async function nextVersion(restaurantId: string) {
  const supabase = getSupabase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = ok(await supabase.from("restaurants").select("profile_version").eq("id", restaurantId).single<{ profile_version: number | null }>());
    const current = row?.profile_version ?? 0;
    const bumped = ok(
      await supabase
        .from("restaurants")
        .update({ profile_version: current + 1 })
        .eq("id", restaurantId)
        .eq("profile_version", current)
        .select("id")
        .maybeSingle<{ id: string }>(),
    );
    if (bumped) return current + 1;
  }
  throw new Error("Couldn't take a new profile version (too many changes at once)");
}

// Records one column's change (called when a profile setting is logged).
// Columns that aren't profile fields are ignored. Never throws: a failed
// version record mustn't stop the change itself.
export async function recordColumnChange(input: {
  restaurantId: string;
  column: string;
  before: unknown;
  after: unknown;
  by: string;
  evidence?: Record<string, unknown>;
  reverts?: string | null;
}) {
  const field = fieldForColumn(input.column);
  if (!field || same(input.before, input.after)) return null;
  try {
    const multi = PROFILE_FIELDS[field].columns.length > 1;
    const version = await nextVersion(input.restaurantId);
    const row = ok(
      await getSupabase()
        .from("profile_versions")
        .insert({
          restaurant_id: input.restaurantId,
          version,
          field,
          section: PROFILE_FIELDS[field].section,
          old_value: multi ? { [input.column]: input.before ?? null } : (input.before ?? null),
          new_value: multi ? { [input.column]: input.after ?? null } : (input.after ?? null),
          changed_by: input.by,
          evidence: input.evidence ?? null,
          reverts: input.reverts ?? null,
        })
        .select("*")
        .single<ProfileVersion>(),
    );
    // Hours, special hours or the menu: Visibility drafts the matching Google update.
    if (field === "hours" || field === "special_hours" || field === "menu") {
      const { profileChanged } = await import("@/lib/agents/visibility");
      await profileChanged(input.restaurantId, field, input.before, input.after);
    }
    return row;
  } catch (err) {
    console.error("Couldn't record the profile version", err);
    return null;
  }
}

// The profile version a draft is being written with (null if it can't be read,
// e.g. before supabase/018_profile_v1.sql has been run).
export async function currentProfileVersion(restaurantId: string): Promise<number | null> {
  const { data, error } = await getSupabase().from("restaurants").select("profile_version").eq("id", restaurantId).maybeSingle<{ profile_version: number | null }>();
  return error || !data ? null : (data.profile_version ?? 0);
}

// What one agent sees of the profile, and its version.
export async function agentProfile(restaurantId: string, agent: AgentName) {
  const row = ok(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).single<Record<string, unknown>>());
  if (!row) throw new Error(`Restaurant ${restaurantId} not found`);
  return { version: Number(row.profile_version ?? 0), fields: profileView(row, agent, (m) => customerSafeMenu((m ?? []) as Parameters<typeof customerSafeMenu>[0])) };
}

export async function profileHistory(restaurantId: string, limit = 20) {
  return (
    ok(
      await getSupabase()
        .from("profile_versions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<ProfileVersion[]>(),
    ) ?? []
  );
}

// Revert is offered only on a field's latest change, so it never undoes a later one.
export function revertable(history: ProfileVersion[]) {
  const latest = new Map<string, string>();
  for (const v of [...history].sort((a, b) => b.version - a.version)) if (!latest.has(v.field)) latest.set(v.field, v.id);
  return new Set(history.filter((v) => !v.reverted_at && latest.get(v.field) === v.id).map((v) => v.id));
}

export type RevertResult = { ok: true; field: ProfileFieldName; columns: Record<string, unknown> } | { ok: false; reason: string };

// Works out what Revert would write. The caller writes it and logs it, which records
// the new version (lib/audit.ts), then marks the original as reverted (markReverted).
export async function planRevert(restaurantId: string, versionId: string): Promise<RevertResult> {
  const supabase = getSupabase();
  const v = ok(
    await supabase.from("profile_versions").select("*").eq("restaurant_id", restaurantId).eq("id", versionId).maybeSingle<ProfileVersion>(),
  );
  if (!v) return { ok: false, reason: "That change wasn't found." };
  if (v.reverted_at) return { ok: false, reason: "That change has already been reverted." };
  const later = ok(
    await supabase
      .from("profile_versions")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("field", v.field)
      .gt("version", v.version)
      .limit(1)
      .returns<{ id: string }[]>(),
  );
  if (later?.length) return { ok: false, reason: `The ${PROFILE_FIELDS[v.field]?.label ?? v.field} has changed again since, so revert the latest change first.` };
  if (!PROFILE_FIELDS[v.field]) return { ok: false, reason: "That field can't be reverted." };
  return { ok: true, field: v.field, columns: columnsFor(v.field, v.old_value) };
}

export async function markReverted(restaurantId: string, versionId: string) {
  ok(await getSupabase().from("profile_versions").update({ reverted_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("id", versionId));
}
