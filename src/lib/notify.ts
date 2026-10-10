import "server-only";
import { getSupabase } from "@/lib/supabase";
import { sendImage, sendText, sendWithApprovalButtons, type ButtonTarget } from "@/lib/whatsapp";

export type OwnerChannel = { restaurantId: string; from: string; to: string };

// Sends a WhatsApp message to the owner and records it in the messages table.
// (Messages to the owner aren't customer sends, so the safety rules don't apply.)
// withButtons: true = Approve / Edit / Skip for the draft on screen; a target = for that one draft.
// mediaUrl: a picture sent just before the text (e.g. the preview of an email draft).
export async function messageOwner(
  channel: OwnerChannel,
  text: string,
  withButtons: boolean | ButtonTarget = false,
  { mediaUrl = null }: { mediaUrl?: string | null } = {},
) {
  if (mediaUrl) await sendAndLog(channel, () => sendImage(channel.from, channel.to, mediaUrl, "📧 How the email will look:"), "[email preview image]");
  await sendAndLog(
    channel,
    () => (withButtons ? sendWithApprovalButtons(channel.from, channel.to, text, withButtons === true ? undefined : withButtons) : sendText(channel.from, channel.to, text)),
    text,
  );
}

async function sendAndLog(channel: OwnerChannel, deliver: () => Promise<{ sid: string; body: string }>, text: string) {
  let sid: string | null = null;
  let sentBody = text;
  let error: string | null = null;
  try {
    const sent = await deliver();
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
