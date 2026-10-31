import "server-only";
import { getSupabase } from "@/lib/supabase";
import type { FlowStepKey } from "../flow";
import type { Channel } from "../sessions";
import { confirmHours } from "./facts-step";
import { emailGoogleSteps, googleInvited } from "./google-step";
import { allergenTap, confirmMenu } from "./menu-step";
import type { DinaReply } from "./reply";
import { applyToneDefaults, queueToneReplies, saveToneChoice } from "./tone-step";
import { ALLERGEN_ACTIONS, GOOGLE_ACTIONS, QUEUE_ACTIONS } from "./view";

// Taps that code acts on before Dina answers, the same on the web and WhatsApp:
// the Google steps' two buttons, a tone card, the offer to queue replies, "Looks
// right" on the hours and menu cards, and the allergen cards. What code did comes
// back as a note for Dina, so she says it and carries on in the same single Claude
// call; or, for an allergen card, as code's own next card (no Claude call at all).
// Any other tap is just the owner's answer.

export type AnswerOutcome = string | null | { reply: DinaReply["messages"] };

// The card a message carried (its first part), if it's this restaurant's Dina message.
export async function answeredPart(restaurantId: string, messageId: string) {
  const { data } = await getSupabase()
    .from("onboarding_messages")
    .select("parts")
    .eq("restaurant_id", restaurantId)
    .eq("id", messageId)
    .eq("role", "dina")
    .maybeSingle<{ parts: unknown[] | null }>();
  return (data?.parts?.[0] ?? null) as { type?: string; voice?: string; card?: string; dish?: string } | null;
}

// externalId: the tap's own id (Twilio's, or the web chat's): a repeat does nothing twice.
export async function handleAnswer(input: { restaurantId: string; messageId: string; choiceId: string; channel: Channel; externalId?: string | null }): Promise<AnswerOutcome> {
  if (input.externalId) {
    const { count } = await getSupabase()
      .from("onboarding_messages")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", input.restaurantId)
      .eq("external_id", input.externalId);
    if (count) return null;
  }
  const part = await answeredPart(input.restaurantId, input.messageId);
  switch (part?.type) {
    case "google_steps":
      if (input.choiceId === GOOGLE_ACTIONS.invited) return googleInvited(input.restaurantId, input.channel);
      if (input.choiceId === GOOGLE_ACTIONS.emailSteps) return emailGoogleSteps(input.restaurantId);
      return null;
    case "tone_choices":
      return saveToneChoice(input.restaurantId, part.voice === "complaint" ? "complaint" : "praise", { tone: input.choiceId }, input.channel);
    case "queue_replies":
      return input.choiceId === QUEUE_ACTIONS.yes ? queueToneReplies(input.restaurantId) : "The owner said no to queueing those replies. That's fine: carry on.";
    case "editable_card":
      // "Looks right" as it is (changes go to Dina in the owner's words).
      if (input.choiceId !== "confirm") return null;
      if (part.card === "hours") return confirmHours(input.restaurantId, input.channel);
      if (part.card === "menu") return confirmMenu(input.restaurantId, input.channel);
      return null;
    case "allergen_check": {
      if (!part.dish) return null;
      if (input.choiceId === ALLERGEN_ACTIONS.change) return `The owner wants to change the allergens for this dish (${part.dish.split("::")[1]}). Ask which of the 14 it has, then save exactly what they say with set_allergens.`;
      const choice = input.choiceId === ALLERGEN_ACTIONS.ok ? "ok" : input.choiceId === ALLERGEN_ACTIONS.unsure ? "unsure" : input.choiceId === ALLERGEN_ACTIONS.later ? "later" : null;
      if (!choice) return null;
      const out = await allergenTap(input.restaurantId, part.dish, choice, input.channel);
      return "next" in out ? { reply: [{ text: out.next.text, component: { type: "allergen_check" } }] } : out.note;
    }
    default:
      return null;
  }
}

// After a step is skipped (the button, "skip" on WhatsApp, or Dina's skip_step):
// a skipped tone means Warm and personal for now.
export async function afterSkip(restaurantId: string, step: FlowStepKey) {
  if (step === "tone") await applyToneDefaults(restaurantId);
}
