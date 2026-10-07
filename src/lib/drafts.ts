import "server-only";
import { getSupabase } from "@/lib/supabase";

export const DRAFT_KINDS = ["review_reply", "birthday", "promotion", "other"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export type WaitingFor = "decision" | "edit_instructions" | "skip_reason";

export type Draft = {
  id: string;
  restaurant_id: string;
  kind: DraftKind;
  customer_id: string | null;
  review_id: string | null;
  content: string;
  status: "pending" | "approved" | "skipped" | "superseded" | "rejected" | "sent";
  waiting_for: WaitingFor | null;
  audience: string | null;
  request: string | null;
  version: number;
  created_at: string;
};

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
  birthday: "Birthday message",
  promotion: "Offer / promotion",
  other: "Message",
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// For queries that must return exactly one row.
function checkRow<T>(res: { data: T | null; error: { message: string } | null }): T {
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
}) {
  const supabase = getSupabase();
  // Only one draft is "live" at a time: retire anything still waiting.
  check(
    await supabase
      .from("drafts")
      .update({ status: "superseded", waiting_for: null, updated_at: new Date().toISOString() })
      .eq("restaurant_id", input.restaurantId)
      .eq("status", "pending"),
  );
  check(
    await supabase
      .from("drafts")
      .update({ waiting_for: null })
      .eq("restaurant_id", input.restaurantId)
      .not("waiting_for", "is", null),
  );

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
      waiting_for: "decision",
    })
    .select("*")
    .single<Draft>();
  return checkRow(res);
}

async function updateDraft(id: string, fields: Partial<Draft>) {
  const res = await getSupabase()
    .from("drafts")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single<Draft>();
  return checkRow(res);
}

// Approve = mark approved and log a simulated send. Nothing actually goes out yet.
export async function approveDraft(draft: Draft) {
  const supabase = getSupabase();
  await updateDraft(draft.id, { status: "approved", waiting_for: null });
  check(
    await supabase.from("sent_log").insert({
      restaurant_id: draft.restaurant_id,
      draft_id: draft.id,
      customer_id: draft.customer_id,
      channel: draft.kind === "review_reply" ? "google" : "whatsapp",
      recipient: draft.audience,
      content: draft.content,
      status: "sent",
      simulated: true,
    }),
  );
  if (draft.review_id) {
    check(await supabase.from("reviews").update({ replied: true }).eq("id", draft.review_id));
  }
}

export function startEdit(draft: Draft) {
  return updateDraft(draft.id, { waiting_for: "edit_instructions" });
}

export async function applyEdit(draft: Draft, instruction: string, newContent: string) {
  check(
    await getSupabase().from("draft_feedback").insert({
      restaurant_id: draft.restaurant_id,
      draft_id: draft.id,
      draft_kind: draft.kind,
      kind: "edit",
      note: instruction,
      before_content: draft.content,
      after_content: newContent,
    }),
  );
  return updateDraft(draft.id, {
    content: newContent,
    version: draft.version + 1,
    status: "pending",
    waiting_for: "decision",
  });
}

export function skipDraft(draft: Draft) {
  return updateDraft(draft.id, { status: "skipped", waiting_for: "skip_reason" });
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
