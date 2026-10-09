import "server-only";
import { randomUUID } from "node:crypto";
import { approveDraft, check, KIND_LABELS, updateDraft, type Draft } from "@/lib/drafts";
import { approveAllMessage, draftMessage } from "@/lib/format";
import { google } from "@/lib/google";
import { stars } from "@/lib/google-jobs";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { attemptSend, type SendResult } from "@/lib/send";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { plural, shorten } from "@/lib/text";

// The morning brief: everything waiting for approval, numbered, each with its
// own buttons, plus a one-line "done for you" tally. Plain code, no AI.

const HOUR = 60 * 60 * 1000;
// More than this and the rest wait for tomorrow (WhatsApp gets unreadable).
export const BRIEF_MAX_ITEMS = 10;
// WhatsApp only lets a business message someone freely within 24 hours of their last message.
const FREE_MESSAGING_HOURS = 24;

// Every draft still waiting for an Approve / Edit / Skip, oldest first.
async function waitingDrafts(restaurantId: string) {
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("status", "pending")
    .or("waiting_for.is.null,waiting_for.in.(decision,edit_instructions)")
    .order("created_at")
    .returns<Draft[]>();
  return check(res) ?? [];
}

type ReviewInfo = { id: string; author_name: string; rating: number; text: string | null };

async function reviewsFor(restaurantId: string, drafts: Draft[]) {
  const ids = new Set(drafts.map((d) => d.review_id).filter(Boolean));
  if (!ids.size) return new Map<string, ReviewInfo>();
  const reviews = (await google().listReviews(restaurantId)).filter((r) => ids.has(r.id));
  return new Map(reviews.map((r) => [r.id, r]));
}

async function campaignNames(drafts: Draft[]) {
  const ids = drafts.filter((d) => d.kind === "email_campaign").map((d) => d.id);
  if (!ids.length) return new Map<string, string>();
  const rows =
    check(
      await getSupabase().from("campaigns").select("draft_id, name").in("draft_id", ids).returns<{ draft_id: string; name: string }[]>(),
    ) ?? [];
  return new Map(rows.map((r) => [r.draft_id, r.name]));
}

// One line per item for the numbered summary.
function itemLine(d: Draft, review: ReviewInfo | undefined, campaignName: string | undefined) {
  const flag = d.check_notes?.flags?.length ? " ⚠️" : "";
  if (d.kind === "review_reply" && review) {
    const name = review.author_name.replace(/\.$/, "");
    return `📝 Reply to ${name}'s ${review.rating}⭐ review${review.rating <= 3 ? " 🚨" : ""}${flag}`;
  }
  if (d.kind === "google_post") return `📍 Google post: "${shorten(d.content, 40)}"${flag}`;
  if (d.kind === "email_campaign") return `📧 Email: ${campaignName ?? "offer"} · ${d.audience ?? ""}${flag}`;
  return `📝 ${KIND_LABELS[d.kind]}${d.audience ? ` for ${d.audience}` : ""}${flag}`;
}

// The full item, sent as its own message with Approve / Edit / Skip.
function itemMessage(d: Draft, n: number, total: number, review: ReviewInfo | undefined, restaurant: Restaurant) {
  const quote = review ? `${review.author_name} ${stars(review.rating)}\n_"${shorten(review.text ?? "(rating only)", 220)}"_\n\n` : "";
  return `*${n} of ${total}*\n${quote}${draftMessage(d, restaurant)}`;
}

// ---------- "Done for you" tally ----------

// What happened in the window, as short phrases. Empty = no activity.
export async function doneTally(restaurantId: string, since: Date, until: Date) {
  const supabase = getSupabase();
  const [from, to] = [since.toISOString(), until.toISOString()];
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  };
  const head = { count: "exact" as const, head: true };
  const [replies, posts, signups, rewards, offers, emails] = await Promise.all([
    count(supabase.from("reviews").select("id", head).eq("restaurant_id", restaurantId).gte("reply_posted_at", from).lt("reply_posted_at", to)),
    count(supabase.from("google_posts").select("id", head).eq("restaurant_id", restaurantId).gte("published_at", from).lt("published_at", to)),
    count(supabase.from("customer_events").select("id", head).eq("restaurant_id", restaurantId).eq("type", "signup").gte("created_at", from).lt("created_at", to)),
    count(supabase.from("rewards").select("id", head).eq("restaurant_id", restaurantId).gte("redeemed_at", from).lt("redeemed_at", to)),
    count(
      supabase.from("campaign_sends").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "customer").gte("redeemed_at", from).lt("redeemed_at", to),
    ),
    count(
      supabase.from("campaign_sends").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "customer").gte("created_at", from).lt("created_at", to),
    ),
  ]);
  const parts: string[] = [];
  if (replies) parts.push(`replied to ${plural(replies, "review")}`);
  if (posts) parts.push(`published ${plural(posts, "Google post")}`);
  if (emails) parts.push(`emailed ${plural(emails, "customer")}`);
  if (signups) parts.push(plural(signups, "new sign-up"));
  if (rewards) parts.push(`${plural(rewards, "welcome reward")} redeemed`);
  if (offers) parts.push(`${plural(offers, "offer")} redeemed`);
  return parts;
}

function tallyLine(parts: string[]) {
  if (!parts.length) return null;
  const text = parts.join(", ");
  return `✅ *Done for you since yesterday:* ${text[0].toUpperCase()}${text.slice(1)}.`;
}

// ---------- Sending the brief ----------

export type BriefOutcome = { sent: boolean; items: number; tally: string[] };

// Builds and sends the brief. Nothing is sent if there's nothing to approve and no activity.
// extra: results to report (counts as activity). note: a footnote (doesn't).
export async function sendBrief(
  restaurant: Restaurant,
  channel: OwnerChannel,
  now: Date,
  { extra = [], note }: { extra?: string[]; note?: string } = {},
): Promise<BriefOutcome> {
  const all = await waitingDrafts(restaurant.id);
  const items = all.slice(0, BRIEF_MAX_ITEMS);
  const tally = await doneTally(restaurant.id, new Date(now.getTime() - 24 * HOUR), now);
  if (!items.length && !tally.length && !extra.length) return { sent: false, items: 0, tally };

  const [reviews, names] = await Promise.all([reviewsFor(restaurant.id, items), campaignNames(items)]);
  const briefAt = new Date().toISOString();
  const send = (text: string, withButtons: Parameters<typeof messageOwner>[2] = false) => messageOwner(channel, text, withButtons);
  const brief = composeBrief({ items, totalWaiting: all.length, reviews, names, tally, extra, note, restaurant });

  // Number the items first, so a fast tap on a button finds its brief.
  for (const [i, d] of items.entries()) await updateDraft(d.id, { brief_number: i + 1, briefed_at: briefAt });
  check(
    await getSupabase().from("restaurants").update({ last_brief_at: briefAt, brief_waiting_since: null }).eq("id", restaurant.id),
  );

  await send(brief.summary);
  for (const [i, d] of items.entries()) await send(brief.itemMessages[i], { draftId: d.id, briefNumber: i + 1 });
  return { sent: true, items: items.length, tally };
}

// The brief's wording: one numbered summary, then each item's own message.
// No database or sending here, so it's unit-tested (tests/brief.test.ts).
export function composeBrief(input: {
  items: Draft[];
  totalWaiting: number;
  reviews: Map<string, ReviewInfo>;
  names: Map<string, string>;
  tally: string[];
  extra?: string[];
  note?: string;
  restaurant: Pick<Restaurant, "discount_cap_percent">;
}) {
  const { items, reviews, names, tally, extra = [], note } = input;
  const lines: string[] = [];
  if (items.length) {
    lines.push(`☀️ *Good morning! ${plural(items.length, "thing")} need${items.length === 1 ? "s" : ""} your OK*`);
    items.forEach((d, i) => lines.push(`${i + 1}. ${itemLine(d, d.review_id ? reviews.get(d.review_id) : undefined, names.get(d.id))}`));
    if (input.totalWaiting > items.length) lines.push(`_…and ${input.totalWaiting - items.length} more, in tomorrow's brief (or text NEXT)._`);
  } else {
    lines.push("☀️ *Good morning!* Nothing needs your OK today.");
  }
  const tl = tallyLine(tally);
  if (tl) lines.push("", tl);
  if (extra.length) lines.push("", ...extra);
  if (items.length) {
    lines.push(
      "",
      items.length === 1
        ? "It's below with its own buttons."
        : `Each one is below with its own buttons. Or reply *APPROVE ALL* to approve all ${items.length}.`,
    );
  }
  if (note) lines.push("", note);
  const itemMessages = items.map((d, i) =>
    itemMessage(d, i + 1, items.length, d.review_id ? reviews.get(d.review_id) : undefined, input.restaurant as Restaurant),
  );
  return { summary: lines.join("\n"), itemMessages };
}

// WhatsApp rule: outside 24 hours since the owner's last message, a business can
// only send pre-approved templates. Until we have one, the brief waits for them.
export async function canMessageFreely(restaurant: Restaurant, now: Date) {
  if (!restaurant.owner_whatsapp) return false;
  const res = await getSupabase()
    .from("messages")
    .select("created_at")
    .eq("direction", "inbound")
    .eq("from_number", restaurant.owner_whatsapp)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  const last = check(res);
  return Boolean(last && now.getTime() - new Date(last.created_at).getTime() < FREE_MESSAGING_HOURS * HOUR);
}

export async function markBriefWaiting(restaurant: Restaurant, now: Date) {
  check(await getSupabase().from("restaurants").update({ brief_waiting_since: now.toISOString() }).eq("id", restaurant.id));
}

// ---------- Acting on brief items ----------

// The draft that "APPROVE 2" means: item 2 of the latest brief.
export async function draftByBriefNumber(restaurant: Restaurant, n: number) {
  if (!restaurant.last_brief_at) return null;
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("briefed_at", restaurant.last_brief_at)
    .eq("brief_number", n)
    .maybeSingle<Draft>();
  return check(res);
}

// Items from the latest brief still waiting for a decision.
export async function remainingInBrief(restaurant: Pick<Restaurant, "id" | "last_brief_at">) {
  if (!restaurant.last_brief_at) return [];
  const res = await getSupabase()
    .from("drafts")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("briefed_at", restaurant.last_brief_at)
    .eq("status", "pending")
    .order("brief_number")
    .returns<Draft[]>();
  return check(res) ?? [];
}

export function remainingNote(left: Draft[]) {
  if (!left.length) return "";
  const nums = left.map((d) => d.brief_number).join(", ");
  return `\n\n📋 Still waiting from your brief: ${left.length === 1 ? `item ${nums}` : `items ${nums}`}.${left.length > 1 ? " Reply APPROVE ALL to approve them all." : ""}`;
}

// APPROVE ALL: approves every item still waiting from the latest brief. Each one
// still goes through every safety rule before anything is sent.
export async function approveAll(restaurant: Restaurant, now: Date) {
  const left = await remainingInBrief(restaurant);
  if (!left.length) {
    return restaurant.last_brief_at
      ? "Everything from your brief has already been dealt with. 🎉"
      : "There's no brief to approve yet. Text RUN BRIEF to get one now.";
  }
  const results: { n: number; result: SendResult }[] = [];
  const batchId = randomUUID(); // one UNDO reverses the whole APPROVE ALL
  for (const d of left) {
    const approved = await approveDraft(d, batchId);
    results.push({ n: d.brief_number ?? 0, result: await attemptSend(approved.id, restaurant, now, "approve") });
  }
  return approveAllMessage(results);
}
