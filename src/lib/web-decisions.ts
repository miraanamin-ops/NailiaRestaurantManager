import "server-only";
import { logAction } from "@/lib/audit";
import { decidableOnWeb, plainText } from "@/lib/dashboard/rules";
import { approveDraft, check, saveSkipReason, updateDraft, type Draft } from "@/lib/drafts";
import { sendResultMessage } from "@/lib/format";
import { attemptSend } from "@/lib/send";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";

// Approve and Skip from the owner's web pages. The same path as APPROVE ALL on
// WhatsApp: approving only records the decision, then attemptSend (lib/send.ts)
// runs every safety rule before anything goes out. Only the owner's own
// restaurant's drafts, only drafts still waiting, and only kinds that don't need
// a WhatsApp conversation (questions, facts, ideas, rotas stay on WhatsApp).

export type WebDecision = { ok: boolean; message: string };

export async function decideFromWeb(
  owner: { restaurantIds: string[] },
  restaurantId: string,
  draftId: string,
  action: "approve" | "skip",
  reason?: string,
): Promise<WebDecision> {
  if (!owner.restaurantIds.includes(restaurantId)) return { ok: false, message: "That isn't one of your restaurants." };
  const supabase = getSupabase();
  const [restaurant, draft] = await Promise.all([
    supabase.from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>().then(check),
    supabase.from("drafts").select("*").eq("id", draftId).eq("restaurant_id", restaurantId).maybeSingle<Draft>().then(check),
  ]);
  if (!restaurant || !draft) return { ok: false, message: "Sorry, I couldn't find that draft." };
  if (draft.status !== "pending") return { ok: false, message: `That one isn't waiting any more (it was ${draft.status}).` };
  if (!decidableOnWeb(draft as Draft & { business_review_id?: string | null })) {
    return { ok: false, message: "That one needs your answer on WhatsApp." };
  }

  if (action === "approve") {
    const approved = await approveDraft(draft);
    const result = await attemptSend(approved.id, restaurant, restaurantNow(restaurant), "approve");
    return { ok: result.outcome !== "blocked", message: plainText(sendResultMessage(result)) };
  }

  // Skip: no WhatsApp question about why (the web asks here, optionally).
  await updateDraft(draft.id, { status: "skipped", waiting_for: null });
  await logAction({
    restaurantId,
    draftId: draft.id,
    actor: "owner",
    action: "skipped",
    detail: `Skipped ${draft.kind.replace(/_/g, " ")} on the website`,
    data: { before_status: draft.status, before_waiting_for: draft.waiting_for },
  });
  const why = reason?.trim().slice(0, 500);
  if (why) await saveSkipReason(draft, why);
  return { ok: true, message: why ? "Skipped. Thanks, I'll learn from that." : "Skipped. Nothing was sent." };
}
