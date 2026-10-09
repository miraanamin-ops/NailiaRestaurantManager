import "server-only";
import { logAction, type Actor } from "@/lib/audit";
import { allNotes, checksLine, type DraftChecks } from "@/lib/checks/types";
import { getSupabase } from "@/lib/supabase";

export const DRAFT_KINDS = ["review_reply", "promotion", "other", "email_campaign", "google_post"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export type WaitingFor = "decision" | "edit_instructions" | "skip_reason";

export type Draft = {
  id: string;
  restaurant_id: string;
  kind: DraftKind;
  customer_id: string | null;
  review_id: string | null;
  content: string;
  status: "pending" | "approved" | "queued" | "sent" | "blocked" | "skipped" | "superseded" | "rejected" | "withdrawn";
  waiting_for: WaitingFor | null;
  audience: string | null;
  request: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  block_reason: string | null;
  check_notes: CheckNotes | null;
  // The four checks and what each found (step 10). Older drafts only have check_notes.
  checks: DraftChecks | null;
  // Morning brief (step 8)
  held_at: string | null;
  brief_number: number | null;
  briefed_at: string | null;
};

// Everything the checks changed or want the owner to look at, all together.
export type CheckNotes = { fixes: string[]; flags: string[] };

export type Feedback = {
  draft_kind: string | null;
  kind: "edit" | "skip";
  note: string;
  before_content: string | null;
  after_content: string | null;
  created_at: string;
};

export const KIND_LABELS: Record<DraftKind, string> = {
  review_reply: "Review reply",
  promotion: "Offer / promotion",
  other: "Message",
  email_campaign: "Email campaign",
  google_post: "Google post",
};

export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// For queries that must return exactly one row.
export function checkRow<T>(res: { data: T | null; error: { message: string } | null }): T {
  const row = check(res);
  if (!row) throw new Error("Expected a row but got none");
  return row;
}

// The draft the assistant is currently waiting on the owner about, if any.
export async function getActiveDraft(restaurantId: string) {
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .not("waiting_for", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Draft>();
  return check(res);
}

export async function createDraft(input: {
  restaurantId: string;
  kind: DraftKind;
  content: string;
  audience: string;
  request: string | null;
  reviewId?: string | null;
  customerId?: string | null;
  checks: DraftChecks;
  // present: the owner asked for it, so it replaces the draft on screen (default).
  // hold:    made by a scheduled job; waits quietly for the morning brief.
  // urgent:  jumps the queue (e.g. a bad review); the draft on screen goes back into the queue.
  mode?: "present" | "hold" | "urgent";
  // Who made it, for the audit log. Defaults: present = the assistant (the owner asked),
  // hold = a scheduled job, urgent = the hourly review check.
  actor?: Actor;
}) {
  const supabase = getSupabase();
  const mode = input.mode ?? "present";
  let waitingFor: WaitingFor | null = "decision";

  if (mode === "hold") {
    waitingFor = null;
  } else {
    const active = await getActiveDraft(input.restaurantId);
    if (active) {
      // A new request replaces a draft the owner asked for earlier. Drafts from
      // a brief (or held for one) are never thrown away: they go back in the queue.
      const replace = mode === "present" && active.status === "pending" && !active.held_at && !active.briefed_at;
      check(
        await supabase
          .from("drafts")
          .update({ status: replace ? "superseded" : active.status, waiting_for: null, updated_at: new Date().toISOString() })
          .eq("id", active.id),
      );
    }
  }

  const res = await supabase
    .from("drafts")
    .insert({
      restaurant_id: input.restaurantId,
      kind: input.kind,
      content: input.content,
      audience: input.audience,
      request: input.request,
      review_id: input.reviewId ?? null,
      customer_id: input.customerId ?? null,
      status: "pending",
      waiting_for: waitingFor,
      checks: input.checks,
      check_notes: allNotes(input.checks),
      held_at: mode === "hold" ? new Date().toISOString() : null,
    })
    .select("*")
    .single<Draft>();
  const draft = checkRow(res);
  await logAction({
    restaurantId: draft.restaurant_id,
    draftId: draft.id,
    actor: input.actor ?? (mode === "present" ? "assistant" : mode === "hold" ? "scheduled job" : "hourly job"),
    action: "created",
    detail: `Drafted ${draftName(draft)}${mode === "hold" ? ", held for the morning brief" : ""}. Checks: ${checksLine(input.checks)}`,
  });
  return draft;
}

export function draftName(d: Pick<Draft, "kind" | "audience">) {
  return `${KIND_LABELS[d.kind].toLowerCase()}${d.audience ? ` for ${d.audience}` : ""}`.replace(/\.$/, "");
}

// Drafts waiting their turn: pending, but not yet shown to the owner.
export async function getQueue(restaurantId: string) {
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("status", "pending")
    .is("waiting_for", null)
    .order("created_at")
    .returns<Draft[]>();
  return check(res) ?? [];
}

// If the owner isn't busy with a draft, brings the next queued one forward.
// Drafts held for (or already shown in) the morning brief only come forward
// when the owner asks (NEXT); otherwise they wait for the brief.
export async function takeNextFromQueue(restaurantId: string, includeBrief = false) {
  if (await getActiveDraft(restaurantId)) return null;
  const queue = await getQueue(restaurantId);
  const next = includeBrief ? queue[0] : queue.find((d) => !d.held_at && !d.briefed_at);
  if (!next) return null;
  return updateDraft(next.id, { waiting_for: "decision" });
}

// Makes this draft the one the owner is dealing with (e.g. they tapped a
// button on brief item 3). Any other draft on screen goes back in the queue.
export async function focusDraft(draft: Draft, waitingFor: WaitingFor) {
  check(
    await getSupabase()
      .from("drafts")
      .update({ waiting_for: null, updated_at: new Date().toISOString() })
      .eq("restaurant_id", draft.restaurant_id)
      .neq("id", draft.id)
      .not("waiting_for", "is", null),
  );
  return updateDraft(draft.id, { waiting_for: waitingFor });
}

export async function getDraft(id: string) {
  return checkRow(await getSupabase().from("drafts").select("*").eq("id", id).single<Draft>());
}

// The draft most recently approved: where a second tap on Approve lands.
export async function getLastApprovedDraft(restaurantId: string) {
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle<Draft>();
  return check(res);
}

export async function updateDraft(id: string, fields: Partial<Draft>) {
  const res = await getSupabase()
    .from("drafts")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single<Draft>();
  return checkRow(res);
}

// Approve only records the owner's decision. Sending is a separate step
// (lib/send.ts) that checks every safety rule first.
// batchId groups decisions taken together (APPROVE ALL), so UNDO reverses them together.
export async function approveDraft(draft: Draft, batchId?: string) {
  const approved = await updateDraft(draft.id, { status: "approved", approved_at: new Date().toISOString(), waiting_for: null });
  await logAction({
    restaurantId: draft.restaurant_id,
    draftId: draft.id,
    batchId,
    actor: "owner",
    action: "approved",
    detail: `Approved ${draftName(draft)}`,
  });
  return approved;
}

export function startEdit(draft: Draft) {
  return focusDraft(draft, "edit_instructions");
}

export async function applyEdit(draft: Draft, instruction: string, newContent: string, checks: DraftChecks) {
  const feedback = checkRow(
    await getSupabase()
      .from("draft_feedback")
      .insert({
        restaurant_id: draft.restaurant_id,
        draft_id: draft.id,
        draft_kind: draft.kind,
        kind: "edit",
        note: instruction,
        before_content: draft.content,
        after_content: newContent,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  const updated = await updateDraft(draft.id, {
    content: newContent,
    version: draft.version + 1,
    status: "pending",
    waiting_for: "decision",
    checks,
    check_notes: allNotes(checks),
  });
  // The previous version is kept so UNDO can put it back.
  await logAction({
    restaurantId: draft.restaurant_id,
    draftId: draft.id,
    actor: "owner",
    action: "edited",
    detail: `Edited ${draftName(draft)}: "${instruction.slice(0, 120)}"`,
    data: {
      before_content: draft.content,
      before_version: draft.version,
      before_checks: draft.checks,
      before_check_notes: draft.check_notes,
      feedback_id: feedback.id,
    },
  });
  return updated;
}

export async function skipDraft(draft: Draft) {
  await focusDraft(draft, "skip_reason");
  const skipped = await updateDraft(draft.id, { status: "skipped" });
  await logAction({
    restaurantId: draft.restaurant_id,
    draftId: draft.id,
    actor: "owner",
    action: "skipped",
    detail: `Skipped ${draftName(draft)}`,
    data: { before_status: draft.status, before_waiting_for: draft.waiting_for },
  });
  return skipped;
}

export async function saveSkipReason(draft: Draft, reason: string) {
  check(
    await getSupabase().from("draft_feedback").insert({
      restaurant_id: draft.restaurant_id,
      draft_id: draft.id,
      draft_kind: draft.kind,
      kind: "skip",
      note: reason,
      before_content: draft.content,
    }),
  );
  return updateDraft(draft.id, { waiting_for: null });
}

// What the assistant learns from: recent edits, skip reasons and approved drafts.
export async function getLearningContext(restaurantId: string) {
  const supabase = getSupabase();
  const [feedbackRes, approvedRes] = await Promise.all([
    supabase
      .from("draft_feedback")
      .select("draft_kind, kind, note, before_content, after_content, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(15)
      .returns<Feedback[]>(),
    supabase
      .from("drafts")
      .select("kind, content")
      .eq("restaurant_id", restaurantId)
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(5)
      .returns<{ kind: DraftKind; content: string }[]>(),
  ]);
  return { feedback: check(feedbackRes) ?? [], approved: check(approvedRes) ?? [] };
}
