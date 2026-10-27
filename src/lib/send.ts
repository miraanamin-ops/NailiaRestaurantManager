import "server-only";
import { deliverCampaign, deliveryNote, ensureUnsubscribeTokens, getCampaignForDraft, recipientsFor } from "@/lib/campaigns";
import { emailComplianceProblems } from "@/lib/checks/compliance";
import { moneyAndRisk, type SendSource } from "@/lib/checks/money";
import { checkResult, type CheckResult, type DraftChecks } from "@/lib/checks/types";
import { googleFor, type GooglePost } from "@/lib/google";
import { GoogleApiError } from "@/lib/google/api";
import { GoogleAuthError } from "@/lib/google/oauth";
import { WriteInProgressError } from "@/lib/google/writes";
import { logAction } from "@/lib/audit";
import { check, draftName, getDraft, updateDraft, type Draft } from "@/lib/drafts";
import { CHECKED_GOOGLE_KINDS, channelFor, googleCheckerStep, simulationStep } from "@/lib/gate-rules";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { emailRedirectSwitch, googleSwitch } from "@/lib/switches";

// Sending. Every send goes through attemptSend, which runs the two code checks
// right before anything goes out and records the result on the draft:
//   money and risk (lib/checks/money.ts): duplicates, approval, discount cap, PAUSE, sending hours
//   compliance (lib/checks/compliance.ts): for emails, valid consent now and an unsubscribe link
//   the checker (lib/gate-rules.ts googleCheckerStep): with it live, a Google reply or post
//   needs its pass on that exact version

export type { SendSource };
export type BlockReason = "not_approved" | "duplicate" | "discount_cap" | "paused" | "outside_window" | "no_recipients" | "trust_level" | "weekly_limit" | "scheduled" | "google_error" | "checker";

export type SendResult =
  | { outcome: "sent"; draft: Draft; note?: string }
  | { outcome: "queued"; reason: "paused" | "outside_window" | "scheduled"; scheduledFor: Date | null; detail: string; draft: Draft }
  | { outcome: "blocked"; reason: "not_approved" | "duplicate" | "discount_cap" | "no_recipients" | "trust_level" | "weekly_limit" | "google_error" | "checker"; detail: string; draft: Draft };

const SENDABLE_STATUSES = ["approved", "queued", "blocked"] as const;

async function logBlock(draft: Draft, reason: BlockReason, detail: string) {
  const held = reason === "paused" || reason === "outside_window";
  await logAction({
    restaurantId: draft.restaurant_id,
    draftId: draft.id,
    actor: "safety rules",
    action: held ? "queued" : "blocked",
    detail: `${held ? "Held" : "Blocked"} ${draftName(draft)}: ${detail}`,
  });
  const { error } = await getSupabase().from("blocked_sends").insert({
    restaurant_id: draft.restaurant_id,
    draft_id: draft.id,
    reason,
    detail,
  });
  if (error) console.error("Failed to log blocked send", error);
}

// The send-time results of the two code checks, kept alongside the draft-time ones.
function withSendChecks(draft: Draft, send: Partial<Record<"compliance" | "money" | "test_mode", CheckResult>>): DraftChecks {
  return { ...(draft.checks ?? {}), send: { ...(draft.checks?.send ?? {}), ...send } };
}

export async function attemptSend(draftId: string, restaurant: Restaurant, now: Date, source: SendSource): Promise<SendResult> {
  const supabase = getSupabase();
  const draft = await getDraft(draftId);

  // 0. A restaurant can only ever send its own drafts.
  if (draft.restaurant_id !== restaurant.id) {
    const detail = "This draft belongs to a different restaurant, so it can't be sent from here.";
    console.error("attemptSend: draft and restaurant don't match", { draftId, restaurantId: restaurant.id });
    return { outcome: "blocked", reason: "not_approved", detail, draft };
  }

  // 1. Money and risk (a campaign's structured offer, if it has one, is checked against the cap).
  const campaignRow = draft.kind === "email_campaign" ? await getCampaignForDraft(draft.id) : null;
  const rules = moneyAndRisk({ ...draft, offer_details: campaignRow?.offer_details ?? null, send_at: campaignRow?.send_at ?? null }, restaurant, now, source);
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
  // Sent without the owner's tap: its task is on Auto and the live checker passed it.
  const auto = rules.approvedBy === "auto";

  // 2. Compliance: email campaigns only go to customers with valid consent right
  //    now (not unsubscribed), and every one of those emails has an unsubscribe link.
  //    Nobody gets more than one campaign in 7 days (birthday emails excepted).
  const compliance = checkResult([], []);
  if (draft.kind === "email_campaign") {
    const campaign = await getCampaignForDraft(draft.id);
    const { eligible, excluded, limited } = campaign
      ? await recipientsFor(restaurant, campaign.segment, now, { isBirthday: campaign.is_birthday })
      : { eligible: [], excluded: 0, limited: 0 };
    const missingUnsubscribe = await ensureUnsubscribeTokens(eligible.map((c) => c.id));
    const problems = emailComplianceProblems({ eligible: eligible.length, excluded, missingUnsubscribe, limited });
    if (problems.length) {
      const detail = problems.join(" ");
      const reason = !eligible.length && limited ? "weekly_limit" : "no_recipients";
      await logBlock(draft, reason, detail);
      const updated = await updateDraft(draft.id, {
        status: "blocked",
        block_reason: detail,
        scheduled_for: null,
        checks: withSendChecks(draft, { money: checkResult([], []), compliance: checkResult([], problems, "blocked") }),
      });
      return { outcome: "blocked", reason, detail, draft: updated };
    }
  }

  // 2b. The checker: with it live, a Google reply or post goes out only once it
  //     passed this exact version (an owner's edit is checked here, before it goes).
  const checkerProblem = await googleCheckerGate(draft, restaurant);
  if (checkerProblem) {
    await logBlock(draft, "checker", checkerProblem);
    const updated = await updateDraft(draft.id, {
      status: "blocked",
      block_reason: checkerProblem,
      scheduled_for: null,
      checks: withSendChecks(draft, { money: checkResult([], []), compliance: checkResult([], [checkerProblem], "blocked") }),
    });
    return { outcome: "blocked", reason: "checker", detail: checkerProblem, draft: updated };
  }

  // 3. Simulation, as a gate step: GOOGLE_MODE=simulated posts nothing to Google,
  //    EMAIL_REDIRECT keeps emails away from customers (lib/switches.ts).
  //    (WhatsApp to customers stays off until Meta verification.)
  const testStep = simulationStep({ channel: channelFor(draft.kind), google: googleSwitch(process.env).mode, emailRedirect: emailRedirectSwitch(process.env).on });
  const testCheck = checkResult(testStep.outcome === "simulate" ? [testStep.detail] : [], [], "pass");
  const reachesPlatform = testStep.outcome === "ok";

  // All checks passed. Claim the draft in one atomic update so that two sends
  // racing each other can't both succeed.
  const claim = await supabase
    .from("drafts")
    // Only this restaurant's own draft can be claimed for sending.
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      scheduled_for: null,
      block_reason: null,
      updated_at: new Date().toISOString(),
      checks: withSendChecks(draft, { money: checkResult([], []), compliance, test_mode: testCheck }),
      // Auto: approved by the trust level and the checker, at the moment it goes out.
      ...(auto ? { approved_at: new Date().toISOString(), waiting_for: null } : {}),
    })
    .eq("restaurant_id", restaurant.id)
    .eq("id", draft.id)
    .in("status", auto ? [...SENDABLE_STATUSES, "pending"] : [...SENDABLE_STATUSES])
    .is("sent_at", null)
    .select("*")
    .maybeSingle<Draft>();
  const claimed = check(claim);
  if (!claimed) {
    const detail = "Another send of this draft got there first. Duplicates are blocked.";
    await logBlock(draft, "duplicate", detail);
    return { outcome: "blocked", reason: "duplicate", detail, draft };
  }
  if (auto) {
    await logAction({
      restaurantId: claimed.restaurant_id,
      draftId: claimed.id,
      actor: "safety rules",
      action: "approved",
      detail: `Approved ${draftName(claimed)} on Auto (its task is set to Auto and the checker passed it)`,
    });
  }

  // Email campaigns really go out (to the builder and owner only, with EMAIL_REDIRECT on).
  // Everything else is still a simulated send: logged only.
  let note: string | undefined;
  let simulated = true;
  if (claimed.kind === "email_campaign") {
    const summary = await deliverCampaign(claimed, restaurant, now);
    note = deliveryNote(summary);
    simulated = summary.emailed === 0;
  } else if (!reachesPlatform) {
    // Simulated Google (or customer WhatsApp): nothing goes out; it is logged as simulated.
    note = `🧪 ${testStep.detail}`;
  } else if (claimed.kind === "review_reply" || claimed.kind === "google_post" || claimed.kind === "hours_update" || claimed.kind === "menu_update") {
    // Google: this restaurant's own connector (live once it has linked its location, else dummy).
    const g = await googleFor(restaurant.id);
    const dummy = g.mode === "dummy";
    const where = dummy ? "on Google _(dummy Google: see the listing preview)_" : "on Google";
    try {
      if (claimed.kind === "review_reply" && claimed.review_id) {
        // Posted under the review (in dummy mode: saved against it).
        await g.replyToReview(restaurant.id, claimed.review_id, claimed.content);
        note = `💬 Reply posted ${where}.`;
        simulated = dummy;
      } else if (claimed.kind === "google_post") {
        const post = check(await supabase.from("google_posts").select("*").eq("draft_id", claimed.id).maybeSingle<GooglePost>());
        if (post) {
          // Publish the approved wording, which may have been edited since it was drafted.
          check(await supabase.from("google_posts").update({ text: claimed.content }).eq("id", post.id));
          await g.publishPost(restaurant.id, { ...post, text: claimed.content });
          note = `📍 Post published ${where}.`;
          simulated = dummy;
        }
      } else if (claimed.kind === "hours_update" && g.updateHours) {
        // The profile already has the new hours: copy them (and special hours) to Google.
        await g.updateHours(restaurant.id, claimed.id);
        note = "📍 Your hours are updated on Google.";
        simulated = false;
      } else {
        // Dummy Google can't change hours, and nobody's connector can change the menu yet:
        // it's logged as what would have been sent.
        const change = (claimed.agent_input as { change?: { from: string; to: string } } | null)?.change;
        note = `📍 Would have updated your ${claimed.kind === "menu_update" ? "menu" : "hours"} on Google${change ? ` to: ${change.to}` : ""} _(${claimed.kind === "menu_update" && !dummy ? "Google's menu can't be changed from here yet, so update it in your Business Profile" : "not connected to Google yet, so nothing changed there"})_.`;
      }
    } catch (err) {
      return googleFailed(claimed, err, now);
    }
  }

  const { error: logError } = await supabase.from("sent_log").insert({
    restaurant_id: claimed.restaurant_id,
    draft_id: claimed.id,
    customer_id: claimed.customer_id,
    channel: channelFor(claimed.kind),
    recipient: note ? `${claimed.audience}: ${note}` : claimed.audience,
    content: claimed.content,
    status: "sent",
    simulated,
  });
  // 23505 = the database's one-row-per-draft guard caught a duplicate.
  if (logError && logError.code === "23505") await logBlock(claimed, "duplicate", "Sent log already has this draft.");
  else if (logError) throw new Error(logError.message);

  await logAction({
    restaurantId: claimed.restaurant_id,
    draftId: claimed.id,
    actor: "system",
    action: "sent",
    detail: `Sent ${draftName(claimed)}${simulated ? " (simulated)" : ""}${note ? `: ${note.replace(/[_*]/g, "")}` : ""}`,
    data: { source, simulated },
  });
  return { outcome: "sent", draft: claimed, note };
}

// The checker step for a Google write: null = fine to go. A version with no live
// verdict yet is checked now (and recorded as an agent run, with its cost).
async function googleCheckerGate(draft: Draft, restaurant: Restaurant): Promise<string | null> {
  if (!CHECKED_GOOGLE_KINDS.has(draft.kind)) return null;
  const { agentMode } = await import("@/lib/agents/modes");
  const input = { kind: draft.kind, checkerLive: agentMode(restaurant, "checker") === "live", version: draft.version ?? 1, agentCheck: draft.agent_check };
  let step = googleCheckerStep(input);
  if (step.outcome === "check_now") {
    try {
      const [{ checkDraftVersion }, { recordAgentRun }] = await Promise.all([import("@/lib/agents/checker"), import("@/lib/agents/jobs")]);
      const key = `checker:${draft.id}:v${input.version}:send:${Date.now()}`;
      const { agentCheck, result } = await checkDraftVersion(draft, input.version, "live", key);
      await recordAgentRun({ restaurantId: restaurant.id, key, agent: "checker", kind: "checker_live", trigger: "release_gate", draftId: draft.id, output: { ...agentCheck }, agentVersion: result.agentVersion, verdict: agentCheck.verdict, usage: result.usage });
      step = googleCheckerStep({ ...input, agentCheck });
    } catch (err) {
      console.error("The checker couldn't check a Google write", err);
      return "The checker couldn't look at it just now, so it wasn't posted. Tap Approve again in a minute.";
    }
  }
  return step.outcome === "blocked" ? step.detail : null;
}

// Google didn't take a write. The draft was claimed as sent, so it's put back:
// held for a retry in an hour (rate limits, Google's own errors, a login that
// needs reconnecting, which the owner has been sent a link for), or blocked if
// Google refused it outright (trying again won't change that).
export const GOOGLE_RETRY_MS = 60 * 60_000;
async function googleFailed(draft: Draft, err: unknown, now: Date): Promise<SendResult> {
  console.error("Google write failed", err);
  const message = err instanceof Error ? err.message : String(err);
  const refused = err instanceof GoogleApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
  const detail =
    err instanceof GoogleAuthError
      ? "Google needs you to sign in again (I've sent you the link). I'll post it once you have."
      : err instanceof WriteInProgressError
        ? "It's already on its way to Google."
        : refused
          ? `Google refused it: ${message.slice(0, 200)}`
          : "Google didn't respond properly just now. I'll try again in an hour.";
  const scheduledFor = refused ? null : new Date(now.getTime() + GOOGLE_RETRY_MS);
  await logBlock(draft, refused ? "google_error" : "scheduled", detail);
  const updated = await updateDraft(draft.id, {
    status: refused ? "blocked" : "queued",
    sent_at: null,
    scheduled_for: scheduledFor?.toISOString() ?? null,
    block_reason: detail,
  });
  return refused ? { outcome: "blocked", reason: "google_error", detail, draft: updated } : { outcome: "queued", reason: "scheduled", scheduledFor, detail, draft: updated };
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
