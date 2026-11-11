import "server-only";
import { check } from "@/lib/drafts";
import { messageOwner, sendAndLog, type OwnerChannel } from "@/lib/notify";
import { isSandbox } from "@/lib/onboarding/channel";
import { briefSummary, mayOpen, OUTBOX_MAX_AGE_MS, resolveOpener, withinWindow, type OpenerKind, type OpenerRequest } from "@/lib/openers";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { ButtonTarget } from "@/lib/whatsapp";

// WhatsApp's 24-hour rule (step 46). A message DinerAI sends the owner on its
// own (alerts, the rota, reports) while they haven't messaged in 24 hours is
// held in owner_outbox; on a real sender an approved template ("Show me") opens
// the chat (lib/openers.ts decides which, and whether one may go now). Held
// messages go out on the owner's next message or tap (deliverOutbox, from
// lib/bot/index.ts). On the sandbox no template can be sent, so they just wait.
// The morning brief has its own waiting flag (brief_waiting_since); it only
// uses sendOpener here.

export type HeldMessage = { text: string; withButtons: boolean | ButtonTarget; mediaUrl: string | null; mediaCaption?: string };

async function lastInboundAt(r: Pick<Restaurant, "id" | "owner_whatsapp">) {
  if (!r.owner_whatsapp) return null;
  const row = check(
    await getSupabase()
      .from("messages")
      .select("created_at")
      .eq("restaurant_id", r.id)
      .eq("direction", "inbound")
      .eq("from_number", r.owner_whatsapp)
      // App chat messages (to "app") don't open WhatsApp's window.
      .neq("to_number", "app")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
  );
  return row ? new Date(row.created_at) : null;
}

async function loadRestaurant(id: string) {
  return check(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}

// Called by messageOwner when the caller says the message is proactive. True =
// the chat is open, send it now; false = it was held (and maybe an opener sent).
export async function sendOrHold(channel: OwnerChannel, message: HeldMessage, request: OpenerRequest, now = new Date()) {
  const r = await loadRestaurant(channel.restaurantId);
  if (!r) return true;
  const inbound = await lastInboundAt(r);
  if (withinWindow(inbound, now)) return true;
  const { error } = await getSupabase().from("owner_outbox").insert({ restaurant_id: r.id, payload: message, opener: request });
  if (error) {
    // Before supabase/062 there's nowhere to hold it: send as before.
    console.error("Couldn't hold the message for the 24-hour window; sending it now", error);
    return true;
  }
  const opener = resolveOpener(request, message.text, { ownerName: r.owner_name, restaurantName: r.name, reportLabel: reportLabelFrom(message) });
  if (opener) await sendOpener(r, channel, opener.kind, opener.vars, { now, lastInboundAt: inbound });
  return false;
}

// "October" from the monthly report's PDF caption ("October report (PDF)").
function reportLabelFrom(m: HeldMessage) {
  return m.mediaCaption?.match(/^(\w+) report/)?.[1];
}

// Sends the template if the rules allow it (not on the sandbox). True if sent.
export async function sendOpener(
  r: Restaurant,
  channel: OwnerChannel,
  kind: OpenerKind,
  vars: Record<string, string>,
  s: { now: Date; lastInboundAt?: Date | null },
) {
  if (isSandbox()) return false;
  const inbound = s.lastInboundAt === undefined ? await lastInboundAt(r) : s.lastInboundAt;
  const lastOpenerAt = r.last_opener_at ? new Date(r.last_opener_at) : null;
  if (!mayOpen(kind, { now: s.now, lastOpenerAt, lastInboundAt: inbound })) return false;
  const { sendOpenerTemplate } = await import("@/lib/whatsapp");
  // Recorded first, so two jobs at once can't both send one.
  const { error } = await getSupabase().from("restaurants").update({ last_opener_at: s.now.toISOString() }).eq("id", r.id);
  if (error) console.error("Couldn't record the opener time (supabase/062 not run?)", error);
  await sendAndLog(channel, () => sendOpenerTemplate(channel.from, channel.to, kind, vars), `[${kind} opener]`);
  return true;
}

// The morning brief was held: open the chat with "Your brief is ready: 3 things to approve".
export async function sendBriefOpener(r: Restaurant, channel: OwnerChannel, waiting: number, now: Date) {
  const opener = resolveOpener("brief", "", { ownerName: r.owner_name, restaurantName: r.name, briefSummary: briefSummary(waiting) })!;
  return sendOpener(r, channel, "brief", opener.vars, { now });
}

// The owner just messaged or tapped "Show me": everything held goes out, oldest
// first (anything over a week old is dropped as stale). Returns how many were sent.
export async function deliverOutbox(restaurantId: string, channel: OwnerChannel, now = new Date()) {
  const supabase = getSupabase();
  const rows =
    check(
      await supabase
        .from("owner_outbox")
        .select("id, created_at, payload")
        .eq("restaurant_id", restaurantId)
        .is("sent_at", null)
        .is("expired_at", null)
        .order("created_at")
        .returns<{ id: string; created_at: string; payload: HeldMessage }[]>(),
    ) ?? [];
  if (!rows.length) return 0;
  const stale = rows.filter((m) => now.getTime() - new Date(m.created_at).getTime() > OUTBOX_MAX_AGE_MS).map((m) => m.id);
  const fresh = rows.filter((m) => !stale.includes(m.id));
  if (stale.length) check(await supabase.from("owner_outbox").update({ expired_at: now.toISOString() }).eq("restaurant_id", restaurantId).in("id", stale));
  if (!fresh.length) return 0;
  // Claimed before sending, so a second message from the owner can't send them twice.
  const claimed =
    check(
      await supabase
        .from("owner_outbox")
        .update({ sent_at: now.toISOString() })
        .eq("restaurant_id", restaurantId)
        .in("id", fresh.map((m) => m.id))
        .is("sent_at", null)
        .select("id")
        .returns<{ id: string }[]>(),
    ) ?? [];
  const mine = new Set(claimed.map((c) => c.id));
  let sent = 0;
  for (const m of fresh) {
    if (!mine.has(m.id)) continue;
    const p = m.payload;
    await messageOwner(channel, p.text, p.withButtons, { mediaUrl: p.mediaUrl, ...(p.mediaCaption ? { mediaCaption: p.mediaCaption } : {}) });
    sent++;
  }
  return sent;
}
