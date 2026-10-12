import "server-only";
import { logAction } from "@/lib/audit";
import { draftByBriefNumber } from "@/lib/brief";
import { check, updateDraft, type Draft } from "@/lib/drafts";
import { presentNext } from "@/lib/google-jobs";
import { parseHoursText } from "@/lib/onboarding/profile-data";
import { saveProfileFields } from "@/lib/profile-edits";
import { getSupabase } from "@/lib/supabase";
import type { HoursAnswer } from "./parse";
import type { Turn } from "./turn";

// The owner's answer to "Christmas Day is in 3 weeks. Are your hours changing?"
//   Same hours:      saved as "usual" for that date (so we don't ask again).
//   Closed:          saved as Closed.
//   Different hours: we ask for the hours, then save them.
// Saving goes through saveProfileFields like any other change (logged, UNDO works),
// and the profile change brings Visibility's matching Google update.

type HolidayInput = { date: string; title: string };

const holidayOf = (draft: Draft) => (draft.agent_input ?? {}) as Partial<HolidayInput>;

async function saveSpecialHours(turn: Turn, draft: Draft, hours: string) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  const { date, title } = holidayOf(draft);
  if (!date) return send("Sorry, I've lost which day that question was about.");
  const current = (r.special_hours ?? {}) as Record<string, { label?: string | null; hours: string }>;
  await saveProfileFields(r, { special_hours: { ...current, [date]: { label: title ?? null, hours } } }, `${title ?? date}: ${hours === "usual" ? "usual hours" : hours}`);
  await updateDraft(draft.id, { status: "answered", waiting_for: null });
  await logAction({ restaurantId: r.id, draftId: draft.id, actor: "owner", action: "answered", detail: `${title ?? date}: ${hours === "usual" ? "same hours as usual" : hours}`, data: { date, hours } });
  await send(
    hours === "usual"
      ? `👍 Noted: usual hours on ${title ?? date}. Nothing changes on Google.`
      : `👍 Saved: ${title ?? date}, ${hours === "Closed" ? "closed" : hours}. I'll draft the matching Google update for you to approve. Text UNDO to take it back.`,
  );
  await presentNext(ctx, send);
}

export async function answerHoursQuestion(turn: Turn, answer: HoursAnswer, active: Draft | null) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  const draft = answer.draftId
    ? check(await getSupabase().from("drafts").select("*").eq("restaurant_id", r.id).eq("id", answer.draftId).maybeSingle<Draft>())
    : answer.briefNumber
      ? await draftByBriefNumber(r, answer.briefNumber)
      : active;
  if (!draft || draft.kind !== "hours_question") return send("I couldn't find that question. Text RUN BRIEF to see what's waiting.");
  if (draft.status !== "pending") return send("That question has already been answered. 👍");

  if (answer.choice === "same") return saveSpecialHours(turn, draft, "usual");
  if (answer.choice === "closed") return saveSpecialHours(turn, draft, "Closed");
  // Different hours: this question goes on screen, waiting for the hours.
  await updateDraft(draft.id, { waiting_for: "edit_instructions" });
  return send(`🕒 What will your hours be on ${holidayOf(draft).title ?? "that day"}? For example *12:00 – 18:00* or *12-6pm*.`);
}

// The hours typed after "Different hours".
export async function hoursForQuestion(turn: Turn, draft: Draft, body: string) {
  const hours = parseHoursText(body);
  if (!hours) return turn.send("Sorry, I couldn't read those hours. Try something like *12:00 – 18:00*, *12-6pm* or *closed*.");
  return saveSpecialHours(turn, draft, hours);
}
