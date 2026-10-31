import "server-only";
import { getSupabase } from "@/lib/supabase";
import type { FlowStepKey } from "../flow";
import type { Channel } from "../sessions";
import { emailGoogleSteps, googleInvited } from "./google-step";
import { applyToneDefaults, queueToneReplies, saveToneChoice } from "./tone-step";
import { GOOGLE_ACTIONS, QUEUE_ACTIONS } from "./view";

// Taps that code acts on before Dina answers, the same on the web and WhatsApp:
// the Google steps' two buttons, a tone card, and the offer to queue replies.
// What code did comes back as a note for Dina, so she says it and carries on in
// the same single Claude call. Any other tap is just the owner's answer.

// externalId: the tap's own id (Twilio's, or the web chat's): a repeat does nothing twice.
export async function handleAnswer(input: { restaurantId: string; messageId: string; choiceId: string; channel: Channel; externalId?: string | null }): Promise<string | null> {
  if (input.externalId) {
    const { count } = await getSupabase()
      .from("onboarding_messages")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", input.restaurantId)
      .eq("external_id", input.externalId);
    if (count) return null;
  }
  const { data } = await getSupabase()
    .from("onboarding_messages")
    .select("parts")
    .eq("restaurant_id", input.restaurantId)
    .eq("id", input.messageId)
    .eq("role", "dina")
    .maybeSingle<{ parts: unknown[] | null }>();
  const part = (data?.parts?.[0] ?? null) as { type?: string; voice?: string } | null;
  switch (part?.type) {
    case "google_steps":
      if (input.choiceId === GOOGLE_ACTIONS.invited) return googleInvited(input.restaurantId, input.channel);
      if (input.choiceId === GOOGLE_ACTIONS.emailSteps) return emailGoogleSteps(input.restaurantId);
      return null;
    case "tone_choices":
      return saveToneChoice(input.restaurantId, part.voice === "complaint" ? "complaint" : "praise", { tone: input.choiceId }, input.channel);
    case "queue_replies":
      return input.choiceId === QUEUE_ACTIONS.yes ? queueToneReplies(input.restaurantId) : "The owner said no to queueing those replies. That's fine: carry on.";
    default:
      return null;
  }
}

// After a step is skipped (the button, "skip" on WhatsApp, or Dina's skip_step):
// a skipped tone means Warm and personal for now.
export async function afterSkip(restaurantId: string, step: FlowStepKey) {
  if (step === "tone") await applyToneDefaults(restaurantId);
}
