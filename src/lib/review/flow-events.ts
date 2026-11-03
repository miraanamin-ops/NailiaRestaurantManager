import "server-only";
import { logAction } from "@/lib/audit";
import { londonYmd } from "@/lib/clock";
import { check, type Draft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { AUDIENCE_LABELS, CALENDAR_EVENTS, relevantEvents, type Audience } from "./calendar-events";
import { EVENTS_DAYS } from "./config";
import type { FlowCtx, StepHandler, StepOutcome } from "./flow-run";
import type { PartResults } from "./types";

// Two steps of the guided flow: which community dates to plan for (asked, never
// worked out from the cuisine), and the planned campaigns and posts.

const db = () => getSupabase();
const COMMUNITIES = Object.keys(AUDIENCE_LABELS) as Exclude<Audience, "all">[];

async function eventsResult(ctx: FlowCtx) {
  const row = check(await db().from("business_review_parts").select("result, status").eq("review_id", ctx.review.id).eq("part", "events").maybeSingle<{ result: PartResults["events"] | null; status: string }>());
  return row?.status === "done" ? row.result : null;
}

async function askAudiences(ctx: FlowCtx, chosen: string[]): Promise<StepOutcome> {
  const left = COMMUNITIES.filter((a) => !chosen.includes(a));
  const head = chosen.length
    ? `Got it: ${chosen.map((a) => AUDIENCE_LABELS[a as keyof typeof AUDIENCE_LABELS]).join(", ")}. Anything else?`
    : "📅 *Which dates should I plan for?*\n\nSome dates matter more to some customers. Should I plan campaigns for any of these as well? Pick one at a time.";
  await ctx.say(head, [...left.map((a) => ctx.button("audiences", `add-${a}`, AUDIENCE_LABELS[a])), ctx.button("audiences", chosen.length ? "done" : "none", chosen.length ? "That's all" : "None of these")]);
  return "stay";
}

export const audiences: StepHandler = {
  // Only while the owner hasn't told us (null), once the dates are in.
  available: async (ctx) => {
    const r = check(await db().from("restaurants").select("event_audiences").eq("id", ctx.restaurant.id).maybeSingle<{ event_audiences: string[] | null }>());
    return r?.event_audiences == null && Boolean(await eventsResult(ctx));
  },
  show: (ctx) => askAudiences(ctx, ctx.state().audiences ?? []),
  choose: async (ctx, choice) => {
    const chosen = ctx.state().audiences ?? [];
    if (choice.startsWith("add-")) {
      const a = choice.slice(4);
      if (!(COMMUNITIES as string[]).includes(a)) return "stay";
      const next = [...new Set([...chosen, a])];
      await ctx.setState({ audiences: next });
      if (next.length === COMMUNITIES.length) return audiences.choose(ctx, "done");
      return askAudiences(ctx, next);
    }
    const final = choice === "none" ? [] : chosen;
    check(await db().from("restaurants").update({ event_audiences: final }).eq("id", ctx.restaurant.id));
    ctx.restaurant.event_audiences = final;
    await logAction({ restaurantId: ctx.restaurant.id, actor: "owner", action: "setting", detail: final.length ? `Plan for: ${final.map((a) => AUDIENCE_LABELS[a as keyof typeof AUDIENCE_LABELS]).join(", ")}` : "Plan for: dates for everyone only", data: { field: "event_audiences", before: null, after: final } });
    // The community dates now in the next 30 days get their campaign and post too.
    const events = relevantEvents(CALENDAR_EVENTS, final, londonYmd(new Date()), EVENTS_DAYS).filter((e) => e.audience !== "all");
    if (!events.length) {
      await ctx.say(final.length ? "👍 Noted. Nothing for those in the next 30 days, so I'll plan them as they come up." : "👍 Noted: I'll plan around the dates that matter to everyone.");
      return "done";
    }
    const { draftForEvents } = await import("./parts/events");
    const n = await draftForEvents(ctx.restaurant, ctx.review.id, events.slice(0, 2));
    await ctx.say(`👍 Noted. I've drafted ${n === 1 ? "1 more" : `${n} more`} for ${events.slice(0, 2).map((e) => e.name).join(" and ")}: they're in the next step.`);
    return "done";
  },
};

// ---------- The planned campaigns and posts ----------

async function planned(ctx: FlowCtx) {
  return (check(await db().from("drafts").select("*").eq("restaurant_id", ctx.restaurant.id).eq("business_review_id", ctx.review.id).in("kind", ["email_campaign", "google_post"]).eq("status", "pending").order("created_at")) ?? []) as Draft[];
}

async function showable(ctx: FlowCtx) {
  const all = await planned(ctx);
  const held = (await eventsResult(ctx))?.emailsHeld ?? false;
  // No subscribers yet: the emails wait (there's nobody to send them to); posts can go.
  return { all, now: held ? all.filter((d) => d.kind === "google_post") : all, held };
}

async function nextPlanned(ctx: FlowCtx, decidedId: string | null): Promise<StepOutcome> {
  const { now } = await showable(ctx);
  const queue = (ctx.state().queue ?? []).filter((id) => id !== decidedId && now.some((d) => d.id === id));
  await ctx.setState({ queue });
  if (!queue.length) return "done";
  const total = ctx.state().queueTotal ?? queue.length;
  const d = now.find((x) => x.id === queue[0])!;
  await ctx.turn.send(`*${total - queue.length + 1} of ${total}*\n\n${draftMessage(d, ctx.restaurant)}`, { draftId: d.id });
  return "stay";
}

export const campaigns: StepHandler = {
  available: async (ctx) => (await planned(ctx)).length > 0,
  show: async (ctx) => {
    const { all, now, held } = await showable(ctx);
    const emails = all.filter((d) => d.kind === "email_campaign").length;
    const posts = all.filter((d) => d.kind === "google_post").length;
    const lines = [
      "📅 *Planned for the next 30 days*",
      "",
      ...(posts ? [`📍 ${posts === 1 ? "1 Google post" : `${posts} Google posts`}, ready to approve.`] : []),
      ...(emails ? [`📧 ${emails === 1 ? "1 email campaign" : `${emails} email campaigns`}${held ? ": nobody is on your customer list yet, so I'll keep them until people sign up with your QR poster." : ", ready to approve."}`] : []),
    ];
    if (!now.length) {
      await ctx.say(lines.join("\n"));
      return "done";
    }
    await ctx.say(lines.join("\n"), [ctx.button("campaigns", "go", "Go through them"), ctx.button("campaigns", "skip", "Skip")]);
    return "stay";
  },
  choose: async (ctx, choice) => {
    if (choice !== "go") {
      await ctx.say("👍 They'll wait for you in tomorrow morning's brief.");
      return "done";
    }
    const ids = (await showable(ctx)).now.map((d) => d.id);
    await ctx.setState({ queue: ids, queueTotal: ids.length });
    return nextPlanned(ctx, null);
  },
  afterDecision: (ctx, draft) => nextPlanned(ctx, draft.id),
};
