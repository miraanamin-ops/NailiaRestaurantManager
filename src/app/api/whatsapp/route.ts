import { after, type NextRequest } from "next/server";
import twilio from "twilio";
import { handleMessage } from "@/lib/bot";
import { findLinkCode } from "@/lib/onboarding/steps";
import { handleOnboardingMessage, linkFromWhatsApp, onboardingInProgress } from "@/lib/onboarding/whatsapp-flow";
import { findStaff } from "@/lib/sales/staff";
import { handleStaffMessage } from "@/lib/sales/whatsapp";
import { linkSignupNumber, pendingSignupsFor } from "@/lib/onboarding/entry";
import { getSupabase } from "@/lib/supabase";
import { alertBuilder } from "@/lib/builder-alerts";
import { handleBuilderCommand } from "@/lib/feeds/builder";
import { isBuilderCommand, isBuilderNumber } from "@/lib/feeds/builder-parse";
import { sendText } from "@/lib/whatsapp";
import { messageOwner } from "@/lib/notify";
import { kickWorkers } from "@/lib/queue/kick";
import type { OwnerMessagePayload } from "@/lib/queue/handlers";
import { concurrencyKeys, keys } from "@/lib/queue/rules";
import { PRIORITY } from "@/lib/queue/config";
import { enqueue } from "@/lib/queue/store";
import { OwnerToldError, SORRY } from "@/lib/sorry";

// The message goes on the job queue and a worker answers it (its own function
// call, with its own time budget). Only if queuing fails is it answered here,
// in the background, as before the queue.
export const maxDuration = 300;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// The public URL Twilio called, used to check the request really came from Twilio.
function publicUrl(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

// Twilio calls this every time someone sends a WhatsApp message to the sandbox number.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!process.env.TWILIO_ACCOUNT_SID || !authToken) {
    console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    return new Response("Server not configured", { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!twilio.validateRequest(authToken, signature, publicUrl(req), params)) {
    console.warn("Rejected request with invalid Twilio signature");
    return new Response("Invalid signature", { status: 403 });
  }

  const owner = params.From; // the person texting, e.g. whatsapp:+447...
  const sandbox = params.To; // the sandbox number
  const body = params.Body ?? "";
  if (!owner || !sandbox) return new Response("Missing From/To", { status: 400 });
  // Photos (or other files) sent on WhatsApp. Onboarding reads them all (menu
  // pages); everywhere else only the first one is used.
  const allMedia = Array.from({ length: Math.min(10, Number(params.NumMedia ?? 0) || 0) }, (_, i) => ({
    url: params[`MediaUrl${i}`],
    contentType: params[`MediaContentType${i}`] ?? "",
  })).filter((m) => m.url);
  const media = allMedia[0] ?? null;
  // "Link my restaurant: K7Q2MZ" (from the onboarding page) links this number to a restaurant.
  const linkCode = media ? null : findLinkCode(body);

  // Every restaurant is identified by its owner's WhatsApp number (a fixed setting,
  // restaurants.owner_whatsapp, unique per restaurant; never taken from a message).
  const supabase = getSupabase();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_whatsapp", owner)
    .maybeSingle<{ id: string }>();
  // Not an owner: maybe a staff number the owner registered (ADD STAFF), which
  // can only send till reports and sales files for that one restaurant.
  const staff = restaurant || linkCode ? null : await findStaff(owner);
  // Not an owner or staff: maybe the number typed on a Dina sign-up, sending its first message.
  const signups = restaurant || linkCode || staff ? [] : await pendingSignupsFor(owner).catch((err) => (console.error("Couldn't look up sign-ups", err), []));
  // The builder's own commands (BUILDER ...), from BUILDER_WHATSAPP only. The same
  // phone can also be a demo restaurant's owner: anything else it sends goes there as usual.
  const builderCommand = !media && isBuilderNumber(owner, process.env.BUILDER_WHATSAPP) && isBuilderCommand(body);
  const { error: inboundError } = await supabase.from("messages").insert({
    restaurant_id: restaurant?.id ?? staff?.restaurant_id ?? null,
    direction: "inbound",
    from_number: owner,
    to_number: sandbox,
    body: media ? `[📷 photo]${body ? ` ${body}` : ""}` : body,
    twilio_sid: params.MessageSid ?? null,
    status: "received",
    error: restaurant || linkCode || staff || signups.length || builderCommand ? null : "Ignored: not a registered owner number",
  });
  // Twilio sometimes delivers the same message twice. Each message id can only be
  // logged once (unique index), so a second copy is a duplicate: do nothing.
  // (23505 = the database refused a duplicate.)
  if (inboundError?.code === "23505") {
    console.warn("Ignored a duplicate delivery of a WhatsApp message");
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }
  if (inboundError) console.error("Failed to log inbound message", inboundError);

  if (builderCommand) {
    after(async () => {
      let reply: string;
      try {
        reply = await handleBuilderCommand(body);
      } catch (err) {
        console.error("A builder command failed", err);
        reply = "⚠️ That builder command failed: " + (err instanceof Error ? err.message : String(err));
      }
      await sendText(sandbox, owner, reply).catch((err) => console.error("Couldn't answer the builder", err));
    });
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // A link code: the only thing an unregistered number can do. (With TEST_TOOLS on a
  // test phone can also move itself between demo restaurants this way.)
  if (linkCode) {
    after(() => linkFromWhatsApp(linkCode, owner, sandbox));
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  if (staff) {
    await queueMessage({ kind: "staff", owner, sandbox, body, media: allMedia }, staff.restaurant_id, params.MessageSid, () =>
      handleStaffMessage({ restaurantId: staff.restaurant_id, staffNumber: owner, sandbox, body, media }),
    );
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // The number given at sign-up: its first message links it (never one that's
  // already someone's: those were found above as an owner or staff number).
  if (!restaurant && signups.length) {
    after(() => linkSignupNumber(owner, sandbox, signups));
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Anyone else can't trigger anything, and gets no reply at all (logged above as ignored).
  if (!restaurant) {
    console.warn("WhatsApp message from an unregistered number");
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Reply to Twilio straight away (it gives up after 15 seconds); a worker does the
  // slow work and sends answers as separate WhatsApp messages. Everything from
  // here on works with this one restaurant only. A restaurant still being set up
  // gets the onboarding conversation instead (decided by the worker).
  await queueMessage({ kind: "owner", owner, sandbox, body, buttonPayload: params.ButtonPayload, media: allMedia }, restaurant.id, params.MessageSid, async () => {
    if (await onboardingInProgress(restaurant.id)) {
      return handleOnboardingMessage({ restaurantId: restaurant.id, owner, sandbox, body, media: allMedia });
    }
    await handleMessage({ restaurantId: restaurant.id, owner, sandbox, body, buttonPayload: params.ButtonPayload, media });
  });

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}

// Puts a message on the queue (owner replies first, one message at a time per
// restaurant, so two quick messages are answered in order) and starts a worker.
// A Twilio retry of the same message is stopped earlier (the message id is
// logged once), and its job key is the message id too.
async function queueMessage(payload: OwnerMessagePayload, restaurantId: string, messageSid: string | undefined, inline: () => Promise<void>) {
  try {
    await enqueue({
      type: "owner_message",
      restaurantId,
      key: keys.ownerMessage(messageSid || `${restaurantId}:${Date.now()}`),
      priority: PRIORITY.owner,
      concurrencyKey: concurrencyKeys.whatsapp(restaurantId),
      payload,
    });
    after(() => kickWorkers(1));
  } catch (err) {
    console.error("Couldn't queue the WhatsApp message; answering it here", err);
    after(async () => {
      try {
        await inline();
      } catch (e) {
        // The person hears "Sorry" once (the handler sends it itself unless it never got that far).
        if (!(e instanceof OwnerToldError)) await messageOwner({ restaurantId, from: payload.sandbox, to: payload.owner }, SORRY).catch(() => {});
        await alertBuilder(`owner-message-failed:${restaurantId}`, `A WhatsApp message couldn't be answered: ${e instanceof Error ? e.message : String(e)}. The person got the "Sorry" reply.`);
      }
    });
  }
}
