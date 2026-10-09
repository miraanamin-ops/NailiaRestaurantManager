import "server-only";
import { checkNoteLines, checksLine } from "@/lib/checks/types";
import { formatLondon } from "@/lib/clock";
import { overCap } from "@/lib/discounts";
import { KIND_LABELS, type Draft } from "@/lib/drafts";
import type { SendResult } from "@/lib/send";
import type { Restaurant } from "@/lib/supabase";

// A draft as the owner sees it on WhatsApp: the text, then one line saying how
// it did on the four checks, then what each check fixed or flagged.
export function draftMessage(draft: Draft, restaurant: Pick<Restaurant, "discount_cap_percent">) {
  const icon = draft.kind === "email_campaign" ? "📧" : draft.kind === "google_post" ? "📍" : "📝";
  const header = `${icon} *${KIND_LABELS[draft.kind]}*${draft.audience ? ` for ${draft.audience}` : ""}${draft.version > 1 ? ` (version ${draft.version})` : ""}`;
  const lines = [header, "", draft.content];

  if (draft.checks) {
    // The money check ran when the draft was made; re-check the cap in case it's changed since.
    const over = overCap(draft.content, restaurant.discount_cap_percent);
    const checks = over && draft.checks.money?.status === "pass"
      ? { ...draft.checks, money: { ...draft.checks.money, status: "flagged" as const, flags: [`${over.percent}% off is above your ${restaurant.discount_cap_percent}% cap, so it will be blocked if you approve it`] } }
      : draft.checks;
    lines.push("", checksLine(checks), ...checkNoteLines(checks));
    return lines.join("\n");
  }

  // Drafts from before the four checks (step 10).
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

// After APPROVE ALL: one line per brief item, with what the safety rules did.
export function approveAllMessage(results: { n: number; result: SendResult }[]) {
  const sent = results.filter((r) => r.result.outcome === "sent").length;
  const lines = [`👍 *Approved ${results.length} item${results.length === 1 ? "" : "s"}* (${sent} sent now)`];
  for (const { n, result } of results) {
    const name = draftName(result.draft).replace(/\.$/, "");
    if (result.outcome === "sent") lines.push(`${n}. ✅ ${name}${result.note ? `\n   ${result.note}` : " _(simulated)_"}`);
    else if (result.outcome === "queued")
      lines.push(`${n}. ${result.reason === "paused" ? "⏸️" : "🕘"} ${name}: ${result.reason === "paused" ? "held until RESUME" : `queued for ${formatLondon(result.scheduledFor!)}`}`);
    else lines.push(`${n}. ⛔ ${name}: not sent. ${result.detail}`);
  }
  return lines.join("\n");
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
