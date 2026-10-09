import "server-only";
import { deliverCampaign, deliveryNote, ensureUnsubscribeTokens, getCampaignForDraft, recipientsFor } from "@/lib/campaigns";
import { emailComplianceProblems } from "@/lib/checks/compliance";
import { moneyAndRisk, type SendSource } from "@/lib/checks/money";
import { checkResult, type CheckResult, type DraftChecks } from "@/lib/checks/types";
import { google, type GooglePost } from "@/lib/google";
import { check, getDraft, updateDraft, type Draft } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Sending. Every send goes through attemptSend, which runs the two code checks
// right before anything goes out and records the result on the draft:
//   money and risk (lib/checks/money.ts): duplicates, approval, discount cap, PAUSE, sending hours
//   compliance (lib/checks/compliance.ts): for emails, valid consent now and an unsubscribe link

export type { SendSource };
export type BlockReason = "not_approved" | "duplicate" | "discount_cap" | "paused" | "outside_window" | "no_recipients";

export type SendResult =
  | { outcome: "sent"; draft: Draft; note?: string }
  | { outcome: "queued"; reason: "paused" | "outside_window"; scheduledFor: Date | null; detail: string; draft: Draft }
  | { outcome: "blocked"; reason: "not_approved" | "duplicate" | "discount_cap" | "no_recipients"; detail: string; draft: Draft };

const SENDABLE_STATUSES = ["approved", "queued", "blocked"] as const;

async function logBlock(draft: Draft, reason: BlockReason, detail: string) {
  const { error } = await getSupabase().from("blocked_sends").insert({
    restaurant_id: draft.restaurant_id,
    draft_id: draft.id,
    reason,
    detail,
  });
  if (error) console.error("Failed to log blocked send", error);
}

// The send-time results of the two code checks, kept alongside the draft-time ones.
function withSendChecks(draft: Draft, send: Partial<Record<"compliance" | "money", CheckResult>>): DraftChecks {
  return { ...(draft.checks ?? {}), send: { ...(draft.checks?.send ?? {}), ...send } };
}

export async function attemptSend(draftId: string, restaurant: Restaurant, now: Date, source: SendSource): Promise<SendResult> {
  const supabase = getSupabase();
  const draft = await getDraft(draftId);

  // 1. Money and risk.
  const rules = moneyAndRisk(draft, restaurant, now, source);
  if (rules.outcome === "blocked") {
    await logBlock(draft, rules.reason, rules.detail);
    // A duplicate attempt leaves the draft as it was; anything else is marked blocked.
    if (rules.reason === "duplicate" || rules.reason === "not_approved") return { ...rules, draft };
    const updated = await updateDraft(draft.id, {
      status: "blocked",
      block_reason: rules.detail,
      scheduled_for: null,
      checks: withSendChecks(draft, { money: checkResult([], [rules.detail], "blocked") }),
    });
    return { ...rules, draft: updated };
  }
  if (rules.outcome === "queued") {
    await logBlock(draft, rules.reason, rules.detail);
    const updated = await updateDraft(draft.id, {
      status: "queued",
      scheduled_for: rules.scheduledFor?.toISOString() ?? null,
      block_reason: rules.detail,
      checks: withSendChecks(draft, { money: checkResult([], [rules.detail], "held") }),
    });
    return { ...rules, draft: updated };
  }

  // 2. Compliance: email campaigns only go to customers with valid consent right
  //    now (not unsubscribed), and every one of those emails has an unsubscribe link.
  const compliance = checkResult([], []);
  if (draft.kind === "email_campaign") {
    const campaign = await getCampaignForDraft(draft.id);
    const { eligible, excluded } = campaign ? await recipientsFor(restaurant, campaign.segment, now) : { eligible: [], excluded: 0 };
    const missingUnsubscribe = await ensureUnsubscribeTokens(eligible.map((c) => c.id));
    const problems = emailComplianceProblems({ eligible: eligible.length, excluded, missingUnsubscribe });
    if (problems.length) {
      const detail = problems.join(" ");
      await logBlock(draft, "no_recipients", detail);
      const updated = await updateDraft(draft.id, {
        status: "blocked",
        block_reason: detail,
        scheduled_for: null,
        checks: withSendChecks(draft, { money: checkResult([], []), compliance: checkResult([], problems, "blocked") }),
      });
      return { outcome: "blocked", reason: "no_recipients", detail, draft: updated };
    }
  }

  // All checks passed. Claim the draft in one atomic update so that two sends
  // racing each other can't both succeed.
  const claim = await supabase
    .from("drafts")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      scheduled_for: null,
      block_reason: null,
      updated_at: new Date().toISOString(),
      checks: withSendChecks(draft, { money: checkResult([], []), compliance }),
    })
    .eq("id", draft.id)
    .in("status", [...SENDABLE_STATUSES])
    .is("sent_at", null)
    .select("*")
    .maybeSingle<Draft>();
  const claimed = check(claim);
  if (!claimed) {
    const detail = "Another send of this draft got there first. Duplicates are blocked.";
    await logBlock(draft, "duplicate", detail);
    return { outcome: "blocked", reason: "duplicate", detail, draft };
  }

  // Email campaigns really go out (to the owner only, in test mode).
  // Everything else is still a simulated send: logged only.
  let note: string | undefined;
  let simulated = true;
  if (claimed.kind === "email_campaign") {
    const summary = await deliverCampaign(claimed, restaurant, now);
    note = deliveryNote(summary);
    simulated = summary.emailed === 0;
  } else if (claimed.kind === "review_reply" && claimed.review_id) {
    // Posted under the review (in dummy mode: saved against it).
    await google().replyToReview(restaurant.id, claimed.review_id, claimed.content);
    note = `💬 Reply posted on Google${google().mode === "dummy" ? " _(dummy Google: see the listing preview)_" : ""}.`;
    simulated = google().mode === "dummy";
  } else if (claimed.kind === "google_post") {
    const post = check(await supabase.from("google_posts").select("*").eq("draft_id", claimed.id).maybeSingle<GooglePost>());
    if (post) {
      // Publish the approved wording, which may have been edited since it was drafted.
      check(await supabase.from("google_posts").update({ text: claimed.content }).eq("id", post.id));
      await google().publishPost(restaurant.id, { ...post, text: claimed.content });
      note = `📍 Post published on Google${google().mode === "dummy" ? " _(dummy Google: see the listing preview)_" : ""}.`;
      simulated = google().mode === "dummy";
    }
  }

  const { error: logError } = await supabase.from("sent_log").insert({
    restaurant_id: claimed.restaurant_id,
    draft_id: claimed.id,
    customer_id: claimed.customer_id,
    channel:
      claimed.kind === "review_reply" || claimed.kind === "google_post" ? "google" : claimed.kind === "email_campaign" ? "email" : "whatsapp",
    recipient: note ? `${claimed.audience}: ${note}` : claimed.audience,
    content: claimed.content,
    status: "sent",
    simulated,
  });
  // 23505 = the database's one-row-per-draft guard caught a duplicate.
  if (logError && logError.code === "23505") await logBlock(claimed, "duplicate", "Sent log already has this draft.");
  else if (logError) throw new Error(logError.message);

  return { outcome: "sent", draft: claimed, note };
}

// Retries queued drafts that are due. Returns what happened to each one.
export async function processQueue(restaurant: Restaurant, now: Date) {
  if (restaurant.paused) return [];
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("status", "queued")
    .order("approved_at")
    .returns<Draft[]>();
  const due = (check(res) ?? []).filter((d) => !d.scheduled_for || new Date(d.scheduled_for) <= now);
  const results: SendResult[] = [];
  for (const d of due) results.push(await attemptSend(d.id, restaurant, now, "queue"));
  return results;
}
