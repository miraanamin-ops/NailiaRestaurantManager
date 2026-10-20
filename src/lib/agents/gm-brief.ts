import "server-only";
import { doneTally, sendBrief, sendForecastOffer, waitingDrafts, type BriefOutcome } from "@/lib/brief";
import { briefForecast } from "@/lib/forecast";
import { londonMinutes, londonTimeOn } from "@/lib/clock";
import { check, updateDraft, type Draft } from "@/lib/drafts";
import { draftPreviewUrl } from "@/lib/email/previews";
import { feedbackForBrief, markFeedbackReported } from "@/lib/feedback";
import { draftMessage } from "@/lib/format";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import type { ReportData } from "@/lib/report/types";
import type { ButtonTarget } from "@/lib/whatsapp";
import type { Send } from "@/lib/google-jobs";
import { zNudgeFor } from "@/lib/sales/z-reports";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { composeBrief } from "./gm";
import { runComposer } from "./gm-core";
import { alertTime } from "./gm-rules";
import { recordAgentRun } from "./jobs";

// The GM live (see gmMode): the morning brief, the Monday report message and
// alerts, written by the composer around what code decides: which cards (at most 5,
// ranked), the receipts, when an alert may go (one an hour, never in quiet hours).
// If the composer fails, today's brief goes instead.

const HOUR = 60 * 60 * 1000;

function buttonsFor(d: Draft, briefNumber?: number): boolean | ButtonTarget {
  if (d.kind === "agent_question") return false;
  const buttons = d.kind === "review_question" ? "question" : d.kind === "hours_question" ? "hours" : d.kind === "special_idea" ? "idea" : "approval";
  return { draftId: d.id, briefNumber, buttons };
}

// ---------- The morning brief ----------

export async function gmBrief(r: Restaurant, channel: OwnerChannel, now: Date, opts: { extra?: string[]; note?: string } = {}): Promise<BriefOutcome> {
  const all = await waitingDrafts(r.id);
  const tally = await doneTally(r.id, new Date(now.getTime() - 24 * HOUR), now);
  const feedback = await feedbackForBrief(r.id);
  const nudge = await zNudgeFor(r, now).catch(() => null);
  // Receipts come from code; the composer only words them.
  const receipts = [...tally, ...(opts.extra ?? []), ...feedback.lines, ...(nudge ? [nudge] : [])];
  // Today's forecast: code's own lines, added after the composer's summary unchanged
  // (the same lines today's brief shows; the composer never sees or rewords them).
  const forecast = await briefForecast(r, now);
  if (!all.length && !tally.length && !receipts.length && !forecast.block) return { sent: false, items: 0, tally };

  let brief: Awaited<ReturnType<typeof composeBrief>>;
  try {
    brief = await composeBrief(r, all, receipts, "the morning brief (live)");
  } catch (err) {
    console.error("The GM couldn't write the brief; today's brief goes instead", err);
    return sendBrief(r, channel, now, opts);
  }
  const byId = new Map(all.map((d) => [d.id, d]));
  const cards = brief.cards.map((c) => ({ ...c, draft: byId.get(c.draft_id)! })).filter((c) => c.draft);
  const briefAt = new Date().toISOString();
  for (const [i, c] of cards.entries()) await updateDraft(c.draft.id, { brief_number: i + 1, briefed_at: briefAt });
  check(await getSupabase().from("restaurants").update({ last_brief_at: briefAt, brief_waiting_since: null }).eq("id", r.id));

  await messageOwner(channel, gmSummaryText(brief.summary, forecast.block, opts.note));
  await sendForecastOffer(channel, forecast);
  await markFeedbackReported(r.id, feedback.ids);
  for (const [i, c] of cards.entries()) {
    const d = c.draft;
    const answer = d.kind === "agent_question" ? "\n\n_Reply with your answer._" : "";
    await messageOwner(channel, `*${i + 1} of ${cards.length}*\n${c.card}\n\n${draftMessage(d, r)}${answer}`, buttonsFor(d, i + 1), { mediaUrl: draftPreviewUrl(d) });
  }
  await recordAgentRun({
    restaurantId: r.id,
    key: `gm:brief:live:${r.id}:${briefAt}`,
    agent: "gm",
    kind: "gm_live",
    trigger: "morning_brief_9am",
    output: { cards: cards.length, rolled: brief.rolled.length },
    agentVersion: "gm",
    verdict: "brief",
    usage: brief.usage,
  });
  return { sent: true, items: cards.length, tally };
}

// The GM's summary message: the composer's words, then the forecast block exactly as code wrote it.
export function gmSummaryText(summary: string, forecast: string | null, note?: string) {
  return [summary, forecast, note].filter(Boolean).join("\n\n");
}

// ---------- The Monday report message ----------

// The 2-line message: the headline number and the one action that matters most, then the link.
export async function gmReportMessage(r: Restaurant, report: { url: string; data: ReportData }) {
  let headline = "";
  let action: { title: string; why: string } | undefined;
  for (const s of report.data.sections) {
    if (s.id === "headline") headline = s.sentence;
    if (s.id === "actions") action = s.actions[0];
  }
  if (!headline || !action) return null;
  try {
    const out = await runComposer(
      { kind: "report", owner: { owner_name: r.owner_name, language: r.owner_language, restaurant: r.name }, report: { headline, top_action: `${action.title}: ${action.why}`, url: report.url } },
      "the Monday report message",
    );
    return `📊 ${out.output.message}\n${report.url}`;
  } catch (err) {
    console.error("The GM couldn't write the Monday message", err);
    return null;
  }
}

// ---------- Alerts: one an hour, never in quiet hours ----------

async function lastAlertAt(restaurantId: string) {
  const row = check(
    await getSupabase()
      .from("owner_alerts")
      .select("sent_at")
      .eq("restaurant_id", restaurantId)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ sent_at: string }>(),
  );
  return row ? new Date(row.sent_at) : null;
}

// When a held alert may go: the end of quiet hours, or an hour after the last one.
function dueAt(r: Restaurant, now: Date, reason: "quiet_hours" | "hourly_limit", last: Date | null) {
  if (reason === "hourly_limit" && last) return new Date(last.getTime() + HOUR);
  const end = (r.quiet_hours_end ?? "09:00").slice(0, 5);
  const today = londonTimeOn(now, end, 0);
  return today > now ? today : londonTimeOn(now, end, 1);
}

// The alert's words: the composer's line, then the facts from code (e.g. the review
// itself) and the draft. Without a draft (bad private feedback), code's own wording.
async function alertText(r: Restaurant, draft: Draft | null, detail: string) {
  if (!draft) return detail;
  const out = await runComposer(
    { kind: "alert", owner: { owner_name: r.owner_name, language: r.owner_language, restaurant: r.name }, draft: { kind: draft.kind, audience: draft.audience ?? "", content: draft.content, expected_outcome: null } },
    "an alert",
  ).catch((err) => {
    console.error("The GM couldn't word an alert; code's wording goes instead", err);
    return null;
  });
  if (out) {
    await recordAgentRun({ restaurantId: r.id, key: `gm:alert:${draft.id}:${Date.now()}`, agent: "gm", kind: "gm_live", trigger: "alert", output: { draft_id: draft.id }, agentVersion: "gm", verdict: "alert", usage: out.usage });
  }
  return `🚨 ${out?.output.message ?? "This needs your decision."}${detail ? `\n\n${detail}` : ""}\n\n${draftMessage(draft, r)}`;
}

export type GmAlert = { draft?: Draft | null; detail: string };

// An urgent alert (a 1 to 3 star review with its reply, bad private feedback): sent
// now, or held until quiet hours end or an hour after the last alert.
export async function gmAlert(r: Restaurant, send: Send, now: Date, alert: GmAlert) {
  const last = await lastAlertAt(r.id);
  const when = alertTime({ now, londonMinutes: londonMinutes(now), quietStart: r.quiet_hours_start, quietEnd: r.quiet_hours_end, lastAlertAt: last });
  const draft = alert.draft ?? null;
  if (when.send === "now") {
    const text = await alertText(r, draft, alert.detail);
    await send(text, draft ? buttonsFor(draft) : false);
    check(await getSupabase().from("owner_alerts").insert({ restaurant_id: r.id, draft_id: draft?.id ?? null, text, reason: "sent", due_at: now.toISOString(), sent_at: now.toISOString() }));
    return "sent" as const;
  }
  // Held: off the screen until it's sent (it's in the next brief if that comes first).
  if (draft) await updateDraft(draft.id, { waiting_for: null });
  check(
    await getSupabase()
      .from("owner_alerts")
      .insert({ restaurant_id: r.id, draft_id: draft?.id ?? null, text: alert.detail, reason: when.reason, due_at: dueAt(r, now, when.reason, last).toISOString() }),
  );
  return "held" as const;
}

// The hourly job: the oldest held alert that's due, if one may go now (one an hour).
export async function releaseAlerts(r: Restaurant, send: Send, now: Date) {
  const due =
    check(
      await getSupabase()
        .from("owner_alerts")
        .select("id, draft_id, text, created_at")
        .eq("restaurant_id", r.id)
        .is("sent_at", null)
        .lte("due_at", now.toISOString())
        .order("due_at")
        .returns<{ id: string; draft_id: string | null; text: string; created_at: string }[]>(),
    ) ?? [];
  for (const next of due) {
    const draft = next.draft_id ? check(await getSupabase().from("drafts").select("*").eq("restaurant_id", r.id).eq("id", next.draft_id).maybeSingle<Draft>()) : null;
    // Dealt with already, or shown in a brief since: nothing to send (and it doesn't
    // count towards the one-an-hour limit).
    if (next.draft_id && (draft?.status !== "pending" || (draft.briefed_at && draft.briefed_at > next.created_at))) {
      check(await getSupabase().from("owner_alerts").delete().eq("restaurant_id", r.id).eq("id", next.id));
      continue;
    }
    const when = alertTime({ now, londonMinutes: londonMinutes(now), quietStart: r.quiet_hours_start, quietEnd: r.quiet_hours_end, lastAlertAt: await lastAlertAt(r.id) });
    if (when.send !== "now") return null;
    const text = await alertText(r, draft, next.text);
    if (draft) await updateDraft(draft.id, { waiting_for: "decision" });
    await send(text, draft ? buttonsFor(draft) : false);
    check(await getSupabase().from("owner_alerts").update({ sent_at: now.toISOString(), text }).eq("restaurant_id", r.id).eq("id", next.id));
    return next.id;
  }
  return null;
}
