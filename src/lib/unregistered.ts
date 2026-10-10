import "server-only";
import { getSupabase } from "@/lib/supabase";
import { sendText } from "@/lib/whatsapp";

// A message from a number that isn't any restaurant's owner. They get one polite
// reply, at most once a day (so it can't be used to make us send messages over
// and over), and nothing about any restaurant.
export const UNREGISTERED_REPLY =
  "Hi! This WhatsApp number isn't registered with Naila, so I can't help with that. If you run a restaurant that uses Naila, ask us to add this number. 🙏";
const ONCE_PER_HOURS = 24;

// (Also used, with its own text, when a WhatsApp link code doesn't work: a few a day at most.)
export async function replyUnregistered(number: string, ourNumber: string, text = UNREGISTERED_REPLY, perDay = 1) {
  const supabase = getSupabase();
  try {
    const since = new Date(Date.now() - ONCE_PER_HOURS * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("restaurant_id", null)
      .eq("direction", "outbound")
      .eq("to_number", number)
      .gte("created_at", since);
    if ((count ?? 0) >= perDay) return;
    const sent = await sendText(ourNumber, number, text);
    await supabase.from("messages").insert({
      restaurant_id: null,
      direction: "outbound",
      from_number: ourNumber,
      to_number: number,
      body: sent.body,
      twilio_sid: sent.sid,
      status: "sent",
    });
  } catch (err) {
    console.error("Couldn't send the 'not registered' reply", err);
  }
}
