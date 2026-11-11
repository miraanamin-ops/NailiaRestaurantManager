import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { doneTally, waitingDrafts } from "@/lib/brief";
import { londonYmd } from "@/lib/clock";
import { check, getDraft, getLearningContext, saveSkipReason, startEdit, type Draft } from "@/lib/drafts";
import { draftPreviewUrl } from "@/lib/email/previews";
import { google } from "@/lib/google";
import type { OwnerChannel } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { undoLast } from "@/lib/undo";
import { APP_CHANNEL_TO } from "./chat-rules";
import { sortCards, takingsLine, toCard, typeTiles, waitingSummary, type CardReview, type InboxCard } from "./cards";

// The app's Today and Inbox (step 50, phase 1): the same drafts the morning brief
// lists, as cards; and Approve / Edit / Skip / Undo through exactly the code the
// WhatsApp bot uses (lib/bot/decisions.ts, editWithInstructions), so every safety
// rule and check applies unchanged. The bot's replies are collected and returned
// for the app to show, never sent to WhatsApp.

// The channel is a placeholder number no message can reach (APP_CHANNEL_TO), so if a
// decision path tries to message the owner (a rota PDF), nothing is sent anywhere.

export async function inboxCards(restaurantId: string): Promise<InboxCard[]> {
  const drafts = await waitingDrafts(restaurantId);
  if (!drafts.length) return [];
  const reviewIds = new Set(drafts.map((d) => d.review_id).filter(Boolean));
  const reviews = reviewIds.size ? (await google().listReviews(restaurantId)).filter((r) => reviewIds.has(r.id)) : [];
  const byReview = new Map<string, CardReview>(reviews.map((r) => [r.id, { author: r.author_name, rating: r.rating, text: r.text ?? null }]));
  const campaignIds = drafts.filter((d) => d.kind === "email_campaign").map((d) => d.id);
  const campaigns = campaignIds.length
    ? (check(
        await getSupabase().from("campaigns").select("draft_id, name, segment").eq("restaurant_id", restaurantId).in("draft_id", campaignIds).returns<{ draft_id: string; name: string; segment: string | null }[]>(),
      ) ?? [])
    : [];
  const campaignName = new Map(campaigns.map((c) => [c.draft_id, c.name]));
  const birthdays = new Set(campaigns.filter((c) => c.segment === "birthdays_7d").map((c) => c.draft_id));
  return sortCards(
    drafts.map((d) =>
      toCard(d, {
        review: d.review_id ? (byReview.get(d.review_id) ?? null) : null,
        campaignName: campaignName.get(d.id) ?? null,
        previewImageUrl: draftPreviewUrl(d),
        body: d.content,
        birthday: birthdays.has(d.id),
      }),
    ),
  );
}

export async function todayFor(restaurant: Restaurant, now = new Date()) {
  const day = (offset: number) => londonYmd(new Date(now.getTime() - offset * 86_400_000));
  const { rotaToday } = await import("./rota");
  const [cards, sales, done, rota] = await Promise.all([
    inboxCards(restaurant.id),
    getSupabase()
      .from("sales_days")
      .select("day, net_sales")
      .eq("restaurant_id", restaurant.id)
      .in("day", [day(1), day(8)])
      .returns<{ day: string; net_sales: number }[]>()
      .then((res) => check(res) ?? []),
    doneTally(restaurant.id, new Date(now.getTime() - 86_400_000), now),
    // Who's on today (this week's rota), for Today's card; never in the way of the rest.
    rotaToday(restaurant).catch((err) => (console.error("Today's rota failed", err), null)),
  ]);
  const amount = (d: string) => {
    const row = sales.find((s) => s.day === d);
    return row ? Number(row.net_sales) : null;
  };
  return {
    restaurant: { id: restaurant.id, name: restaurant.name, paused: Boolean(restaurant.paused) },
    takings: takingsLine(amount(day(1)), amount(day(8))),
    waiting: { ...waitingSummary(cards), next: cards.slice(0, 3).map((c) => ({ id: c.id, title: c.title, urgent: c.urgent })), tiles: typeTiles(cards) },
    done,
    rota,
  };
}

// The bot's turn, with its replies collected instead of sent.
async function appTurn(restaurantId: string) {
  const ctx = await loadRestaurantContext(restaurantId);
  const replies: string[] = [];
  const channel: OwnerChannel = { restaurantId, from: ctx.restaurant.whatsapp_from ?? "whatsapp:+14155238886", to: APP_CHANNEL_TO };
  const send = async (text: string) => {
    if (text) replies.push(text);
  };
  return { turn: { ctx, channel, owner: ctx.restaurant.owner_whatsapp ?? APP_CHANNEL_TO, send }, replies };
}

// WhatsApp formatting out of the bot's replies, for the app to show as plain text.
export const plainReply = (text: string) => text.replace(/\*([^*\n]+)\*/g, "$1").replace(/_([^_\n]+)_/g, "$1").trim();

export type Decision = { action: "approve" | "skip" } | { action: "edit"; instructions: string } | { action: "reason"; reason: string };

// One decision on one draft from the app. The draft must belong to the restaurant.
export async function decideFromApp(restaurantId: string, draftId: string, decision: Decision) {
  const draft = await getDraft(draftId).catch(() => null);
  if (!draft || draft.restaurant_id !== restaurantId) return { ok: false as const, error: "not_found" };
  if (decision.action === "reason") {
    await saveSkipReason(draft, decision.reason.slice(0, 500));
    return { ok: true as const, replies: ["Thanks, noted."], card: null };
  }
  const { turn, replies } = await appTurn(restaurantId);
  if (decision.action === "edit") {
    if (draft.status !== "pending") return { ok: false as const, error: "not_waiting" };
    const { editWithInstructions } = await import("@/lib/bot/conversation");
    await startEdit(draft);
    await editWithInstructions(turn, (await getDraft(draft.id)) as Draft, decision.instructions.slice(0, 1000), await getLearningContext(restaurantId));
  } else {
    const { decideTargeted } = await import("@/lib/bot/decisions");
    await decideTargeted(turn, { action: decision.action, draftId: draft.id });
  }
  // The card as it stands now (an edit comes back rewritten for a decision).
  const after = (await inboxCards(restaurantId)).find((c) => c.id === draft.id) ?? null;
  return { ok: true as const, replies: replies.map(plainReply), card: after };
}

export async function undoFromApp(restaurant: Restaurant) {
  return plainReply(await undoLast(restaurant, new Date()));
}

// "Approve N simple items": every card that is simple NOW (worked out again here, never
// taken from the phone), each approved through the bot's own decision code like one tap,
// so every send-time check still runs. Returns how many went, and anything held back.
export async function approveSimple(restaurantId: string) {
  const simple = (await inboxCards(restaurantId)).filter((c) => c.bulk);
  let approved = 0;
  const notes: string[] = [];
  for (const c of simple) {
    const out = await decideFromApp(restaurantId, c.id, { action: "approve" });
    if (out.ok) approved++;
    // A reply that says it was held or blocked (sending hours, paused): passed on.
    const held = out.ok ? out.replies.find((r) => /held|blocked|paused|not sent|won't/i.test(r)) : null;
    if (held) notes.push(held);
  }
  return { approved, total: simple.length, notes: [...new Set(notes)].slice(0, 3) };
}
