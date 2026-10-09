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
import { updateRestaurant, type Turn } from "./turn";

// One WhatsApp message from the owner, start to finish. The webhook
// (app/api/whatsapp) has already checked it's from Twilio and from the owner.
//   parse.ts        what was typed or tapped
//   commands.ts     settings and test commands
//   decisions.ts    Approve / Edit / Skip
//   conversation.ts edits, skip reasons and chat with Claude
//   flows.ts        writing, checking and showing each kind of draft
export async function handleMessage(input: {
  owner: string;
  sandbox: string;
  body: string;
  buttonPayload: string | undefined;
  media?: { url: string; contentType: string } | null;
}) {
  const { owner, sandbox, body } = input;
  let ctx = await loadRestaurantContext();
  const channel: OwnerChannel = { restaurantId: ctx.restaurantId, from: sandbox, to: owner };
  const send: Send = (text, withButtons = false) => messageOwner(channel, text, withButtons);

  try {
    // The owner number itself is a fixed setting; just remember which of our numbers they're talking to.
    if (ctx.restaurant.whatsapp_from !== sandbox) {
      await updateRestaurant(ctx.restaurantId, { whatsapp_from: sandbox });
      ctx = await loadRestaurantContext();
    }

    const command = input.media ? null : parseCommand(body, londonWeekday(new Date()));

    // This morning's brief was held because the owner hadn't messaged in 24 hours:
    // now they have, so it goes first (unless they're asking for it anyway).
    if (ctx.restaurant.brief_waiting_since && command?.name !== "run_brief") {
      await deliverWaitingBrief(ctx.restaurant, channel, ctx.now);
      ctx = await loadRestaurantContext();
    }

    const turn: Turn = { ctx, channel, owner, send };
    if (input.media) await photoPost(ctx, input.media, body, send);
    else if (command) await runCommand(command, turn);
    else await handleConversation(turn, body, input.buttonPayload);

    // Any queued drafts that are now due go out whenever the owner is active.
    const fresh = await loadRestaurantContext();
    if (command?.name !== "time" && command?.name !== "resume") await releaseQueue(fresh.restaurant, fresh.now);
  } catch (err) {
    console.error("Failed to handle message", err);
    await send("Sorry, something went wrong on my side. Please try again in a minute. 🙏");
  }
}
