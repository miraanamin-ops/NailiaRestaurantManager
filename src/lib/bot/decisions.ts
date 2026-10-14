import "server-only";
import { draftByBriefNumber, remainingInBrief, remainingNote } from "@/lib/brief";
import { approveDraft, check, getLastApprovedDraft, isQuestion, skipDraft, startEdit, type Draft } from "@/lib/drafts";
import { sendResultMessage } from "@/lib/format";
import { presentNext } from "@/lib/google-jobs";
import { attemptSend } from "@/lib/send";
import { gmMode } from "@/lib/agents/gm";
import { approveFact, decideIdea, offerSkipReasons } from "@/lib/agents/gm-live";
import { getSupabase } from "@/lib/supabase";
import type { Action, TargetedAction } from "./parse";
import type { Turn } from "./turn";

// Approve, Edit and Skip. Approving only records the decision; attemptSend
// (lib/send.ts) then checks every safety rule before anything goes out.

// A question about a review isn't approved, edited or skipped: it's answered.
const QUESTION_HINT = (n: number | null, kind = "review_question") =>
  kind === "hours_question"
    ? `That one's a question, not a draft: tap *Same hours*, *Closed* or *Different hours*${n ? ` (or reply SAME ${n}, CLOSED ${n} or DIFFERENT ${n})` : ""}.`
    : `That one's a question, not a draft: tap *Reply publicly*, *Handle privately* or *Both*${n ? ` (or reply PUBLIC ${n}, PRIVATE ${n} or BOTH ${n})` : ""}.`;

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
  if (isQuestion(draft.kind)) return send(QUESTION_HINT(draft.brief_number, draft.kind));
  // The GM's cards: a fact is saved on Approve; a special idea is liked or skipped (never sent).
  if (draft.status === "pending" && draft.kind === "profile_change" && t.action === "approve") return approveFact(turn, draft);
  if (draft.status === "pending" && draft.kind === "special_idea" && t.action !== "edit") return decideIdea(turn, draft, t.action === "approve");

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
  if ((await gmMode(r)) === "live") return offerSkipReasons(send, draft.id);
  return send(`👍 Skipped ${label}. Quick question so I can learn: why didn't this one work? A few words is fine.`);
}

// Approve / Edit / Skip on the draft on screen (an untargeted button, or a typed 1/2/3).
// Returns false if there was nothing for it to act on, so the message is treated as chat.
export async function decideOnScreen(turn: Turn, action: Action, active: Draft | null, fromButton: boolean) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  // The draft that Approve / Edit / Skip would apply to, if any.
  const decisionDraft = active && (active.waiting_for === "decision" || active.waiting_for === "edit_instructions") ? active : null;
  if (decisionDraft && isQuestion(decisionDraft.kind) && decisionDraft.waiting_for === "decision") {
    await send(QUESTION_HINT(null, decisionDraft.kind));
    return true;
  }

  if (decisionDraft?.kind === "profile_change" && action === "approve") {
    await approveFact(turn, decisionDraft);
    return true;
  }
  if (decisionDraft?.kind === "special_idea" && action !== "edit") {
    await decideIdea(turn, decisionDraft, action === "approve");
    return true;
  }
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
    if ((await gmMode(r)) === "live") await offerSkipReasons(send, decisionDraft.id);
    else await send("👍 Skipped. Quick question so I can learn: why didn't this one work? A few words is fine.");
    return true;
  }
  if (fromButton) {
    await send("That draft isn't waiting for an answer any more. Ask me for a new one any time!");
    return true;
  }
  return false;
}
