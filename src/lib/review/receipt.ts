import "server-only";
import { check, type Draft } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import type { JobHandler } from "@/lib/queue/registry";
import { enqueue } from "@/lib/queue/store";
import type { BriefSectionDef, ReportSectionDef } from "@/lib/sections/types";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { aboutTime, receiptText, receiptTime, type ReceiptCounts } from "./rules";
import { minutesSavedSince, minutesSavedTotal } from "./time-saved";
import type { BusinessReview } from "./types";

// The receipt the evening after the business review (8pm, or 2 hours after it if
// later, never after 9pm; otherwise, and if WhatsApp's 24-hour window has
// closed, it's in the next morning brief): what was approved and is on its way,
// what's still waiting, and about how much time was saved. Plus the running
// total of time saved in the brief and the Monday report.

const db = () => getSupabase();
const POSTED = new Set(["approved", "queued", "sent"]);

export async function receiptCounts(review: BusinessReview): Promise<ReceiptCounts> {
  const drafts = (check(await db().from("drafts").select("kind, status").eq("restaurant_id", review.restaurant_id).eq("business_review_id", review.id)) ?? []) as Pick<Draft, "kind" | "status">[];
  const count = (kinds: string[], statuses: (s: string) => boolean) => drafts.filter((d) => kinds.includes(d.kind) && statuses(d.status)).length;
  const posted = (s: string) => POSTED.has(s);
  const waiting = (s: string) => s === "pending";
  return {
    posted: { replies: count(["review_reply"], posted), profile: count(["profile_fix"], posted) > 0, posts: count(["google_post"], posted), campaigns: count(["email_campaign"], posted) },
    waiting: { replies: count(["review_reply", "review_question"], waiting), profile: count(["profile_fix"], waiting), posts: count(["google_post"], waiting), campaigns: count(["email_campaign"], waiting) },
    minutes: await minutesSavedSince(review.restaurant_id, review.created_at).catch(() => 0),
  };
}

export async function scheduleReceipt(reviewId: string, r: Pick<Restaurant, "id">, sentAt: Date) {
  const at = receiptTime(sentAt);
  check(await db().from("business_reviews").update({ receipt_due_at: at?.toISOString() ?? null }).eq("id", reviewId));
  if (at) await enqueue({ type: "business_review_receipt", restaurantId: r.id, key: `business_review_receipt:${reviewId}`, payload: { reviewId }, runAt: at });
}

// Marks the receipt sent, once (true: this caller sends it).
async function claimReceipt(review: BusinessReview, now: Date) {
  const { data, error } = await db().from("business_reviews").update({ receipt_sent_at: now.toISOString() }).eq("id", review.id).is("receipt_sent_at", null).select("id");
  if (error) throw new Error(error.message);
  return Boolean((data as unknown[] | null)?.length);
}

export const receiptHandler: JobHandler = {
  run: async (job) => {
    const review = check(await db().from("business_reviews").select("*").eq("id", String(job.payload.reviewId ?? "")).maybeSingle<BusinessReview>());
    if (!review || review.receipt_sent_at || review.status !== "sent") return { skipped: "nothing to send" };
    const r = check(await db().from("restaurants").select("*").eq("id", review.restaurant_id).maybeSingle<Restaurant>());
    const channel = r ? ownerChannel(r) : null;
    const now = new Date();
    // Outside the 24-hour window: it waits for the morning brief.
    const { canMessageFreely } = await import("@/lib/brief");
    if (!r || !channel || !(await canMessageFreely(r, now))) return { skipped: "goes in the morning brief" };
    if (!(await claimReceipt(review, now))) return { skipped: "already sent" };
    await messageOwner(channel, receiptText(await receiptCounts(review)));
    return { sent: true };
  },
};

// The brief: the receipt if it didn't go the evening before; and every day, the running total.
export const reviewBriefSection: BriefSectionDef = {
  id: "business_review",
  order: 5,
  async block({ restaurant, now }) {
    const lines: string[] = [];
    let review: BusinessReview | null = null;
    try {
      review = check(await db().from("business_reviews").select("*").eq("restaurant_id", restaurant.id).maybeSingle<BusinessReview>());
    } catch {
      return null; // before supabase/058
    }
    const due = review && review.status === "sent" && !review.receipt_sent_at && (!review.receipt_due_at || new Date(review.receipt_due_at).getTime() <= now.getTime());
    if (review && due && (await claimReceipt(review, now))) lines.push(receiptText(await receiptCounts(review)));
    else {
      const total = await minutesSavedTotal(restaurant.id).catch(() => 0);
      if (total > 0) lines.push(`⏱️ ${aboutTime(total).replace(/^about/, "About")} of work saved by DinerAI so far.`);
    }
    return lines.join("\n") || null;
  },
};

// The Monday report: time saved last week, and so far.
export const timeSavedReportSection: ReportSectionDef = {
  id: "time_saved",
  order: 40,
  async build({ restaurant, period }) {
    const rows = (check(await db().from("time_saved_log").select("minutes, logged_at").eq("restaurant_id", restaurant.id)) ?? []) as { minutes: number; logged_at: string }[];
    if (!rows.length) return null;
    const within = (from: Date, to: Date) => rows.filter((x) => new Date(x.logged_at) >= from && new Date(x.logged_at) < to).reduce((s, x) => s + x.minutes, 0);
    const week = within(period.start, period.end);
    const before = within(period.prevStart, period.start);
    const total = rows.reduce((s, x) => s + x.minutes, 0);
    const hours = (m: number) => Math.round((m / 60) * 2) / 2;
    return {
      title: "Time saved",
      stats: [{ label: "Hours saved (about)", value: { now: hours(week), before: hours(before) }, format: "count" }],
      lines: [`${aboutTime(total).replace(/^about/, "About")} of work done for you so far: replies drafted, profile fixes, campaigns and posts.`],
      footnote: "Estimates: a few minutes per reply, longer for campaigns and posts. Always about, never exact.",
    };
  },
  facts: (s) => `Time saved: ${s.lines[0] ?? ""}`,
};
