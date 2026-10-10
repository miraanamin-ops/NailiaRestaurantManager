import { after, type NextRequest } from "next/server";
import twilio from "twilio";
import { handleMessage } from "@/lib/bot";
import { findLinkCode } from "@/lib/onboarding/steps";
import { handleOnboardingMessage, linkFromWhatsApp, onboardingInProgress } from "@/lib/onboarding/whatsapp-flow";
import { replyUnregistered } from "@/lib/unregistered";
import { getSupabase } from "@/lib/supabase";

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
  const { error: inboundError } = await supabase.from("messages").insert({
    restaurant_id: restaurant?.id ?? null,
    direction: "inbound",
    from_number: owner,
    to_number: sandbox,
    body: media ? `[📷 photo]${body ? ` ${body}` : ""}` : body,
    twilio_sid: params.MessageSid ?? null,
    status: "received",
    error: restaurant || linkCode ? null : "Ignored: not a registered owner number",
  });
  // Twilio sometimes delivers the same message twice. Each message id can only be
  // logged once (unique index), so a second copy is a duplicate: do nothing.
  // (23505 = the database refused a duplicate.)
  if (inboundError?.code === "23505") {
    console.warn("Ignored a duplicate delivery of a WhatsApp message");
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }
  if (inboundError) console.error("Failed to log inbound message", inboundError);

  // A link code: the only thing an unregistered number can do. (In test mode a
  // test phone can also move itself between demo restaurants this way.)
  if (linkCode) {
    after(() => linkFromWhatsApp(linkCode, owner, sandbox));
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Anyone else can't trigger anything: they get one polite "not registered" reply
  // (at most once a day) and nothing else.
  if (!restaurant) {
    console.warn("WhatsApp message from an unregistered number");
    after(() => replyUnregistered(owner, sandbox));
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Reply to Twilio straight away (it gives up after 15 seconds), then do the
  // slow work and send answers as separate WhatsApp messages. Everything from
  // here on works with this one restaurant only. A restaurant still being set up
  // gets the onboarding conversation instead.
  after(async () => {
    if (await onboardingInProgress(restaurant.id)) {
      return handleOnboardingMessage({ restaurantId: restaurant.id, owner, sandbox, body, media: allMedia });
    }
    return handleMessage({ restaurantId: restaurant.id, owner, sandbox, body, buttonPayload: params.ButtonPayload, media });
  });

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
