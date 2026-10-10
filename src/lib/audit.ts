import "server-only";
import { getSupabase } from "@/lib/supabase";

// The audit log: one row for every action, saying who did what and when.
// UNDO (lib/undo.ts) reads it; the log page (/log) shows it.

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export type Actor = "owner" | "assistant" | "safety rules" | "system" | "hourly job" | "scheduled job" | "builder" | "customer";
export type AuditAction =
  | "created" // a draft was written (and checked)
  | "edited"
  | "approved"
  | "skipped"
  | "blocked" // a safety rule stopped a send
  | "queued" // held: outside sending hours or paused
  | "sent"
  | "setting" // PAUSE, RESUME, CAP, TIME, reward, email
  | "undone"
  | "data_deleted" // a customer used "delete my data"
  | "exported"; // the owner downloaded (or was sent a link to) their customer list

export type AuditEntry = {
  id: string;
  restaurant_id: string | null;
  draft_id: string | null;
  batch_id: string | null;
  actor: Actor;
  action: AuditAction;
  detail: string | null;
  data: Record<string, unknown> | null;
  undone_at: string | null;
  created_at: string;
};

// The owner's own decisions that UNDO can reverse.
export const UNDOABLE: AuditAction[] = ["approved", "skipped", "edited", "setting"];

// Never throws: a failed log line mustn't stop the action itself.
export async function logAction(entry: {
  restaurantId: string;
  draftId?: string | null;
  batchId?: string | null;
  actor: Actor;
  action: AuditAction;
  detail: string;
  data?: Record<string, unknown>;
}) {
  const { error } = await getSupabase().from("audit_log").insert({
    restaurant_id: entry.restaurantId,
    draft_id: entry.draftId ?? null,
    batch_id: entry.batchId ?? null,
    actor: entry.actor,
    action: entry.action,
    detail: entry.detail,
    data: entry.data ?? null,
  });
  if (error) console.error("Failed to write the audit log", error);
}

// Setting changes, with the old value so UNDO can put it back.
export function logSetting(restaurantId: string, field: string, before: unknown, after: unknown, detail: string) {
  return logAction({ restaurantId, actor: "owner", action: "setting", detail, data: { field, before, after } });
}

// The owner's most recent action that can be undone (all of it, if it was a batch
// like APPROVE ALL), from the last 24 hours.
export async function lastUndoable(restaurantId: string, now: Date) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [latest] =
    check(
      await getSupabase()
        .from("audit_log")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("actor", "owner")
        .in("action", UNDOABLE)
        .is("undone_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<AuditEntry[]>(),
    ) ?? [];
  if (!latest?.batch_id) return latest ? [latest] : [];
  return (
    check(
      await getSupabase()
        .from("audit_log")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("batch_id", latest.batch_id)
        .eq("actor", "owner")
        .in("action", UNDOABLE)
        .is("undone_at", null)
        .order("created_at")
        .returns<AuditEntry[]>(),
    ) ?? []
  );
}

export async function markUndone(ids: string[]) {
  if (ids.length) check(await getSupabase().from("audit_log").update({ undone_at: new Date().toISOString() }).in("id", ids));
}

export async function recentLog(restaurantId: string, limit = 200) {
  return (
    check(
      await getSupabase()
        .from("audit_log")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<AuditEntry[]>(),
    ) ?? []
  );
}
