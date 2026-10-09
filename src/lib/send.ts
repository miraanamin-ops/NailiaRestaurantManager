import "server-only";
import { formatLondon, formatWindow, isInSendWindow, nextWindowStart } from "@/lib/clock";
import { overCap } from "@/lib/discounts";
import { check, getDraft, updateDraft, type Draft } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The safety rules. Plain code only: every send goes through attemptSend,
// which checks each rule right before anything is marked as sent.

export type BlockReason = "not_approved" | "duplicate" | "discount_cap" | "paused" | "outside_window";

export type SendResult =
  | { outcome: "sent"; draft: Draft }
  | { outcome: "queued"; reason: "paused" | "outside_window"; scheduledFor: Date | null; detail: string; draft: Draft }
  | { outcome: "blocked"; reason: "not_approved" | "duplicate" | "discount_cap"; detail: string; draft: Draft };

// approve: the owner tapped Approve. queue: a held draft being retried. test: the TEST SEND command.
export type SendSource = "approve" | "queue" | "test";

const SENDABLE_STATUSES = ["approved", "queued", "blocked"] as const;

async function logBlock(draft: Draft, reason: BlockReason, detail: string) {
  const { error } = await getSupabase().from("blocked_sends").insert({
    restaurant_id: draft.restaurant_id,
    draft_id: draft.id,
    reason,
    detail,
  });
  if (error) console.error("Failed to log blocked send", error);
}

export async function attemptSend(draftId: string, restaurant: Restaurant, now: Date, source: SendSource): Promise<SendResult> {
  const supabase = getSupabase();
  const draft = await getDraft(draftId);

  // Rule: a draft can only be sent once.
  if (draft.status === "sent" || draft.sent_at) {
    const detail = `Already sent${draft.sent_at ? ` (${formatLondon(new Date(draft.sent_at))})` : ""}. Duplicates are blocked.`;
    await logBlock(draft, "duplicate", detail);
    return { outcome: "blocked", reason: "duplicate", detail, draft };
  }
  if (draft.status === "queued" && source === "approve") {
    const when = draft.scheduled_for ? `for ${formatLondon(new Date(draft.scheduled_for))}` : "until you text RESUME";
    const detail = `Already approved and queued ${when}. It will only go out once.`;
    await logBlock(draft, "duplicate", detail);
    return { outcome: "blocked", reason: "duplicate", detail, draft };
  }

  // Rule: nothing sends without an Approve.
  if (!draft.approved_at || !(SENDABLE_STATUSES as readonly string[]).includes(draft.status)) {
    const detail = `Draft hasn't been approved (status: ${draft.status}).`;
    await logBlock(draft, "not_approved", detail);
    return { outcome: "blocked", reason: "not_approved", detail, draft };
  }

  // Rule: no discount above the restaurant's cap.
  const over = overCap(draft.content, restaurant.discount_cap_percent);
  if (over) {
    const detail = `Offers ${over.percent}% off ("${over.phrase}"), above the ${restaurant.discount_cap_percent}% cap.`;
    const updated = await updateDraft(draft.id, { status: "blocked", block_reason: detail, scheduled_for: null });
    await logBlock(draft, "discount_cap", detail);
    return { outcome: "blocked", reason: "discount_cap", detail, draft: updated };
  }

  // Rule: nothing sends while PAUSED. Held until RESUME.
  if (restaurant.paused) {
    const detail = "Sending is paused. Held until RESUME.";
    const updated = await updateDraft(draft.id, { status: "queued", scheduled_for: null, block_reason: detail });
    await logBlock(draft, "paused", detail);
    return { outcome: "queued", reason: "paused", scheduledFor: null, detail, draft: updated };
  }

  // Rule: only send inside the window (9am–9pm UK time by default).
  if (!isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end)) {
    const at = nextWindowStart(now, restaurant.send_window_start);
    const detail = `Outside sending hours (${formatWindow(restaurant.send_window_start, restaurant.send_window_end)}, it's ${formatLondon(now)}). Queued for ${formatLondon(at)}.`;
    const updated = await updateDraft(draft.id, { status: "queued", scheduled_for: at.toISOString(), block_reason: detail });
    await logBlock(draft, "outside_window", detail);
    return { outcome: "queued", reason: "outside_window", scheduledFor: at, detail, draft: updated };
  }

  // All rules passed. Claim the draft in one atomic update so that two sends
  // racing each other can't both succeed.
  const claim = await supabase
    .from("drafts")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      scheduled_for: null,
      block_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .in("status", [...SENDABLE_STATUSES])
    .is("sent_at", null)
    .select("*")
    .maybeSingle<Draft>();
  const claimed = check(claim);
  if (!claimed) {
    const detail = "Another send of this draft got there first. Duplicates are blocked.";
    await logBlock(draft, "duplicate", detail);
    return { outcome: "blocked", reason: "duplicate", detail, draft };
  }

  // Simulated send: logged only, nothing goes to customers or Google yet.
  const { error: logError } = await supabase.from("sent_log").insert({
    restaurant_id: claimed.restaurant_id,
    draft_id: claimed.id,
    customer_id: claimed.customer_id,
    channel: claimed.kind === "review_reply" ? "google" : "whatsapp",
    recipient: claimed.audience,
    content: claimed.content,
    status: "sent",
    simulated: true,
  });
  // 23505 = the database's one-row-per-draft guard caught a duplicate.
  if (logError && logError.code === "23505") await logBlock(claimed, "duplicate", "Sent log already has this draft.");
  else if (logError) throw new Error(logError.message);

  if (claimed.review_id) {
    check(await supabase.from("reviews").update({ replied: true }).eq("id", claimed.review_id));
  }
  return { outcome: "sent", draft: claimed };
}

// Retries queued drafts that are due. Returns what happened to each one.
export async function processQueue(restaurant: Restaurant, now: Date) {
  if (restaurant.paused) return [];
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("status", "queued")
    .order("approved_at")
    .returns<Draft[]>();
  const due = (check(res) ?? []).filter((d) => !d.scheduled_for || new Date(d.scheduled_for) <= now);
  const results: SendResult[] = [];
  for (const d of due) results.push(await attemptSend(d.id, restaurant, now, "queue"));
  return results;
}
