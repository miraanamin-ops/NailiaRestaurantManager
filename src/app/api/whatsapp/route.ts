import { after, type NextRequest } from "next/server";
import twilio from "twilio";
import { handleMessage } from "@/lib/bot";
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
  // A photo (or other file) sent on WhatsApp. We only use the first one.
  const media =
    Number(params.NumMedia ?? 0) > 0 && params.MediaUrl0
      ? { url: params.MediaUrl0, contentType: params.MediaContentType0 ?? "" }
      : null;

  // Only the restaurant's registered owner number can use the assistant. The
  // number is a fixed setting (restaurants.owner_whatsapp), never taken from a message.
  const supabase = getSupabase();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_whatsapp", owner)
    .limit(1)
    .maybeSingle<{ id: string }>();
  const { error: inboundError } = await supabase.from("messages").insert({
    restaurant_id: restaurant?.id ?? null,
    direction: "inbound",
    from_number: owner,
    to_number: sandbox,
    body: media ? `[📷 photo]${body ? ` ${body}` : ""}` : body,
    twilio_sid: params.MessageSid ?? null,
    status: "received",
    error: restaurant ? null : "Ignored: not a registered owner number",
  });
  if (inboundError) console.error("Failed to log inbound message", inboundError);

  // Anyone else gets no reply and can't trigger anything.
  if (!restaurant) {
    console.warn("Ignored WhatsApp message from an unregistered number");
    return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Reply to Twilio straight away (it gives up after 15 seconds), then do the
  // slow work and send answers as separate WhatsApp messages.
  after(() => handleMessage({ owner, sandbox, body, buttonPayload: params.ButtonPayload, media }));

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
