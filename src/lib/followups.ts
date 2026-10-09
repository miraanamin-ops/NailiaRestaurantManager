import "server-only";
import { formatLondon, isInSendWindow } from "@/lib/clock";
import { check, KIND_LABELS, updateDraft, type Draft } from "@/lib/drafts";
import { draftMessage, queueResultsMessage } from "@/lib/format";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { processQueue } from "@/lib/send";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// WhatsApp only lets a business message someone freely within 24 hours of
// their last message, so reminders go out after 12 hours, while that's still open.
export const REMINDER_AFTER_HOURS = 12;
const HOUR = 60 * 60 * 1000;

export function ownerChannel(restaurant: Restaurant): OwnerChannel | null {
  if (!restaurant.owner_whatsapp || !restaurant.whatsapp_from) return null;
  return { restaurantId: restaurant.id, from: restaurant.whatsapp_from, to: restaurant.owner_whatsapp };
}

// One reminder per draft that's been waiting on the owner for a while.
export async function sendReminders(restaurant: Restaurant, now: Date) {
  const channel = ownerChannel(restaurant);
  if (!channel) return 0;
  // Keep owner reminders to sociable hours too.
  if (!isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end)) return 0;

  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .in("waiting_for", ["decision", "edit_instructions"])
    .is("reminded_at", null)
    .returns<Draft[]>();
  const due = (check(res) ?? []).filter((d) => now.getTime() - new Date(d.updated_at).getTime() >= REMINDER_AFTER_HOURS * HOUR);

  for (const d of due) {
    await updateDraft(d.id, { reminded_at: new Date().toISOString() });
    const ask =
      d.waiting_for === "edit_instructions"
        ? "You tapped Edit on this one. What would you like changed? (Or tap Approve / Skip.)"
        : "This is still waiting for you:";
    await messageOwner(channel, `⏰ *Reminder.* ${ask}\n\n${draftMessage(d, restaurant)}`, true);
  }
  return due.length;
}

// Releases any queued drafts that are due and tells the owner what went out.
export async function releaseQueue(restaurant: Restaurant, now: Date) {
  const results = await processQueue(restaurant, now);
  const channel = ownerChannel(restaurant);
  if (results.length && channel) await messageOwner(channel, queueResultsMessage(results));
  return results;
}

function age(from: string, now: Date) {
  const hours = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / HOUR));
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const BLOCK_LABELS: Record<string, string> = {
  outside_window: "outside sending hours",
  paused: "while paused",
  discount_cap: "over the discount cap",
  duplicate: "duplicates",
  not_approved: "not approved",
};

// The last 7 days, plus everything still open. Plain code, no AI.
export async function weeklySummary(restaurant: Restaurant, now: Date) {
  const supabase = getSupabase();
  const since = new Date(now.getTime() - 7 * 24 * HOUR).toISOString();
  const [weekRes, openRes, blocksRes] = await Promise.all([
    supabase.from("drafts").select("status").eq("restaurant_id", restaurant.id).gte("created_at", since).returns<{ status: string }[]>(),
    supabase
      .from("drafts")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .or("waiting_for.not.is.null,status.eq.queued,status.eq.blocked")
      .order("created_at")
      .returns<Draft[]>(),
    supabase.from("blocked_sends").select("reason").eq("restaurant_id", restaurant.id).gte("created_at", since).returns<{ reason: string }[]>(),
  ]);
  const week = check(weekRes) ?? [];
  const open = check(openRes) ?? [];
  const blocks = check(blocksRes) ?? [];

  const count = (s: string) => week.filter((d) => d.status === s).length;
  const lines = [
    "📊 *Weekly round-up* (last 7 days)",
    `- Drafts written: ${week.length}`,
    `- Sent: ${count("sent")} · Queued: ${count("queued")} · Skipped: ${count("skipped")} · Blocked: ${count("blocked")}`,
  ];

  if (blocks.length) {
    const byReason = new Map<string, number>();
    for (const b of blocks) byReason.set(b.reason, (byReason.get(b.reason) ?? 0) + 1);
    lines.push(
      `- Held back or blocked: ${[...byReason].map(([r, n]) => `${n} ${BLOCK_LABELS[r] ?? r}`).join(", ")}`,
    );
  }

  lines.push("", "*Still open:*");
  if (!open.length) lines.push("Nothing. You're all caught up! 🎉");
  for (const d of open) {
    const name = `${KIND_LABELS[d.kind]}${d.audience ? ` for ${d.audience}` : ""}`;
    if (d.waiting_for === "decision") lines.push(`- ${name}: waiting for your Approve / Edit / Skip (${age(d.updated_at, now)})`);
    else if (d.waiting_for === "edit_instructions") lines.push(`- ${name}: waiting for your edit (${age(d.updated_at, now)})`);
    else if (d.waiting_for === "skip_reason") lines.push(`- ${name}: skipped, waiting for your reason`);
    else if (d.status === "queued")
      lines.push(`- ${name}: queued ${d.scheduled_for ? `for ${formatLondon(new Date(d.scheduled_for))}` : "until RESUME"}`);
    else if (d.status === "blocked") lines.push(`- ${name}: blocked (${d.block_reason ?? "safety rule"})`);
  }
  return lines.join("\n");
}
