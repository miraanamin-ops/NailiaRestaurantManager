import "server-only";
import { formatLondon } from "@/lib/clock";
import { overCap } from "@/lib/discounts";
import { KIND_LABELS, type Draft } from "@/lib/drafts";
import type { SendResult } from "@/lib/send";
import type { Restaurant } from "@/lib/supabase";

// A draft as the owner sees it on WhatsApp, with the checker's notes and a
// plain-code warning if the discount is over the cap.
export function draftMessage(draft: Draft, restaurant: Pick<Restaurant, "discount_cap_percent">) {
  const icon = draft.kind === "email_campaign" ? "📧" : draft.kind === "google_post" ? "📍" : "📝";
  const header = `${icon} *${KIND_LABELS[draft.kind]}*${draft.audience ? ` for ${draft.audience}` : ""}${draft.version > 1 ? ` (version ${draft.version})` : ""}`;
  const lines = [header, "", draft.content];

  const notes: string[] = [];
  for (const fix of draft.check_notes?.fixes ?? []) notes.push(`🔍 _Checker fixed: ${fix}_`);
  for (const flag of draft.check_notes?.flags ?? []) notes.push(`⚠️ _Check: ${flag}_`);
  const over = overCap(draft.content, restaurant.discount_cap_percent);
  if (over) {
    notes.push(`⛔ _${over.percent}% off is above your ${restaurant.discount_cap_percent}% cap, so this will be blocked if you approve it._`);
  }
  if (notes.length) lines.push("", ...notes);
  return lines.join("\n");
}

function draftName(draft: Draft) {
  return `${KIND_LABELS[draft.kind]}${draft.audience ? ` for ${draft.audience}` : ""}`;
}

// What the owner is told after an Approve (or TEST SEND) goes through the rules.
export function sendResultMessage(result: SendResult) {
  const name = draftName(result.draft);
  if (result.outcome === "sent") {
    if (result.note) return `✅ Approved and sent: ${name.replace(/\.$/, "")}.\n${result.note}`;
    return `✅ Approved and sent: ${name.replace(/\.$/, "")}.\n_Simulated for now: nothing actually went out._`;
  }
  if (result.outcome === "queued") {
    return result.reason === "paused"
      ? `⏸️ Approved, but sending is *paused*. "${name}" is held and will go out when you text RESUME.`
      : `🕘 Approved, but it's outside sending hours. "${name}" is queued for *${formatLondon(result.scheduledFor!)}*.`;
  }
  if (result.reason === "discount_cap") {
    return `⛔ *Blocked*: ${result.detail} Nothing was sent.\nTo allow it, raise the cap (e.g. text CAP 30) and tap Approve again.`;
  }
  if (result.reason === "duplicate") {
    return `⛔ *Not sent again*: ${result.detail}`;
  }
  if (result.reason === "no_recipients") {
    return `⛔ *Not sent*: ${result.detail} Nothing went out.`;
  }
  return `⛔ *Blocked*: ${result.detail} Nothing was sent. Only drafts you approve can go out.`;
}

// Short summary when queued drafts are released.
export function queueResultsMessage(results: SendResult[]) {
  const sent = results.filter((r) => r.outcome === "sent");
  const other = results.filter((r) => r.outcome !== "sent");
  const lines: string[] = [];
  if (sent.length) {
    const anyReal = sent.some((r) => r.outcome === "sent" && r.note);
    lines.push(`📤 Sent ${sent.length} queued draft${sent.length > 1 ? "s" : ""}${anyReal ? "" : " _(simulated)_"}:`);
    for (const r of sent) lines.push(`- ${draftName(r.draft)}${r.outcome === "sent" && r.note ? `\n  ${r.note}` : ""}`);
  }
  for (const r of other) lines.push(sendResultMessage(r));
  return lines.join("\n");
}
