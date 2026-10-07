import { after, type NextRequest } from "next/server";
import twilio from "twilio";
import { generateReply, loadRestaurantContext, type StoredMessage } from "@/lib/assistant";
import { getSupabase } from "@/lib/supabase";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// The public URL Twilio called, used to check the request really came from Twilio.
function publicUrl(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

// Twilio calls this every time someone sends a WhatsApp message to the sandbox number.
export async function POST(req: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
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

  const from = params.From; // the person texting, e.g. whatsapp:+447...
  const to = params.To; // the sandbox number
  const body = params.Body ?? "";
  if (!from || !to) return new Response("Missing From/To", { status: 400 });

  const supabase = getSupabase();
  const ctx = await loadRestaurantContext();

  const { error: inboundError } = await supabase.from("messages").insert({
    restaurant_id: ctx.restaurantId,
    direction: "inbound",
    from_number: from,
    to_number: to,
    body,
    twilio_sid: params.MessageSid ?? null,
    status: "received",
  });
  if (inboundError) console.error("Failed to log inbound message", inboundError);

  // Reply to Twilio straight away (it gives up after 15 seconds), then let
  // Claude think and send the answer as a separate WhatsApp message.
  after(async () => {
    let reply: string;
    let failure: string | null = null;
    try {
      const { data: rows, error } = await supabase
        .from("messages")
        .select("direction, body, status")
        // Quoted because numbers look like "whatsapp:+44…" and ":" is special in this filter.
        .or(`from_number.eq."${from}",to_number.eq."${from}"`)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT)
        .returns<StoredMessage[]>();
      if (error) throw error;
      reply = await generateReply(ctx, (rows ?? []).reverse());
    } catch (err) {
      console.error("Failed to generate reply", err);
      failure = err instanceof Error ? err.message : String(err);
      reply = "Sorry, something went wrong on my side. Please try again in a minute. 🙏";
    }

    let sid: string | null = null;
    try {
      const sent = await twilio(accountSid, authToken).messages.create({ from: to, to: from, body: reply });
      sid = sent.sid;
    } catch (err) {
      console.error("Failed to send WhatsApp reply", err);
      failure = [failure, `Twilio: ${err instanceof Error ? err.message : String(err)}`]
        .filter(Boolean)
        .join(" | ");
    }

    const { error: outboundError } = await supabase.from("messages").insert({
      restaurant_id: ctx.restaurantId,
      direction: "outbound",
      from_number: to,
      to_number: from,
      body: reply,
      twilio_sid: sid,
      status: sid ? "sent" : "failed",
      error: failure,
    });
    if (outboundError) console.error("Failed to log outbound message", outboundError);
  });

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
