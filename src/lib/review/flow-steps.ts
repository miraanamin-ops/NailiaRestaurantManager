import "server-only";
import { dryRunContext, googleDryRunReason } from "@/lib/gate-rules";
import { draftMessage } from "@/lib/format";
import { googleModeFor } from "@/lib/google";
import { check, approveDraft, type Draft } from "@/lib/drafts";
import { attemptSend } from "@/lib/send";
import { getSupabase } from "@/lib/supabase";
import { clip } from "@/lib/text";
import { audiences, campaigns } from "./flow-events";
import type { PartResults } from "./types";
import type { FlowStep } from "./flow";
import type { FlowCtx, StepHandler, StepOutcome } from "./flow-run";

// Each step of the guided flow, once it's built. A step not listed is passed over.

const stars = (n: number | null) => "⭐".repeat(Math.max(1, Math.min(5, n ?? 0)));

type ReplyDraft = Awaited<ReturnType<typeof import("./replies").repliesFor>>["all"][number];

// One reply on screen with its own Approve / Edit / Skip (or, for a question
// about a review, Reply publicly / Handle privately / Both). The usual decisions
// handle the tap; afterDecision then shows the next one.
async function present(ctx: FlowCtx, d: ReplyDraft, n: number, of: number) {
  const quote = `${stars(d.rating)} ${d.reviewAuthor ?? "A customer"}: "${clip(d.reviewText ?? "(rating only)", 220)}"`;
  const text = `*${n} of ${of}*\n${quote}\n\n${draftMessage(d, ctx.restaurant)}`;
  await ctx.turn.send(text, d.kind === "review_question" ? { draftId: d.id, buttons: "question" } : { draftId: d.id });
}

// Where approved replies go, in plain words (dummy and dry run post nothing).
async function whereTheyGo(ctx: FlowCtx) {
  const mode = await googleModeFor(ctx.restaurant.id);
  if (mode === "dummy") return "They're posted to your test Google page now, a few seconds apart.";
  if (mode === "simulated" || googleDryRunReason(ctx.restaurant, "replies", dryRunContext(process.env))) return "This is a dry run, so nothing reaches Google: each one is marked \"would have posted\".";
  return "They're going to Google now, a few seconds apart.";
}

async function nextInQueue(ctx: FlowCtx, decidedId: string | null): Promise<StepOutcome> {
  const { repliesFor } = await import("./replies");
  const { pending } = await repliesFor(ctx.restaurant.id, ctx.review.id);
  const queue = (ctx.state().queue ?? []).filter((id) => id !== decidedId && pending.some((d) => d.id === id));
  await ctx.setState({ queue });
  if (!queue.length) return "done";
  const total = ctx.state().queueTotal ?? queue.length;
  await present(ctx, pending.find((d) => d.id === queue[0])!, total - queue.length + 1, total);
  return "stay";
}

async function startOneByOne(ctx: FlowCtx, ids: string[]): Promise<StepOutcome> {
  await ctx.setState({ queue: ids, queueTotal: ids.length });
  return nextInQueue(ctx, null);
}

const replies: StepHandler = {
  available: async (ctx) => (await (await import("./replies")).repliesFor(ctx.restaurant.id, ctx.review.id)).positive.length > 0,
  show: async (ctx) => {
    const { positive, oneByOne } = await (await import("./replies")).repliesFor(ctx.restaurant.id, ctx.review.id);
    if (!positive.length) return "done";
    const ex = positive[0];
    const n = positive.length;
    const text = [
      `💬 *Your review replies*`,
      "",
      `I've drafted replies to ${n === 1 ? "1 of your 4 to 5 star reviews" : `${n} of your 4 to 5 star reviews`}, and ${n === 1 ? "it's" : "they've all"} passed my checks. Here's one:`,
      "",
      `${stars(ex.rating)} ${ex.reviewAuthor ?? "A customer"}: "${clip(ex.reviewText ?? "(rating only)", 160)}"`,
      `📝 "${clip(ex.content, 320)}"`,
      ...(oneByOne.length ? ["", `${oneByOne.length === 1 ? "1 more needs" : `${oneByOne.length} more need`} a closer look, so we'll go through ${oneByOne.length === 1 ? "it" : "those"} one by one next.`] : []),
    ].join("\n");
    await ctx.say(text, [ctx.button("replies", "all", n === 1 ? "Approve it" : `Approve all ${n}`), ctx.button("replies", "one", "One by one"), ctx.button("replies", "skip", "Skip")]);
    return "stay";
  },
  choose: async (ctx, choice) => {
    const { approveAllPositive, repliesFor } = await import("./replies");
    if (choice === "all") {
      const { approved } = await approveAllPositive(ctx.restaurant, ctx.review.id, new Date());
      await ctx.say(approved ? `✅ Approved ${approved === 1 ? "1 reply" : `${approved} replies`}. ${await whereTheyGo(ctx)} Changed your mind? Reply UNDO to take ${approved === 1 ? "it" : "them all"} back.` : "Those replies aren't waiting any more.");
      return "done";
    }
    if (choice === "one") return startOneByOne(ctx, (await repliesFor(ctx.restaurant.id, ctx.review.id)).positive.map((d) => d.id));
    await ctx.say("👍 They'll wait for you in tomorrow morning's brief.");
    return "done";
  },
  afterDecision: (ctx, draft) => nextInQueue(ctx, draft.id),
};

// 1 to 3 star replies (always one by one, never in Approve all), questions, and
// any reply a check flagged.
const negativeReplies: StepHandler = {
  available: async (ctx) => (await (await import("./replies")).repliesFor(ctx.restaurant.id, ctx.review.id)).oneByOne.length > 0,
  show: async (ctx) => {
    const { oneByOne } = await (await import("./replies")).repliesFor(ctx.restaurant.id, ctx.review.id);
    if (!oneByOne.length) return "done";
    if (!(ctx.state().queue ?? []).length) {
      await ctx.say(`🔎 *${oneByOne.length === 1 ? "1 reply needs" : `${oneByOne.length} replies need`} your eye*\n\nLower ratings, or something my checks flagged. Let's take ${oneByOne.length === 1 ? "it" : "them"} one at a time.`);
    }
    return startOneByOne(ctx, oneByOne.map((d) => d.id));
  },
  choose: async () => "done",
  afterDecision: (ctx, draft) => nextInQueue(ctx, draft.id),
};

// ---------- The Google profile ----------

async function partResult<P extends keyof PartResults>(ctx: FlowCtx, part: P) {
  const row = check(await getSupabase().from("business_review_parts").select("result, status").eq("review_id", ctx.review.id).eq("part", part).maybeSingle<{ result: PartResults[P] | null; status: string }>());
  return row?.status === "done" ? row.result : null;
}

async function fixDraft(ctx: FlowCtx) {
  const r = await partResult(ctx, "profile");
  if (!r?.draftId) return null;
  return check(await getSupabase().from("drafts").select("*").eq("id", r.draftId).eq("restaurant_id", ctx.restaurant.id).maybeSingle<Draft>());
}

async function stepsAndAsks(ctx: FlowCtx) {
  const r = await partResult(ctx, "profile");
  const steps = r?.steps ?? [];
  if (steps.length) {
    const head = `✍️ *${steps.length === 1 ? "One thing" : `${steps.length} things`} Google only lets you change yourself*`;
    await ctx.say([head, ...steps.map((s) => `• *${s.label}*: ${s.text}`)].join("\n\n"));
  }
  if (r?.asks.length) await ctx.say(`❓ To finish the rest, I just need ${r.asks.length === 1 ? r.asks[0] : `${r.asks.slice(0, -1).join(", ")} and ${r.asks.at(-1)}`}. Reply here any time.`);
}

const profile: StepHandler = {
  available: async (ctx) => {
    if (!ctx.review.google_connected) return false;
    const r = await partResult(ctx, "profile");
    const d = await fixDraft(ctx);
    return Boolean((d && d.status === "pending") || r?.steps?.length || r?.asks.length);
  },
  show: async (ctx) => {
    const r = await partResult(ctx, "profile");
    if (!r) return "done";
    const d = await fixDraft(ctx);
    if (d?.status === "pending") {
      await ctx.say(`📋 *Your Google profile: ${r.score}/100*

${clip(d.content, 820)}`, [ctx.button("profile", "approve", "Approve fixes"), ctx.button("profile", "skip", "Skip")]);
      return "stay";
    }
    await ctx.say(`📋 *Your Google profile: ${r.score}/100*`);
    await stepsAndAsks(ctx);
    return "done";
  },
  choose: async (ctx, choice) => {
    const d = await fixDraft(ctx);
    if (choice === "approve" && d?.status === "pending") {
      const before = (await partResult(ctx, "profile"))?.score ?? null;
      const approved = await approveDraft(d);
      const result = await attemptSend(approved.id, ctx.restaurant, new Date(), "approve");
      if (result.outcome === "sent") {
        await ctx.say(result.note ?? "📋 Done.");
        const { rescore } = await import("./rescore");
        const after = await rescore(ctx.restaurant, result.draft, result.note ?? "");
        if (before !== null && after) await ctx.say(`📋 Before: ${before}/100. ${after.dryRun ? "With these, it would be" : "Now"}: ${after.score}/100.`);
      } else {
        await ctx.say(`Not done yet: ${result.detail}`);
      }
    } else if (choice === "skip") {
      await ctx.say("👍 The fixes will wait for you in tomorrow morning's brief.");
    }
    await stepsAndAsks(ctx);
    return "done";
  },
};

// ---------- What customers say ----------

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

const themes: StepHandler = {
  available: async (ctx) => {
    const r = await partResult(ctx, "themes");
    return Boolean(r && !r.skipped && (r.praises.length || r.complaint));
  },
  show: async (ctx) => {
    const r = await partResult(ctx, "themes");
    if (!r || r.skipped) return "done";
    const lines = ["💬 *What customers say*", ""];
    if (r.summary) lines.push(r.summary, "");
    if (r.praises.length) lines.push(`👍 They love ${joinList(r.praises.map(lower))}.`);
    for (const c of r.complaints ?? (r.complaint ? [{ ...r.complaint, example: null }] : [])) {
      lines.push(`👎 ${c.label} (${c.count} ${c.count === 1 ? "review" : "reviews"})${c.example ? `: "${c.example}"` : ""}`);
    }
    if (r.action) lines.push("", `💡 ${r.action}`);
    await ctx.say(clip(lines.join("\n"), 1000), [ctx.button("themes", "ok", "Got it")]);
    return "stay";
  },
  choose: async () => "done",
};

// ---------- The QR poster ----------

const poster: StepHandler = {
  available: async (ctx) => Boolean(ctx.restaurant.slug && (await partResult(ctx, "poster"))?.ready),
  show: async (ctx) => {
    const { posterUrl } = await import("./parts/poster");
    const slug = ctx.restaurant.slug!;
    const reward = ctx.restaurant.signup_reward || "a welcome treat";
    await ctx.say(
      `🪧 *Your QR poster*

Print it and put it by the till or in the window. Customers scan it to join your list and get ${reward}, and you can send them offers.

A4 (above): ${posterUrl(slug, "A4")}
A5 for the tables: ${posterUrl(slug, "A5")}`,
      [],
      posterUrl(slug, "A4"),
    );
    return "done";
  },
  choose: async () => "done",
};

export const FLOW_HANDLERS: Partial<Record<FlowStep, StepHandler>> = {
  replies,
  negative_replies: negativeReplies,
  profile,
  themes,
  audiences,
  campaigns,
  poster,
};
