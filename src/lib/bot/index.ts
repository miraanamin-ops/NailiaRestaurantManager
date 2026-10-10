import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { londonWeekday } from "@/lib/clock";
import { releaseQueue } from "@/lib/followups";
import type { Send } from "@/lib/google-jobs";
import { deliverWaitingBrief } from "@/lib/morning";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { runCommand } from "./commands";
import { handleConversation } from "./conversation";
import { photoPost } from "./flows";
import { parseCommand } from "./parse";
import { salesFromMedia, salesReply } from "@/lib/sales/whatsapp";
import { ownerSender } from "./sales-commands";
import { updateRestaurant, type Turn } from "./turn";

// One WhatsApp message from the owner, start to finish. The webhook
// (app/api/whatsapp) has already checked it's from Twilio and from the owner.
//   parse.ts        what was typed or tapped
//   commands.ts     settings and test commands
//   decisions.ts    Approve / Edit / Skip
//   conversation.ts edits, skip reasons and chat with Claude
//   flows.ts        writing, checking and showing each kind of draft
export async function handleMessage(input: {
  restaurantId: string; // found by the webhook from the owner's number
  owner: string;
  sandbox: string;
  body: string;
  buttonPayload: string | undefined;
  media?: { url: string; contentType: string } | null;
}) {
  const { owner, sandbox, body, restaurantId } = input;
  let ctx = await loadRestaurantContext(restaurantId);
  // Belt and braces: only this restaurant's own owner can act on it.
  if (ctx.restaurant.owner_whatsapp !== owner) {
    console.error("handleMessage: the sender isn't this restaurant's owner; ignoring");
    return;
  }
  const channel: OwnerChannel = { restaurantId: ctx.restaurantId, from: sandbox, to: owner };
  const send: Send = (text, withButtons = false, mediaUrl = null) => messageOwner(channel, text, withButtons, { mediaUrl });

  try {
    // The owner number itself is a fixed setting; just remember which of our numbers they're talking to.
    if (ctx.restaurant.whatsapp_from !== sandbox) {
      await updateRestaurant(ctx.restaurantId, { whatsapp_from: sandbox });
      ctx = await loadRestaurantContext(restaurantId);
    }

    const command = input.media ? null : parseCommand(body, londonWeekday(new Date()));

    // This morning's brief was held because the owner hadn't messaged in 24 hours:
    // now they have, so it goes first (unless they're asking for it anyway).
    if (ctx.restaurant.brief_waiting_since && command?.name !== "run_brief") {
      await deliverWaitingBrief(ctx.restaurant, channel, ctx.now);
      ctx = await loadRestaurantContext(restaurantId);
    }

    const turn: Turn = { ctx, channel, owner, send };
    if (input.media) {
      // A till report photo or sales file is saved as sales; any other photo becomes a Google post.
      const outcome = await salesFromMedia(ownerSender(turn), input.media, body, ctx.now);
      if (outcome !== "handled") await photoPost(ctx, input.media, body, send);
    } else if (command) await runCommand(command, turn);
    // YES / REPLACE / a date, answering a till report or sales file question.
    else if (!input.buttonPayload && (await salesReply(ownerSender(turn), body, ctx.now))) {
      // answered
    }
    else await handleConversation(turn, body, input.buttonPayload);

    // Any queued drafts that are now due go out whenever the owner is active.
    const fresh = await loadRestaurantContext(restaurantId);
    if (command?.name !== "time" && command?.name !== "resume") await releaseQueue(fresh.restaurant, fresh.now);
  } catch (err) {
    console.error("Failed to handle message", err);
    await send("Sorry, something went wrong on my side. Please try again in a minute. 🙏");
  }
}
