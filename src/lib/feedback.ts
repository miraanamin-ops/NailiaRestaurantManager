import "server-only";
import { isInSendWindow } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { sendFeedbackEmail } from "@/lib/email";
import { googleReviewUrl } from "@/lib/email/content";
import { briefLines, FEEDBACK_DELAY_HOURS, feedbackDecision, isNegative, negativeAlert } from "@/lib/feedback-rules";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { logEvent, newToken, type SignupCustomer } from "@/lib/signups";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";

// "How was your visit?" emails, about 3 hours after a reward or offer is redeemed.
// Every one carries the Google review link, whatever the customer thinks: the
// private form is a separate, extra choice, never a filter in front of Google.
// Private feedback: 1-3 stars go to the owner straight away, 4-5 in the next morning brief.

export type FeedbackRequest = {
  id: string;
  restaurant_id: string;
  customer_id: string | null;
  source: "reward" | "offer";
  source_id: string;
  token: string;
  due_at: string;
  status: "pending" | "sent" | "skipped" | "failed";
  sent_at: string | null;
};

// Called when a reward or offer is redeemed. Once per redemption (a unique index).
export async function scheduleFeedback(i: { restaurantId: string; customerId: string | null; source: "reward" | "offer"; sourceId: string; redeemedAt: Date }) {
  if (!i.customerId) return; // the owner's own copy of a campaign
  const { error } = await getSupabase()
    .from("feedback_requests")
    .upsert(
      {
        restaurant_id: i.restaurantId,
        customer_id: i.customerId,
        source: i.source,
        source_id: i.sourceId,
        token: newToken(),
        due_at: new Date(i.redeemedAt.getTime() + FEEDBACK_DELAY_HOURS * 3_600_000).toISOString(),
      },
      { onConflict: "source,source_id", ignoreDuplicates: true },
    );
  if (error) console.error("Couldn't schedule the feedback email", error);
}

type Summary = { sent: number; skipped: number; waiting: number; failed: number };

// The hourly job (and RUN FEEDBACK, which doesn't wait for the 3 hours).
export async function runFeedbackJob(restaurant: Restaurant, now: Date, { ignoreDelay = false } = {}): Promise<Summary> {
  const supabase = getSupabase();
  const summary: Summary = { sent: 0, skipped: 0, waiting: 0, failed: 0 };
  const due =
    check(
      await supabase
        .from("feedback_requests")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "pending")
        .lte("due_at", (ignoreDelay ? new Date(now.getTime() + FEEDBACK_DELAY_HOURS * 3_600_000) : now).toISOString())
        .order("due_at")
        .limit(50)
        .returns<FeedbackRequest[]>(),
    ) ?? [];
  const inWindow = isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end);

  for (const req of due) {
    const customer = req.customer_id
      ? check(await supabase.from("customers").select("*").eq("restaurant_id", restaurant.id).eq("id", req.customer_id).maybeSingle<SignupCustomer>())
      : null;
    const [last] = req.customer_id
      ? (check(
          await supabase
            .from("feedback_requests")
            .select("sent_at")
            .eq("restaurant_id", restaurant.id)
            .eq("customer_id", req.customer_id)
            .not("sent_at", "is", null)
            .order("sent_at", { ascending: false })
            .limit(1)
            .returns<{ sent_at: string }[]>(),
        ) ?? [])
      : [];
    const decision = feedbackDecision({
      dueAt: ignoreDelay ? now : new Date(req.due_at),
      now,
      customer,
      lastSentAt: last ? new Date(last.sent_at) : null,
      enabled: restaurant.feedback_emails !== false,
      paused: restaurant.paused,
      inSendWindow: inWindow,
    });
    if (decision.action === "wait") {
      summary.waiting++;
      continue;
    }
    if (decision.action === "skip") {
      summary.skipped++;
      check(await supabase.from("feedback_requests").update({ status: "skipped", detail: decision.reason }).eq("restaurant_id", restaurant.id).eq("id", req.id));
      continue;
    }
    // Claim it first, so two runs can't both send it.
    const claimed = check(
      await supabase
        .from("feedback_requests")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("restaurant_id", restaurant.id)
        .eq("id", req.id)
        .eq("status", "pending")
        .select("id"),
    );
    if (!claimed?.length) continue;
    try {
      const sent = await sendFeedbackEmail({ restaurant, customer: customer!, token: req.token, googleUrl: googleReviewUrl(restaurant), baseUrl: appUrl() });
      check(await supabase.from("feedback_requests").update({ resend_id: sent.id, detail: sent.delivery === "simulated" ? `simulated: ${sent.reason}` : null }).eq("restaurant_id", restaurant.id).eq("id", req.id));
      await logEvent(restaurant.id, req.customer_id, "feedback_email_sent", sent.delivery === "simulated" ? `simulated: ${sent.reason}` : (sent.id ?? undefined));
      summary.sent++;
    } catch (err) {
      summary.failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error("Feedback email failed", message);
      check(await supabase.from("feedback_requests").update({ status: "failed", sent_at: null, detail: message.slice(0, 300) }).eq("restaurant_id", restaurant.id).eq("id", req.id));
    }
  }
  return summary;
}

export async function getFeedbackRequest(token: string) {
  return check(await getSupabase().from("feedback_requests").select("*").eq("token", token).maybeSingle<FeedbackRequest>());
}

export type SubmitResult = "saved" | "already" | "not_found";

// The private form was sent. Negative feedback is messaged to the owner at once.
export async function submitFeedback(token: string, rating: number, comment: string | null): Promise<SubmitResult> {
  const supabase = getSupabase();
  const req = await getFeedbackRequest(token);
  if (!req) return "not_found";
  const negative = isNegative(rating);
  const { data, error } = await supabase
    .from("feedback")
    .insert({ restaurant_id: req.restaurant_id, customer_id: req.customer_id, request_id: req.id, rating, comment, negative })
    .select("id")
    .single<{ id: string }>();
  if (error?.code === "23505") return "already";
  if (error) throw new Error(error.message);
  await logEvent(req.restaurant_id, req.customer_id, "feedback_received", `${rating} star${rating === 1 ? "" : "s"}`);

  if (negative) {
    const [restaurant, customer] = await Promise.all([
      check(await supabase.from("restaurants").select("*").eq("id", req.restaurant_id).maybeSingle<Restaurant>()),
      req.customer_id
        ? check(await supabase.from("customers").select("name, email").eq("restaurant_id", req.restaurant_id).eq("id", req.customer_id).maybeSingle<{ name: string; email: string | null }>())
        : null,
    ]);
    const channel = restaurant ? ownerChannel(restaurant) : null;
    if (channel) {
      await messageOwner(channel, negativeAlert({ rating, comment, name: customer?.name ?? "A customer", email: customer?.email ?? null }));
      check(await supabase.from("feedback").update({ alerted_at: new Date().toISOString() }).eq("restaurant_id", req.restaurant_id).eq("id", data!.id));
    }
  }
  return "saved";
}

// Good feedback not yet shown to the owner, as lines for the morning brief.
export async function feedbackForBrief(restaurantId: string) {
  const supabase = getSupabase();
  const rows =
    check(
      await supabase
        .from("feedback")
        .select("id, rating, comment, customer_id")
        .eq("restaurant_id", restaurantId)
        .eq("negative", false)
        .is("reported_at", null)
        .order("created_at")
        .limit(10)
        .returns<{ id: string; rating: number; comment: string | null; customer_id: string | null }[]>(),
    ) ?? [];
  if (!rows.length) return { lines: [], ids: [] };
  const ids = rows.map((r) => r.customer_id).filter((x): x is string => Boolean(x));
  const names = ids.length
    ? (check(await supabase.from("customers").select("id, name").eq("restaurant_id", restaurantId).in("id", ids).returns<{ id: string; name: string }[]>()) ?? [])
    : [];
  const nameOf = (id: string | null) => names.find((n) => n.id === id)?.name.split(/\s+/)[0] ?? "A customer";
  return {
    lines: briefLines(rows.map((r) => ({ rating: r.rating, comment: r.comment, name: nameOf(r.customer_id) }))),
    ids: rows.map((r) => r.id),
  };
}

export async function markFeedbackReported(restaurantId: string, ids: string[]) {
  if (ids.length) check(await getSupabase().from("feedback").update({ reported_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).in("id", ids));
}
