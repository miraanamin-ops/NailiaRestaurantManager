import "server-only";
import { dryRunContext, googleDryRunReason } from "@/lib/gate-rules";
import { draftMessage } from "@/lib/format";
import { googleModeFor } from "@/lib/google";
import { clip } from "@/lib/text";
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

export const FLOW_HANDLERS: Partial<Record<FlowStep, StepHandler>> = {
  replies,
  negative_replies: negativeReplies,
};
