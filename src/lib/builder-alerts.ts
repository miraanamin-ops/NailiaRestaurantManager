import "server-only";
import { sendBuilderEmail } from "@/lib/email";
import { getSupabase } from "@/lib/supabase";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { sendText } from "@/lib/whatsapp";

// Alerts about the system itself (a job failed, or didn't run on time) go to the
// BUILDER only, never to a restaurant owner:
//   BUILDER_EMAIL     e.g. you@example.com (with Resend's test sender, only the Resend account email works)
//   BUILDER_WHATSAPP  e.g. whatsapp:+447700900123
// The same problem (key) alerts at most once every DEDUPE_HOURS.
const DEDUPE_HOURS = 6;
const SANDBOX_NUMBER = ourWhatsAppNumber();

export async function alertBuilder(key: string, message: string): Promise<string> {
  const supabase = getSupabase();
  try {
    const since = new Date(Date.now() - DEDUPE_HOURS * 60 * 60 * 1000).toISOString();
    const { count } = await supabase.from("builder_alerts").select("id", { count: "exact", head: true }).eq("key", key).gte("created_at", since);
    if (count) return "already alerted";
  } catch (err) {
    console.error("Couldn't check earlier builder alerts", err);
  }

  const results: string[] = [];
  const email = process.env.BUILDER_EMAIL;
  if (email) {
    try {
      await sendBuilderEmail(email, `⚠️ Naila: ${message.split("\n")[0].slice(0, 90)}`, `${message}\n\n(Naila builder alert, key: ${key})`);
      results.push("email ok");
    } catch (err) {
      results.push(`email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else results.push("no BUILDER_EMAIL set");

  const whatsapp = process.env.BUILDER_WHATSAPP;
  if (whatsapp) {
    try {
      await sendText(process.env.BUILDER_WHATSAPP_FROM || SANDBOX_NUMBER, whatsapp, `🛠️ *Builder alert*\n${message}`);
      results.push("whatsapp ok");
    } catch (err) {
      results.push(`whatsapp failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else results.push("no BUILDER_WHATSAPP set");

  const channels = results.join(", ");
  const { error } = await supabase.from("builder_alerts").insert({ key, message, channels });
  if (error) console.error("Couldn't record the builder alert", error);
  console.warn(`Builder alert (${channels}): ${message}`);
  return channels;
}
