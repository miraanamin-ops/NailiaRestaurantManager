import "server-only";
import { SAMPLE_KINDS, samplePreviewUrl, type SampleKind } from "@/lib/email/previews";
import { runFeedbackJob } from "@/lib/feedback";
import { signLink } from "@/lib/signed-links";
import { appUrl, getSupabase } from "@/lib/supabase";
import type { Turn } from "./turn";

// WhatsApp commands about customer email: EXPORT CUSTOMERS, EMAIL PREVIEWS, RUN FEEDBACK.

const EXPORT_LINK_MS = 60 * 60_000; // the download link works for 1 hour

// EXPORT CUSTOMERS: a download link for the customer list (owners own their data).
export async function exportCustomersCommand({ ctx, send }: Turn) {
  const r = ctx.restaurant;
  const { count } = await getSupabase()
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", r.id)
    .is("deleted_at", null);
  const link = `${appUrl()}/export/download?r=${r.id}&t=${signLink("customer-export", r.id, EXPORT_LINK_MS)}`;
  // Only the download itself is logged (once, when the owner taps Download), so one export is one log line.
  return send(
    `📄 *Your customer list* (${count ?? 0} customer${count === 1 ? "" : "s"}, CSV for Excel or Google Sheets):\n${link}\n\nThe link works for 1 hour. It has your customers' contact details, so please don't forward it. You can also download it any time from your settings page.`,
  );
}

const SAMPLE_LABELS: Record<SampleKind, string> = {
  confirm: "*Confirm email*: sent straight after someone signs up. Nothing else goes out until they tap it.",
  welcome: "*Welcome email*: sent once they confirm, with their reward.",
  feedback: '*"How was your visit?"*: about 3 hours after a reward or offer is used. Everyone gets the Google review link; the stars are a private note to you.',
};

// EMAIL PREVIEWS: how the automatic emails look, in the restaurant's colours and logo.
export async function emailPreviewsCommand({ ctx, send }: Turn) {
  const r = ctx.restaurant;
  for (const [i, kind] of SAMPLE_KINDS.entries()) {
    const url = samplePreviewUrl(r.id, kind);
    await send(
      `${i + 1}/${SAMPLE_KINDS.length} ${SAMPLE_LABELS[kind]}${url ? "" : `\n${appUrl()}/settings/email-preview?r=${r.id}&kind=${kind}`}`,
      false,
      url,
    );
  }
  return send("🎨 They use your logo, colours and voice from set-up. Change the logo and colours on your settings page; campaign emails get a preview like this before you approve them.");
}

// RUN FEEDBACK (test mode): send any "How was your visit?" emails now, without waiting 3 hours.
export async function runFeedbackCommand({ ctx, send }: Turn) {
  const s = await runFeedbackJob(ctx.restaurant, ctx.now, { ignoreDelay: true });
  if (!s.sent && !s.skipped && !s.waiting && !s.failed) {
    return send("💬 No feedback emails waiting. Redeem a reward or offer first (they're due 3 hours after), then RUN FEEDBACK.");
  }
  const parts = [`💬 *Feedback emails:* ${s.sent} sent`];
  if (s.skipped) parts.push(`${s.skipped} skipped (unconfirmed, unsubscribed, or already had one in the last 30 days)`);
  if (s.waiting) parts.push(`${s.waiting} waiting (outside sending hours or paused)`);
  if (s.failed) parts.push(`${s.failed} failed`);
  return send(parts.join(" · "));
}
