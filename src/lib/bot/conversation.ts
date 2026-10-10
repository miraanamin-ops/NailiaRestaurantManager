import "server-only";
import { chat, rewriteDraft, type StoredMessage } from "@/lib/assistant";
import { getActiveDraft, getLearningContext, saveSkipReason } from "@/lib/drafts";
import { presentNext } from "@/lib/google-jobs";
import { getRestaurant } from "@/lib/onboarding/store";
import { applyProfileChanges } from "@/lib/profile-edits";
import { getSupabase } from "@/lib/supabase";
import { decideOnScreen, decideTargeted } from "./decisions";
import { campaignCreateAndSend, checkCreateAndSend, pastedReviewReply, reviseAndSend, reviseCampaignAndSend } from "./flows";
import { parseAction, parseTargetedAction } from "./parse";
import type { Turn } from "./turn";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;

// Anything that isn't a command: a decision, an edit, a skip reason, or a chat with Claude.
export async function handleConversation(turn: Turn, body: string, buttonPayload: string | undefined) {
  const { ctx, owner, send } = turn;
  const targeted = parseTargetedAction(buttonPayload, body);
  if (targeted) return decideTargeted(turn, targeted);

  const [active, learning] = await Promise.all([getActiveDraft(ctx.restaurantId), getLearningContext(ctx.restaurantId)]);
  const action = parseAction(buttonPayload, body);
  if (action && (await decideOnScreen(turn, action, active, Boolean(buttonPayload)))) return;

  // The owner is telling us what to change.
  if (active?.waiting_for === "edit_instructions") {
    if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, body, send);
    const rewritten = await rewriteDraft(ctx, learning, active, body);
    return reviseAndSend(ctx, active, body, rewritten, send);
  }

  // The owner is telling us why they skipped.
  if (active?.waiting_for === "skip_reason") {
    await saveSkipReason(active, body);
    await send("Thanks, noted. I'll keep that in mind for next time. 🙏");
    await presentNext(ctx, send);
    return;
  }

  // Anything else: a normal chat, which may produce a new or revised draft.
  const { data: rows, error } = await getSupabase()
    .from("messages")
    .select("direction, body, status")
    // This restaurant's own conversation only.
    .eq("restaurant_id", ctx.restaurantId)
    // Quoted because numbers look like "whatsapp:+44…" and ":" is special in this filter.
    .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT)
    .returns<StoredMessage[]>();
  if (error) throw new Error(error.message);

  const result = await chat(ctx, learning, active, (rows ?? []).reverse());
  if (result.type === "draft") {
    return checkCreateAndSend(
      ctx,
      { kind: result.kind, content: result.content, audience: result.audience, request: body, reviewId: result.reviewId, customerId: result.customerId },
      send,
    );
  }
  if (result.type === "campaign") return campaignCreateAndSend(ctx, result.fields, body, send);
  if (result.type === "pasted_review") return pastedReviewReply(ctx, result, send);
  if (result.type === "profile_changes") return send(await applyProfileChanges(await getRestaurant(ctx.restaurantId), result.changes));
  if (result.type === "revise" && active?.waiting_for === "decision") {
    if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, result.instruction, send);
    return reviseAndSend(ctx, active, result.instruction, result.content, send);
  }
  if (result.type === "text") return send(result.text);
  return send("Sorry, I lost track of that draft. Could you ask again?");
}
