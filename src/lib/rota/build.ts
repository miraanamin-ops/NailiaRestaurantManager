import "server-only";
import { randomBytes } from "node:crypto";
import { logAction, type Actor } from "@/lib/audit";
import { londonTime, londonYmd } from "@/lib/clock";
import { createDraft, focusDraft, getDraft, updateDraft, type Draft } from "@/lib/drafts";
import { getWeekAhead } from "@/lib/forecast/week-ahead";
import { addDaysYmd, weekDays, weekdayOf } from "@/lib/forecast/week-ahead-rules";
import type { Send } from "@/lib/google-jobs";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { db, must } from "@/lib/ops/db";
import { paidMinutes, rotaWeek } from "@/lib/ops/staff";
import type { RotaShiftRow, RotaWeekRow } from "@/lib/ops/types";
import { appUrl, type Restaurant } from "@/lib/supabase";
import { describeAdjustment, mergeAdjustments, parseRotaEdits } from "./edits";
import { buildPlan, usualFromHistory, type Adjustment, type FillInput, type RotaPlan } from "./fill";
import { getRotaInputs } from "./inputs";
import { publishedText, rotaDraftText, rotaWeekMessages, weekLabel, type Previous } from "./message";
import { signLink } from "@/lib/signed-links";
import { effectiveRules, openingFor, rotaSettings } from "./rules";
import type { RotaStaff, Weekday } from "./types";

// The rota suggester, start to finish (docs/pilot-sprint.md, "Rota suggester"):
// next week's team, opening hours and forecast (getRotaInputs, getWeekAhead),
// the greedy fill (./fill.ts), saved as the week's draft rota (rota_weeks and
// rota_shifts), then a draft on WhatsApp with Approve / Edit / Skip. Edits are
// kept on the week and re-applied on every re-fill. Approve publishes it on an
// unguessable link (/rota/<token>, and /rota/<token>/pdf).

export type RotaWeek = RotaWeekRow & { adjustments: Adjustment[] | null; summary: StoredPlan | null; draft_id: string | null; share_token: string | null };

// What the page and the PDF draw: the plan, plus who it's for (a snapshot, like the weekly report).
export type StoredPlan = RotaPlan & { weekStart: string; restaurant: { name: string; brand_color: string | null }; builtAt: string };

// History needed before the rota staffs to a forecast; under it, opening hours and minimums only.
export const MIN_HISTORY_WEEKS = 8;

// The Monday after today (next Monday if today is a Monday).
export const nextWeekStart = (today: string) => addDaysYmd(today, 8 - weekdayOf(today));

// The London instant `minutes` after midnight of a trading day (past 1440 = the next day).
export function instantOn(date: string, minutes: number) {
  const d = addDaysYmd(date, Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  const [y, mo, da] = d.split("-").map(Number);
  return londonTime(y, mo, da, Math.floor(m / 60), m % 60);
}

// Whole weeks from the first day with sales to today.
async function salesHistoryWeeks(restaurantId: string, today: string) {
  const first = must(
    await db().from("sales_days").select("day").eq("restaurant_id", restaurantId).order("day").limit(1).maybeSingle(),
    "first sales day",
  ) as { day: string } | null;
  if (!first) return 0;
  return Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${first.day}T12:00:00Z`)) / (7 * 86_400_000));
}

// Approved holiday, sickness and "can't" days in the week: staff id -> dates.
async function timeOffIn(restaurantId: string, weekStart: string) {
  const dates = weekDays(weekStart);
  const from = instantOn(dates[0], 0).toISOString();
  const to = instantOn(dates[6], 1440).toISOString();
  const rows = (must(
    await db()
      .from("staff_time_off")
      .select("staff_id, starts_at, ends_at, kind, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "approved")
      .in("kind", ["holiday", "sick", "unavailable"])
      .lt("starts_at", to)
      .gt("ends_at", from),
    "time off",
  ) ?? []) as { staff_id: string; starts_at: string; ends_at: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    for (const d of dates) {
      const a = instantOn(d, 0).getTime();
      const b = instantOn(d, 1440).getTime();
      if (Date.parse(r.starts_at) < b && Date.parse(r.ends_at) > a) (out[r.staff_id] ??= []).push(d);
    }
  }
  return out;
}

// Past rotas (approved or published) in the 8 weeks before: who usually works
// which day, and what the last one cost.
async function history(restaurantId: string, weekStart: string, staff: RotaStaff[]): Promise<{ usual: FillInput["usual"]; previous: Previous }> {
  const weeks = (must(
    await db()
      .from("rota_weeks")
      .select("id, week_start, status, summary")
      .eq("restaurant_id", restaurantId)
      .in("status", ["approved", "published"])
      .lt("week_start", weekStart)
      .gte("week_start", addDaysYmd(weekStart, -56))
      .order("week_start", { ascending: false }),
    "past rotas",
  ) ?? []) as { id: string; week_start: string; summary: StoredPlan | null }[];
  if (!weeks.length) return { usual: {}, previous: null };
  const shifts = (must(
    await db().from("rota_shifts").select("staff_id, business_date, starts_at, ends_at, break_minutes, rota_week_id").eq("restaurant_id", restaurantId).in("rota_week_id", weeks.map((w) => w.id)),
    "past shifts",
  ) ?? []) as Pick<RotaShiftRow, "staff_id" | "business_date" | "starts_at" | "ends_at" | "break_minutes" | "rota_week_id">[];
  const last = weeks[0];
  const rate = new Map(staff.map((p) => [p.id, p.hourly_rate_pence ?? 0]));
  const lastShifts = shifts.filter((s) => s.rota_week_id === last.id);
  const minutes = lastShifts.reduce((n, s) => n + paidMinutes(s), 0);
  // The cost as approved (its snapshot), else today's rates on its hours.
  const cost = last.summary?.totals?.costPence ?? Math.round(lastShifts.reduce((n, s) => n + (paidMinutes(s) / 60) * (s.staff_id ? (rate.get(s.staff_id) ?? 0) : 0), 0));
  return { usual: usualFromHistory(shifts), previous: { weekStart: last.week_start, costPence: cost, hours: Math.round(minutes / 6) / 10 } };
}

export type Built = { week: RotaWeek; plan: StoredPlan; previous: Previous } | { error: string };

// Builds the plan for a week from scratch with these edits (nothing saved).
export async function planWeek(r: Restaurant, weekStart: string, now: Date, adjustments: Adjustment[]): Promise<{ plan: StoredPlan; previous: Previous; staff: RotaStaff[] } | { error: string }> {
  const inputs = await getRotaInputs(r.id, weekStart);
  // Shifts point at real staff rows, so the dummy team (test mode) can't be rota'd.
  if (inputs.source !== "tables" || !inputs.staff.length) {
    return { error: `There's nobody on your team yet. Add people like this: *add Ali, kitchen, £13, weekdays*, or on the staff page: ${appUrl()}/staff?r=${r.id}` };
  }
  const [ahead, weeks, timeOff, past] = await Promise.all([
    getWeekAhead(r.id, weekStart, now),
    salesHistoryWeeks(r.id, londonYmd(now)),
    timeOffIn(r.id, weekStart),
    history(r.id, weekStart, inputs.staff),
  ]);
  const hasHourly = ahead.days.some((d) => d.orders_by_hour.length);
  const basis = weeks >= MIN_HISTORY_WEEKS && hasHourly ? "forecast" : "minimum";
  const rr = r as Restaurant & { special_hours?: Record<string, { hours: string }> | null; rota_settings?: Record<string, unknown> | null };
  const input: FillInput = {
    staff: inputs.staff,
    rules: effectiveRules(inputs.rules, inputs.staff),
    settings: rotaSettings(rr.rota_settings),
    basis,
    adjustments,
    timeOff,
    usual: past.usual,
    days: ahead.days.map((d) => ({
      date: d.date,
      weekday: d.weekday as Weekday,
      open: openingFor(d.date, d.weekday, r.opening_hours, rr.special_hours),
      ordersByHour: Object.fromEntries(d.orders_by_hour.map((h) => [h.hour, h.orders])),
      orders: d.orders,
      salesPence: d.sales_mid,
    })),
  };
  const plan = buildPlan(input);
  return {
    plan: { ...plan, weekStart, restaurant: { name: r.name, brand_color: (r as { brand_color?: string | null }).brand_color ?? null }, builtAt: new Date().toISOString() },
    previous: past.previous,
    staff: inputs.staff,
  };
}

// Saves a plan as the week's draft rota: its shifts replace the old ones.
async function saveWeek(r: Restaurant, week: RotaWeek, plan: StoredPlan, adjustments: Adjustment[]) {
  must(await db().from("rota_shifts").delete().eq("restaurant_id", r.id).eq("rota_week_id", week.id), "clear shifts");
  const rows = plan.days.flatMap((d) =>
    d.shifts.map((s) => ({
      restaurant_id: r.id,
      rota_week_id: week.id,
      staff_id: s.staffId,
      role: s.role,
      business_date: s.date,
      starts_at: instantOn(s.date, s.start).toISOString(),
      ends_at: instantOn(s.date, s.end).toISOString(),
      break_minutes: 0,
      source: "model",
    })),
  );
  if (rows.length) must(await db().from("rota_shifts").insert(rows), "save shifts");
  return must(
    await db()
      .from("rota_weeks")
      // The link exists from the first draft (the owner's preview); the team can open it once it's approved.
      .update({ adjustments, summary: plan, status: "draft", source: "model", share_token: week.share_token ?? newToken(), updated_at: new Date().toISOString() })
      .eq("restaurant_id", r.id)
      .eq("id", week.id)
      .select("*")
      .single(),
    "save rota week",
  ) as RotaWeek;
}

async function weekById(restaurantId: string, id: string) {
  return must(await db().from("rota_weeks").select("*").eq("restaurant_id", restaurantId).eq("id", id).maybeSingle(), "rota week") as RotaWeek | null;
}

const newToken = () => randomBytes(18).toString("base64url");

// The owner's preview of a draft: the full grid with costs, for 14 days.
export const PREVIEW_PURPOSE = "rota-preview";
export function previewUrl(week: Pick<RotaWeek, "share_token">) {
  if (!week.share_token) return null;
  try {
    return `${rotaUrl(week.share_token)}?preview=${signLink(PREVIEW_PURPOSE, week.share_token, 14 * 86_400_000)}`;
  } catch {
    return null; // no LINK_SECRET (tests): the card goes without the link
  }
}

async function sendDraft(send: Send, week: RotaWeek, plan: StoredPlan, card: string) {
  for (const text of rotaWeekMessages(week.week_start, plan)) await send(text);
  await send(card, true);
}

// Thursday 10am (and RUN ROTA): next week's rota as a draft for the owner.
// rebuild: start again even if there's one already (RUN ROTA); the Thursday job never overwrites one.
export async function suggestRota(r: Restaurant, opts: { now: Date; send: Send; mode: "present" | "urgent"; actor: Actor; rebuild: boolean }) {
  const weekStart = nextWeekStart(londonYmd(opts.now));
  const week = (await rotaWeek(r.id, weekStart, "model")) as RotaWeek;
  const done = week.status === "approved" || week.status === "published";
  if (!opts.rebuild && (week.draft_id || done)) return { skipped: `the rota for ${weekStart} is already ${done ? week.status : "drafted"}` };
  const built = await planWeek(r, weekStart, opts.now, opts.rebuild ? [] : (week.adjustments ?? []));
  if ("error" in built) {
    await opts.send(`🗓️ I couldn't suggest next week's rota (${weekLabel(weekStart)}). ${built.error}`);
    return { skipped: "no team" };
  }
  // A rebuild replaces any earlier draft for the week.
  if (week.draft_id) {
    const old = must(await db().from("drafts").select("id, status").eq("restaurant_id", r.id).eq("id", week.draft_id).maybeSingle(), "old rota draft") as { id: string; status: string } | null;
    if (old?.status === "pending") await updateDraft(old.id, { status: "superseded", waiting_for: null });
  }
  const saved = await saveWeek(r, week, built.plan, []);
  const card = rotaDraftText(weekStart, built.plan, { previous: built.previous, previewUrl: previewUrl(saved) });
  const draft = await createDraft({
    restaurantId: r.id,
    kind: "rota",
    content: card,
    audience: `w/c ${weekLabel(weekStart).split(" – ")[0]}`,
    request: opts.rebuild ? "RUN ROTA" : "Thursday rota",
    checks: {},
    mode: opts.mode,
    actor: opts.actor,
    agentInput: { rota_week_id: week.id, week_start: weekStart },
  });
  const linked = must(await db().from("rota_weeks").update({ draft_id: draft.id }).eq("restaurant_id", r.id).eq("id", week.id).select("*").single(), "link rota draft") as RotaWeek;
  await sendDraft(opts.send, linked ?? saved, built.plan, card);
  return { drafted: draft.id, weekStart, basis: built.plan.basis, costPence: built.plan.totals.costPence, flags: built.plan.flags.length };
}

const weekOf = (draft: Draft) => (draft.agent_input as { rota_week_id?: string } | null)?.rota_week_id ?? null;

// "Ali can't do Friday": re-fill with the edit and send the new draft. Returns
// false if nothing in the message was a rota edit (so it can be treated as chat).
export async function reviseRota(r: Restaurant, draft: Draft, message: string, opts: { now: Date; send: Send; useClaude: boolean; quietIfNotEdit?: boolean }) {
  const weekId = weekOf(draft);
  const week = weekId ? await weekById(r.id, weekId) : null;
  if (!week) {
    await opts.send("Sorry, I couldn't find that rota any more. Text RUN ROTA to start again.");
    return true;
  }
  const inputs = await getRotaInputs(r.id, week.week_start);
  let parsed = parseRotaEdits(message, inputs.staff, week.week_start);
  if (!parsed.adjustments.length && !parsed.unknownNames.length && opts.useClaude) {
    const { readEditsWithClaude } = await import("./ai");
    parsed = await readEditsWithClaude(message, inputs.staff, week.week_start);
  }
  if (!parsed.adjustments.length) {
    // On screen, a message that isn't clearly an edit ("how busy will Friday be?") is left for the assistant.
    if (opts.quietIfNotEdit) return false;
    const names = parsed.unknownNames.length ? `I don't know *${[...new Set(parsed.unknownNames)].join(", ")}* (your team: ${inputs.staff.map((p) => p.name).join(", ")}). ` : "";
    await opts.send(`${names}Tell me what to change, e.g. _Ali can't do Friday_, _Mo can do Sunday_ or _swap Sara and Bilal on Sunday_.`);
    return true;
  }
  if (parsed.unknownNames.length) await opts.send(`(I don't know *${[...new Set(parsed.unknownNames)].join(", ")}*, so I left that out.)`);
  await applyToWeek(r, week, parsed.adjustments, { now: opts.now, send: opts.send, note: message, draft });
  return true;
}

// The week's rota (or the one a person means, "this Friday"), made if it doesn't exist yet.
export async function weekFor(r: Restaurant, weekStart: string) {
  return (await rotaWeek(r.id, weekStart, "model")) as RotaWeek;
}

// Changes to a week's rota, however they were said (typed edits, or Claude's
// reading of a message: ./understand.ts): kept on the week, the whole week
// re-filled, and the new draft sent. A week not suggested yet just keeps them
// for Thursday; an approved week becomes a new draft to approve again.
export async function applyToWeek(r: Restaurant, week: RotaWeek, added: Adjustment[], opts: { now: Date; send: Send; note: string; draft?: Draft | null }) {
  const inputs = await getRotaInputs(r.id, week.week_start);
  const understood = added.map((a) => describeAdjustment(a, inputs.staff));
  const before = week.adjustments ?? [];
  const adjustments = mergeAdjustments(before, added);
  if (!week.summary && week.week_start <= londonYmd(opts.now)) {
    // A week already under way with no rota from us: nothing to change.
    await opts.send(`There's no rota from me for ${weekLabel(week.week_start)}, so there's nothing to change there. (The first one I make is next week's, suggested on Thursday.)`);
    return;
  }
  if (!week.summary) {
    // Not suggested yet: remember the change for Thursday.
    must(await db().from("rota_weeks").update({ adjustments, updated_at: new Date().toISOString() }).eq("restaurant_id", r.id).eq("id", week.id), "save rota edits");
    await logAction({ restaurantId: r.id, actor: "owner", action: "rota_settings", detail: `Noted for the rota of ${weekLabel(week.week_start)}: ${understood.join("; ")}`, data: { rota_week_id: week.id, before_adjustments: before } });
    await opts.send(`📝 Noted for ${weekLabel(week.week_start)}: ${understood.join("; ")}. I'll use it when I suggest that week's rota (Thursday 10am the week before).`);
    return;
  }
  const built = await planWeek(r, week.week_start, opts.now, adjustments);
  if ("error" in built) {
    await opts.send(built.error);
    return;
  }
  const wasPublished = week.status === "published" || week.status === "approved";
  const saved = await saveWeek(r, week, built.plan, adjustments);
  const card = rotaDraftText(week.week_start, built.plan, { previous: built.previous, understood, previewUrl: previewUrl(saved) });
  let draft = opts.draft ?? (week.draft_id ? await getDraft(week.draft_id).catch(() => null) : null);
  if (draft && draft.restaurant_id === r.id && draft.status === "pending") {
    draft = await updateDraft(draft.id, { content: card, version: draft.version + 1, status: "pending", waiting_for: "decision" });
    await focusDraft(draft, "decision");
  } else {
    draft = await createDraft({ restaurantId: r.id, kind: "rota", content: card, audience: `w/c ${weekLabel(week.week_start).split(" – ")[0]}`, request: opts.note.slice(0, 200), checks: {}, mode: "present", actor: "owner", agentInput: { rota_week_id: week.id, week_start: week.week_start } });
    must(await db().from("rota_weeks").update({ draft_id: draft.id }).eq("restaurant_id", r.id).eq("id", week.id), "link rota draft");
  }
  await logAction({
    restaurantId: r.id,
    draftId: draft.id,
    actor: "owner",
    action: "edited",
    detail: `Edited the rota for ${weekLabel(week.week_start)}: ${understood.join("; ")}`,
    data: { rota_week_id: week.id, before_adjustments: before, note: opts.note.slice(0, 200) },
  });
  if (wasPublished) await opts.send(`ℹ️ That week's rota was already approved. Here's the new version: its link is switched off until you approve this one.`);
  await sendDraft(opts.send, week, built.plan, card);
}

// UNDO of a rota edit: the edits as they were, re-filled and sent again.
export async function restoreRotaEdit(r: Restaurant, draft: Draft, beforeAdjustments: Adjustment[], now: Date) {
  const weekId = weekOf(draft);
  const week = weekId ? await weekById(r.id, weekId) : null;
  if (!week) return "That rota no longer exists.";
  const built = await planWeek(r, week.week_start, now, beforeAdjustments);
  if ("error" in built) return built.error;
  const saved = await saveWeek(r, week, built.plan, beforeAdjustments);
  await updateDraft(draft.id, { content: rotaDraftText(week.week_start, built.plan, { previous: built.previous, previewUrl: previewUrl(saved) }), version: draft.version + 1, status: "pending", waiting_for: "decision" });
  return `↩️ Undone: the rota for ${weekLabel(week.week_start)} is back as it was before that change. Text NEXT to see it.`;
}

export const rotaUrl = (token: string) => `${appUrl()}/rota/${token}`;

// Approve: the rota is published on its own unguessable link, with a PDF.
export async function approveRota(r: Restaurant, draft: Draft, send: Send, channel: OwnerChannel | null) {
  const weekId = weekOf(draft);
  const week = weekId ? await weekById(r.id, weekId) : null;
  if (!week || !week.summary) {
    await send("Sorry, I couldn't find that rota any more. Text RUN ROTA to start again.");
    return;
  }
  const now = new Date().toISOString();
  const token = week.share_token ?? newToken();
  must(
    await db()
      .from("rota_weeks")
      .update({ status: "published", approved_at: now, approved_by: "owner", published_at: now, share_token: token, updated_at: now })
      .eq("restaurant_id", r.id)
      .eq("id", week.id),
    "publish rota",
  );
  await updateDraft(draft.id, { status: "approved", approved_at: now, waiting_for: null });
  await logAction({ restaurantId: r.id, draftId: draft.id, actor: "owner", action: "approved", detail: `Approved and published the rota for ${weekLabel(week.week_start)}`, data: { rota_week_id: week.id } });
  const url = rotaUrl(token);
  await send(publishedText(week.week_start, url));
  // The PDF itself, ready to forward (WhatsApp fetches it, so only from a public https address).
  if (channel && url.startsWith("https://")) await messageOwner(channel, "", false, { mediaUrl: `${url}/pdf`, mediaCaption: "📄 The rota as a PDF, ready to forward" });
}

// UNDO of an approval: back to a draft (the link stops working until it's approved again).
export async function unpublishRota(r: Restaurant, draft: Draft) {
  const weekId = weekOf(draft);
  if (!weekId) return "That rota no longer exists.";
  must(
    await db().from("rota_weeks").update({ status: "draft", approved_at: null, approved_by: null, published_at: null, updated_at: new Date().toISOString() }).eq("restaurant_id", r.id).eq("id", weekId),
    "unpublish rota",
  );
  await updateDraft(draft.id, { status: "pending", approved_at: null, waiting_for: null });
  return "↩️ Undone: the rota is a draft again, and its link is switched off until you approve it. Text NEXT to see it.";
}

// The published rota for a link (null if there's none, or it isn't published).
export async function rotaByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const week = must(await db().from("rota_weeks").select("*").eq("share_token", token).maybeSingle(), "rota by link") as RotaWeek | null;
  return week && week.status === "published" && week.summary ? week : null;
}

// Any rota (a draft too) for a link, for the owner's signed preview.
export async function rotaForPreview(token: string, signature: string | null | undefined) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { verifyLink } = await import("@/lib/signed-links");
  if (!verifyLink(PREVIEW_PURPOSE, token, signature)) return null;
  const week = must(await db().from("rota_weeks").select("*").eq("share_token", token).maybeSingle(), "rota preview") as RotaWeek | null;
  return week?.summary ? week : null;
}
