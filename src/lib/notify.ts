import "server-only";
import { ON_IT_LINES } from "@/lib/agents/gm-rules";
import { getSupabase } from "@/lib/supabase";
import type { OpenerRequest } from "@/lib/openers";
import { isPlaceholderNumber } from "@/lib/switches";
import { sendImage, sendText, sendWithApprovalButtons, type ButtonTarget } from "@/lib/whatsapp";
import { APP_ADDRESS, chatButtons, chatDraftId, type ChatButton, type ChatMessage, type ChatMeta } from "@/lib/app/chat-rules";

// The app's Chat tab (lib/app/chat.ts): every message to the owner is collected here
// and logged, never sent to WhatsApp. owner = the number the conversation is logged under.
// onIt: the app already showed "On it" for this turn (lib/app/chat.ts), so the GM's
// own late "On it" (gm-live withOnIt) isn't added a second time.
export type AppSink = { owner: string; messages: ChatMessage[]; onIt?: boolean };
export type OwnerChannel = { restaurantId: string; from: string; to: string; app?: AppSink };

// Sends a WhatsApp message to the owner and records it in the messages table.
// (Messages to the owner aren't customer sends, so the safety rules don't apply.)
// withButtons: true = Approve / Edit / Skip for the draft on screen; a target = for that one draft.
// mediaUrl: a picture sent just before the text (e.g. the preview of an email draft), with mediaCaption under it.
// opener: set by anything DinerAI sends on its own (not a reply to the owner). If the
// owner hasn't messaged in 24 hours it's held, and that template opens the chat
// (lib/outbox.ts, lib/openers.ts). Demo restaurants on placeholder numbers never hold.
export async function messageOwner(
  channel: OwnerChannel,
  text: string,
  withButtons: boolean | ButtonTarget = false,
  {
    mediaUrl = null,
    mediaCaption = "📧 How the email will look:",
    opener,
  }: { mediaUrl?: string | null; mediaCaption?: string; opener?: OpenerRequest } = {},
) {
  if (channel.app) {
    const onScreen = withButtons === true ? ((await (await import("@/lib/drafts")).getActiveDraft(channel.restaurantId))?.id ?? null) : null;
    const m = appMedia(text, mediaUrl, mediaCaption);
    return toApp(channel, channel.app, m.text, { buttons: chatButtons(withButtons), draftId: chatDraftId(withButtons, onScreen), image: m.image }).catch((err) => console.error("Failed to log an app message", err));
  }
  // An owner with no WhatsApp, on the app (followups.ownerChannel): logged in the app's
  // Chat, with a notification for anything DinerAI sends on its own. Never Twilio.
  if (channel.to === APP_ADDRESS) {
    if (opener && text) {
      const { pushInsteadOfWhatsApp } = await import("@/lib/push");
      await pushInsteadOfWhatsApp(channel.restaurantId, text, opener).catch((err) => console.error("App notification failed", err));
    }
    const onScreen = withButtons === true ? ((await (await import("@/lib/drafts")).getActiveDraft(channel.restaurantId))?.id ?? null) : null;
    const m = appMedia(text, mediaUrl, mediaCaption);
    return toApp(channel, { owner: APP_ADDRESS, messages: [] }, m.text, { buttons: chatButtons(withButtons), draftId: chatDraftId(withButtons, onScreen), image: m.image }).catch((err) => console.error("Failed to log an app message", err));
  }
  // The owner has the app: a notification instead of WhatsApp (the draft itself is in
  // the app's Inbox). If Expo can't be reached, WhatsApp carries on as before.
  if (opener && text && !isPlaceholderNumber(channel.to)) {
    const { pushInsteadOfWhatsApp } = await import("@/lib/push");
    const pushed = await pushInsteadOfWhatsApp(channel.restaurantId, text, opener).catch((err) => {
      console.error("App notification failed; using WhatsApp", err);
      return false;
    });
    if (pushed) return;
  }
  if (opener && (text || mediaUrl) && !isPlaceholderNumber(channel.to)) {
    const { sendOrHold } = await import("@/lib/outbox");
    if (!(await sendOrHold(channel, { text, withButtons, mediaUrl, mediaCaption }, opener))) return;
  }
  if (mediaUrl) await sendAndLog(channel, () => sendImage(channel.from, channel.to, mediaUrl, mediaCaption), "[image] " + mediaCaption);
  if (!text) return;
  await sendAndLog(
    channel,
    () => (withButtons ? sendWithApprovalButtons(channel.from, channel.to, text, withButtons === true ? undefined : withButtons) : sendText(channel.from, channel.to, text)),
    text,
  );
}

// What a picture or file becomes in the app's chat (15 Nov): a photo shows as itself; a
// file that isn't a picture (the rota's PDF) is its caption and a tappable link, never
// "[image]"; the old picture of an email is dropped (its card has "See the email").
export function appMedia(text: string, mediaUrl: string | null, caption: string): { text: string; image: string | null } {
  if (!mediaUrl) return { text, image: null };
  if (/\/api\/email-preview\//.test(mediaUrl)) return { text, image: null };
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(mediaUrl) || /\/storage\/v1\/object\//.test(mediaUrl)) return { text, image: mediaUrl };
  return { text: [text || caption, mediaUrl].filter(Boolean).join("\n"), image: null };
}

// A message for the app's chat: collected for the answer, and logged with what it carries.
async function toApp(channel: OwnerChannel, sink: AppSink, text: string, meta: ChatMeta) {
  if (!text && !meta.image) return;
  if (sink.onIt && (Object.values(ON_IT_LINES) as string[]).includes(text)) return;
  sink.messages.push({ text, ...meta });
  await logAppMessage(channel.restaurantId, {
    direction: "outbound",
    from_number: APP_ADDRESS,
    to_number: sink.owner,
    body: text || "Photo",
    twilio_sid: `app-${crypto.randomUUID()}`,
    status: "sent",
    app: meta,
  });
}

// Logs an app message. Before migration 066 there's no app column: logged without it.
export async function logAppMessage(restaurantId: string, row: Record<string, unknown>) {
  const supabase = getSupabase();
  let { error } = await supabase.from("messages").insert({ ...row, restaurant_id: restaurantId });
  if (error?.code === "42703") ({ error } = await supabase.from("messages").insert({ ...row, restaurant_id: restaurantId, app: undefined }));
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
}

// Sends one message to the owner (deliver does the Twilio call) and logs it, sent or failed.
// In the app (channel.app) nothing is delivered: the words, with appButtons as quick replies, go to the chat.
export async function sendAndLog(channel: OwnerChannel, deliver: () => Promise<{ sid: string; body: string }>, text: string, appButtons: ChatButton[] = []) {
  if (channel.app || channel.to === APP_ADDRESS) {
    return toApp(channel, channel.app ?? { owner: APP_ADDRESS, messages: [] }, text, { buttons: appButtons }).catch((err) => console.error("Failed to log an app message", err));
  }
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
