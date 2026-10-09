import "server-only";
import { getSupabase } from "@/lib/supabase";
import { sendText, sendWithApprovalButtons, type ButtonTarget } from "@/lib/whatsapp";

export type OwnerChannel = { restaurantId: string; from: string; to: string };

// Sends a WhatsApp message to the owner and records it in the messages table.
// (Messages to the owner aren't customer sends, so the safety rules don't apply.)
// withButtons: true = Approve / Edit / Skip for the draft on screen; a target = for that one draft.
export async function messageOwner(channel: OwnerChannel, text: string, withButtons: boolean | ButtonTarget = false) {
  let sid: string | null = null;
  let sentBody = text;
  let error: string | null = null;
  try {
    const sent = withButtons
      ? await sendWithApprovalButtons(channel.from, channel.to, text, withButtons === true ? undefined : withButtons)
      : await sendText(channel.from, channel.to, text);
    sid = sent.sid;
    sentBody = sent.body;
  } catch (err) {
    console.error("Failed to send WhatsApp message", err);
    error = `Twilio: ${err instanceof Error ? err.message : String(err)}`;
  }
  const { error: logError } = await getSupabase().from("messages").insert({
    restaurant_id: channel.restaurantId,
    direction: "outbound",
    from_number: channel.from,
    to_number: channel.to,
    body: sentBody,
    twilio_sid: sid,
    status: sid ? "sent" : "failed",
    error,
  });
  if (logError) console.error("Failed to log outbound message", logError);
}
