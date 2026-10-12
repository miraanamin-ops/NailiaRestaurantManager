import "server-only";
import { liveReputation } from "@/lib/agents/reputation";
import type { ReviewInput } from "@/lib/agents/reputation-rules";
import { logAction } from "@/lib/audit";
import { draftByBriefNumber } from "@/lib/brief";
import { check, updateDraft, type Draft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import { buttonsFor, presentNext } from "@/lib/google-jobs";
import { getSupabase } from "@/lib/supabase";
import type { QuestionAnswer } from "./parse";
import type { Turn } from "./turn";

// The owner's answer to a question about a review (Reputation's "needs the
// owner" path): Reply publicly / Handle privately / Both.
//   Handle privately: the review is already marked handled; nothing is drafted.
//   Reply publicly or Both: Reputation writes the reply with that choice in mind,
//   through the checker as usual, and it arrives with Approve / Edit / Skip
//   (a pasted review: the reply to copy into Google).

const CHOICE_WORDS = { public: "reply publicly", private: "handle it privately", both: "reply publicly and contact them privately" };

export async function answerQuestion(turn: Turn, answer: QuestionAnswer, active: Draft | null) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  const draft = answer.draftId
    ? check(await getSupabase().from("drafts").select("*").eq("restaurant_id", r.id).eq("id", answer.draftId).maybeSingle<Draft>())
    : answer.briefNumber
      ? await draftByBriefNumber(r, answer.briefNumber)
      : active;
  if (!draft || draft.kind !== "review_question") return send("I couldn't find that question. Text RUN BRIEF to see what's waiting.");
  if (draft.status !== "pending") return send("That question has already been answered. 👍");

  await updateDraft(draft.id, { status: "answered", waiting_for: null });
  await logAction({
    restaurantId: r.id,
    draftId: draft.id,
    actor: "owner",
    action: "answered",
    detail: `Chose to ${CHOICE_WORDS[answer.choice]} (${draft.audience ?? "a review"})`,
    data: { choice: answer.choice },
  });

  const input = (draft.agent_input ?? {}) as { review?: ReviewInput; source?: string };
  const review = input.review;
  if (answer.choice === "private" || !review) {
    await send(answer.choice === "private" ? `👍 Got it: you'll handle ${review?.author_name ?? "this one"} privately. Nothing will be posted.` : "Sorry, I've lost the review this question was about, so I can't draft a reply.");
    await presentNext(ctx, send);
    return;
  }

  await send(`✍️ Writing a reply to ${review.author_name}'s review…`);
  const pasted = input.source === "pasted";
  const result = await liveReputation(r, review, {
    source: pasted ? "pasted" : "owner_choice",
    draftMode: "present",
    ownerChoice: { choice: answer.choice, question: draft.content },
    createReply: !pasted,
  });
  if (result.kind === "question") return send(draftMessage(result.draft, r), buttonsFor(result.draft));
  const reminder = answer.choice === "both" ? `\n\n_Remember to contact ${review.author_name} privately too._` : "";
  if (pasted || !result.draft) {
    await send(`✍️ Here's the reply. *Copy the next message* and paste it on Google.${reminder}`);
    return send(result.text);
  }
  await send(`${draftMessage(result.draft, r)}${reminder}`, true);
}
