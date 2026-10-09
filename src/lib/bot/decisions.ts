import "server-only";
import { draftByBriefNumber, remainingInBrief, remainingNote } from "@/lib/brief";
import { approveDraft, check, getLastApprovedDraft, skipDraft, startEdit, type Draft } from "@/lib/drafts";
import { sendResultMessage } from "@/lib/format";
import { presentNext } from "@/lib/google-jobs";
import { attemptSend } from "@/lib/send";
import { getSupabase } from "@/lib/supabase";
import type { Action, TargetedAction } from "./parse";
import type { Turn } from "./turn";

// Approve, Edit and Skip. Approving only records the decision; attemptSend
// (lib/send.ts) then checks every safety rule before anything goes out.

// A second tap on Approve within this long counts as a duplicate attempt.
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

// A button on a brief item, or "APPROVE 2" / "EDIT 2" / "SKIP 2".
export async function decideTargeted(turn: Turn, t: TargetedAction) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  const draft = t.draftId
    ? check(await getSupabase().from("drafts").select("*").eq("id", t.draftId).eq("restaurant_id", r.id).maybeSingle<Draft>())
    : await draftByBriefNumber(r, t.briefNumber!);
  if (!draft) {
    return send(t.briefNumber ? `I can't find item ${t.briefNumber} in your latest brief. Text RUN BRIEF to see it again.` : "Sorry, I couldn't find that draft.");
  }
  const label = draft.brief_number ? `item ${draft.brief_number}` : "that draft";

  if (draft.status !== "pending") {
    // A second Approve on something already approved: the rules decide (and log) it.
    if (t.action === "approve" && draft.approved_at) {
      return send(sendResultMessage(await attemptSend(draft.id, r, ctx.now, "approve")));
    }
    return send(`${label[0].toUpperCase()}${label.slice(1)} isn't waiting any more (it was ${draft.status}).`);
  }

  if (t.action === "approve") {
    const wasOnScreen = draft.waiting_for !== null;
    const approved = await approveDraft(draft);
    const result = sendResultMessage(await attemptSend(approved.id, r, ctx.now, "approve"));
    await send(`${draft.brief_number ? `*${draft.brief_number}.* ` : ""}${result}${draft.briefed_at ? remainingNote(await remainingInBrief(r)) : ""}`);
    if (wasOnScreen) await presentNext(ctx, send);
    return;
  }
  if (t.action === "edit") {
    await startEdit(draft);
    return send(`✏️ What would you like me to change in ${label}?`);
  }
  await skipDraft(draft);
  return send(`👍 Skipped ${label}. Quick question so I can learn: why didn't this one work? A few words is fine.`);
}

// Approve / Edit / Skip on the draft on screen (an untargeted button, or a typed 1/2/3).
// Returns false if there was nothing for it to act on, so the message is treated as chat.
export async function decideOnScreen(turn: Turn, action: Action, active: Draft | null, fromButton: boolean) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  // The draft that Approve / Edit / Skip would apply to, if any.
  const decisionDraft = active && (active.waiting_for === "decision" || active.waiting_for === "edit_instructions") ? active : null;

  if (action === "approve") {
    if (decisionDraft) {
      const approved = await approveDraft(decisionDraft);
      await send(sendResultMessage(await attemptSend(approved.id, r, ctx.now, "approve")));
      await presentNext(ctx, send);
      return true;
    }
    // A second tap on an already-approved draft: the rules decide (and log) it.
    const last = await getLastApprovedDraft(r.id);
    if (last && Date.now() - new Date(last.approved_at!).getTime() < DUPLICATE_WINDOW_MS) {
      await send(sendResultMessage(await attemptSend(last.id, r, ctx.now, "approve")));
      return true;
    }
  } else if (decisionDraft && action === "edit") {
    await startEdit(decisionDraft);
    await send("✏️ What would you like me to change?");
    return true;
  } else if (decisionDraft && action === "skip") {
    await skipDraft(decisionDraft);
    await send("👍 Skipped. Quick question so I can learn: why didn't this one work? A few words is fine.");
    return true;
  }
  if (fromButton) {
    await send("That draft isn't waiting for an answer any more. Ask me for a new one any time!");
    return true;
  }
  return false;
}
