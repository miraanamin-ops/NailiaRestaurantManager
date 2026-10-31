import "server-only";
import { randomUUID } from "node:crypto";
import { ownerChannel } from "@/lib/followups";
import { sendAndLog } from "@/lib/notify";
import { getSupabase } from "@/lib/supabase";
import { sendText } from "@/lib/whatsapp";
import { getRestaurant } from "../store";
import { dinaReplyProblems } from "./reply";

// A message from Dina that code writes outside a turn (Google accepted us, a
// nudge). It joins the conversation both channels show, and goes on WhatsApp
// too if the owner's number is linked and they've written in the last 24 hours
// (WhatsApp's window; outside it, it waits in the chat, and the caller can email).
// The words still pass the same checks as Dina's own.

const WINDOW_MS = 24 * 3_600_000;

export async function whatsappWindowOpen(restaurantId: string, ownerNumber: string | null, now = new Date()) {
  if (!ownerNumber) return false;
  const { count } = await getSupabase()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("direction", "inbound")
    .eq("from_number", ownerNumber)
    .gte("created_at", new Date(now.getTime() - WINDOW_MS).toISOString());
  return (count ?? 0) > 0;
}

export async function sayFromCode(restaurantId: string, text: string, now = new Date()): Promise<{ whatsapp: boolean }> {
  const problems = dinaReplyProblems({ messages: [{ text, component: null }] });
  if (problems.length) throw new Error(`A fixed setup message failed its checks: ${problems.join("; ")}`);
  const r = await getRestaurant(restaurantId);
  const channel = ownerChannel(r);
  const whatsapp = Boolean(channel) && (await whatsappWindowOpen(restaurantId, r.owner_whatsapp, now));
  const { error } = await getSupabase()
    .from("onboarding_messages")
    .insert({ id: randomUUID(), restaurant_id: restaurantId, role: "dina", channel: whatsapp ? "whatsapp" : "web", body: text, parts: [] });
  if (error) throw new Error(`Couldn't save a setup message: ${error.message}`);
  if (whatsapp && channel) await sendAndLog(channel, () => sendText(channel.from, channel.to, text), text);
  return { whatsapp };
}
