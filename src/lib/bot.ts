import "server-only";
import { chat, loadRestaurantContext, rewriteDraft, writeReviewReply, type RestaurantContext, type StoredMessage } from "@/lib/assistant";
import { checkDraft } from "@/lib/checker";
import { formatLondon, formatWindow, isInSendWindow, londonTimeOn } from "@/lib/clock";
import {
  applyEdit,
  approveDraft,
  check,
  createDraft,
  getActiveDraft,
  getLastApprovedDraft,
  getLearningContext,
  saveSkipReason,
  skipDraft,
  startEdit,
  type Draft,
  type DraftKind,
} from "@/lib/drafts";
import { randomDummyReview } from "@/lib/dummy-reviews";
import { draftMessage, sendResultMessage } from "@/lib/format";
import { releaseQueue, sendReminders, weeklySummary } from "@/lib/followups";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { attemptSend } from "@/lib/send";
import { getSupabase, restaurantNow, type Restaurant, type Review } from "@/lib/supabase";
import { BUTTON_IDS } from "@/lib/whatsapp";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;
// A second tap on Approve within this long counts as a duplicate attempt.
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

type Action = "approve" | "edit" | "skip";

// A tapped button, or a typed 1/2/3 or approve/edit/skip.
function parseAction(buttonPayload: string | undefined, body: string): Action | null {
  if (buttonPayload === BUTTON_IDS.approve) return "approve";
  if (buttonPayload === BUTTON_IDS.edit) return "edit";
  if (buttonPayload === BUTTON_IDS.skip) return "skip";
  const t = body.trim().toLowerCase().replace(/[.!]$/, "");
  if (t === "1" || t === "approve") return "approve";
  if (t === "2" || t === "edit") return "edit";
  if (t === "3" || t === "skip") return "skip";
  return null;
}

type Command =
  | { name: "help" | "status" | "pause" | "resume" | "time_off" | "test_send" | "test_checker" | "weekly" | "new_review" }
  | { name: "time"; hhmm: string; plusDays: number }
  | { name: "cap"; percent: number };

// Exact typed commands. Anything else is treated as normal chat.
function parseCommand(body: string): Command | null {
  const t = body.trim().toUpperCase().replace(/\s+/g, " ");
  if (t === "HELP" || t === "COMMANDS") return { name: "help" };
  if (t === "STATUS") return { name: "status" };
  if (t === "PAUSE") return { name: "pause" };
  if (t === "RESUME") return { name: "resume" };
  if (t === "TEST SEND") return { name: "test_send" };
  if (t === "TEST CHECKER") return { name: "test_checker" };
  if (t === "WEEKLY") return { name: "weekly" };
  if (t === "NEW REVIEW") return { name: "new_review" };
  if (/^TIME (OFF|NOW|RESET|REAL)$/.test(t)) return { name: "time_off" };
  const time = t.match(/^TIME (TOMORROW )?(\d{1,2})[:.](\d{2})$/);
  if (time && Number(time[2]) < 24 && Number(time[3]) < 60) {
    return { name: "time", hhmm: `${time[2]}:${time[3]}`, plusDays: time[1] ? 1 : 0 };
  }
  const cap = t.match(/^CAP (\d{1,3})%?$/);
  if (cap && Number(cap[1]) <= 100) return { name: "cap", percent: Number(cap[1]) };
  return null;
}

const HELP_TEXT = `🛠️ *Commands*
- *NEW REVIEW*: fake a new Google review and draft a reply
- *PAUSE* / *RESUME*: stop / restart all sending
- *CAP 25*: set the max discount to 25%
- *TIME 22:00*: pretend it's 10pm today (*TIME TOMORROW 09:05* for tomorrow)
- *TIME OFF*: back to the real time
- *TEST SEND*: try to send the waiting draft *without* approving it
- *TEST CHECKER*: run a draft full of mistakes through the checker
- *WEEKLY*: show the weekly round-up now
- *STATUS*: show the current settings`;

async function updateRestaurant(id: string, fields: Partial<Restaurant>) {
  const res = await getSupabase().from("restaurants").update(fields).eq("id", id).select("*").single<Restaurant>();
  const row = check(res);
  if (!row) throw new Error("Restaurant not found");
  return row;
}

async function statusText(restaurant: Restaurant) {
  const now = restaurantNow(restaurant);
  const { count } = await getSupabase()
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("status", "queued");
  const inWindow = isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end);
  return [
    "⚙️ *Status*",
    `- Sending: ${restaurant.paused ? "⏸️ *PAUSED*" : "▶️ on"}`,
    `- Clock: ${formatLondon(now)}${restaurant.fake_now ? " _(test time; TIME OFF to reset)_" : ""}`,
    `- Sending hours: ${formatWindow(restaurant.send_window_start, restaurant.send_window_end)} (${inWindow ? "open now" : "closed now"})`,
    `- Discount cap: ${restaurant.discount_cap_percent}%`,
    `- Queued drafts: ${count ?? 0}`,
  ].join("\n");
}

export async function handleMessage(input: { owner: string; sandbox: string; body: string; buttonPayload: string | undefined }) {
  const { owner, sandbox, body } = input;
  const supabase = getSupabase();
  let ctx = await loadRestaurantContext();
  const channel: OwnerChannel = { restaurantId: ctx.restaurantId, from: sandbox, to: owner };
  const send = (text: string, withButtons = false) => messageOwner(channel, text, withButtons);

  try {
    // Remember where reminders and reports should go.
    if (ctx.restaurant.owner_whatsapp !== owner || ctx.restaurant.whatsapp_from !== sandbox) {
      await updateRestaurant(ctx.restaurantId, { owner_whatsapp: owner, whatsapp_from: sandbox });
      ctx = await loadRestaurantContext();
    }

    const command = parseCommand(body);
    if (command) {
      await runCommand(command, ctx, send);
    } else {
      await handleConversation(ctx, body, input.buttonPayload, send);
    }

    // Any queued drafts that are now due go out whenever the owner is active.
    const fresh = await loadRestaurantContext();
    if (command?.name !== "time" && command?.name !== "resume") await releaseQueue(fresh.restaurant, fresh.now);
  } catch (err) {
    console.error("Failed to handle message", err);
    await send("Sorry, something went wrong on my side. Please try again in a minute. 🙏");
  }

  async function runCommand(command: Command, ctx: RestaurantContext, send: (text: string, withButtons?: boolean) => Promise<void>) {
    const r = ctx.restaurant;
    switch (command.name) {
      case "help":
        return send(HELP_TEXT);
      case "status":
        return send(await statusText(r));
      case "pause":
        if (r.paused) return send("⏸️ Sending is already *paused*. Text RESUME to restart it.");
        await updateRestaurant(r.id, { paused: true, paused_at: new Date().toISOString() });
        return send("⏸️ *Paused.* Nothing will be sent until you text *RESUME*. Approved drafts will be held.");
      case "resume": {
        if (!r.paused) return send("▶️ Sending is already on. (Text PAUSE to stop it.)");
        const resumed = await updateRestaurant(r.id, { paused: false, paused_at: null });
        await send("▶️ *Resumed.* Sending is back on.");
        const results = await releaseQueue(resumed, restaurantNow(resumed));
        if (!results.length) await send("There was nothing held, so nothing went out.");
        return;
      }
      case "cap": {
        await updateRestaurant(r.id, { discount_cap_percent: command.percent });
        return send(`💷 Discount cap set to *${command.percent}%*. Any offer above that will be blocked.`);
      }
      case "time":
      case "time_off": {
        const fake = command.name === "time" ? londonTimeOn(new Date(), command.hhmm, command.plusDays) : null;
        const updated = await updateRestaurant(r.id, { fake_now: fake ? fake.toISOString() : null });
        const now = restaurantNow(updated);
        const open = isInSendWindow(now, updated.send_window_start, updated.send_window_end);
        await send(
          `🕒 ${fake ? `Test clock set to *${formatLondon(now)}*.` : `Back to the real time: *${formatLondon(now)}*.`}\nSending hours are ${formatWindow(updated.send_window_start, updated.send_window_end)}, so sending is *${open ? "allowed" : "held"}* right now.${fake ? "\nText TIME OFF to go back to the real time." : ""}`,
        );
        // Run the jobs that normally run each morning, at the (fake) time.
        await releaseQueue(updated, now);
        await sendReminders(updated, now);
        return;
      }
      case "test_send": {
        const active = await getActiveDraft(r.id);
        if (!active) return send("There's no draft waiting to test with. Text NEW REVIEW first.");
        const result = await attemptSend(active.id, r, ctx.now, "test");
        return send(`🧪 Tried to send "${active.audience}" without approving it.\n${sendResultMessage(result)}`);
      }
      case "test_checker":
        // A deliberately wrong draft (wrong price, wrong hours, an unagreed freebie)
        // so the owner can see the checker fix and flag things.
        return checkCreateAndSend(
          ctx,
          {
            kind: "promotion",
            content:
              "Lamb Chops (4 pcs) are just £9.95 this week, and we're open till 2am every Friday! Every table gets a free kunafa too 🎉",
            audience: "All opted-in customers",
            request: "TEST CHECKER command",
          },
          send,
          "🧪 *Checker test.* I wrote this draft with deliberate mistakes. Here's what the checker made of it:\n\n",
        );
      case "weekly":
        return send(await weeklySummary(r, ctx.now));
      case "new_review":
        return newReview(ctx, send);
    }
  }

  async function handleConversation(
    ctx: RestaurantContext,
    body: string,
    buttonPayload: string | undefined,
    send: (text: string, withButtons?: boolean) => Promise<void>,
  ) {
    const r = ctx.restaurant;
    const [active, learning] = await Promise.all([getActiveDraft(r.id), getLearningContext(r.id)]);
    const action = parseAction(buttonPayload, body);
    // The draft that Approve / Edit / Skip would apply to, if any.
    const decisionDraft =
      active && (active.waiting_for === "decision" || active.waiting_for === "edit_instructions") ? active : null;

    if (action === "approve") {
      if (decisionDraft) {
        const approved = await approveDraft(decisionDraft);
        return send(sendResultMessage(await attemptSend(approved.id, r, ctx.now, "approve")));
      }
      // A second tap on an already-approved draft: the rules decide (and log) it.
      const last = await getLastApprovedDraft(r.id);
      if (last && Date.now() - new Date(last.approved_at!).getTime() < DUPLICATE_WINDOW_MS) {
        return send(sendResultMessage(await attemptSend(last.id, r, ctx.now, "approve")));
      }
      if (buttonPayload) return send("That draft isn't waiting for an answer any more. Ask me for a new one any time!");
    }
    if (decisionDraft && action === "edit") {
      await startEdit(decisionDraft);
      return send("✏️ What would you like me to change?");
    }
    if (decisionDraft && action === "skip") {
      await skipDraft(decisionDraft);
      return send("👍 Skipped. Quick question so I can learn: why didn't this one work? A few words is fine.");
    }
    if (buttonPayload && action) {
      return send("That draft isn't waiting for an answer any more. Ask me for a new one any time!");
    }

    // The owner is telling us what to change.
    if (active?.waiting_for === "edit_instructions") {
      const rewritten = await rewriteDraft(ctx, learning, active, body);
      return reviseAndSend(ctx, active, body, rewritten, send);
    }

    // The owner is telling us why they skipped.
    if (active?.waiting_for === "skip_reason") {
      await saveSkipReason(active, body);
      return send("Thanks, noted. I'll keep that in mind for next time. 🙏");
    }

    // Anything else: a normal chat, which may produce a new or revised draft.
    const { data: rows, error } = await supabase
      .from("messages")
      .select("direction, body, status")
      // Quoted because numbers look like "whatsapp:+44…" and ":" is special in this filter.
      .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<StoredMessage[]>();
    if (error) throw new Error(error.message);

    const result = await chat(ctx, learning, active, (rows ?? []).reverse());
    if (result.type === "draft") {
      return checkCreateAndSend(ctx, {
        kind: result.kind,
        content: result.content,
        audience: result.audience,
        request: body,
        reviewId: result.reviewId,
        customerId: result.customerId,
      }, send);
    }
    if (result.type === "revise" && active?.waiting_for === "decision") {
      return reviseAndSend(ctx, active, result.instruction, result.content, send);
    }
    if (result.type === "text") return send(result.text);
    return send("Sorry, I lost track of that draft. Could you ask again?");
  }
}

// Every new draft goes through the checker before the owner sees it.
async function checkCreateAndSend(
  ctx: RestaurantContext,
  input: { kind: DraftKind; content: string; audience: string; request: string; reviewId?: string | null; customerId?: string | null; context?: string },
  send: (text: string, withButtons?: boolean) => Promise<void>,
  intro = "",
) {
  const checked = await checkDraft(ctx, { kind: input.kind, audience: input.audience, content: input.content, context: input.context });
  const draft = await createDraft({
    restaurantId: ctx.restaurantId,
    kind: input.kind,
    content: checked.content,
    audience: input.audience,
    request: input.request,
    reviewId: input.reviewId,
    customerId: input.customerId,
    checkNotes: checked.notes,
  });
  await send(`${intro}${draftMessage(draft, ctx.restaurant)}`, true);
}

// Edits go through the checker too.
async function reviseAndSend(
  ctx: RestaurantContext,
  draft: Draft,
  instruction: string,
  content: string,
  send: (text: string, withButtons?: boolean) => Promise<void>,
) {
  const review = draft.review_id ? ctx.reviews.find((r) => r.id === draft.review_id) : undefined;
  const checked = await checkDraft(ctx, {
    kind: draft.kind,
    audience: draft.audience ?? "Customers",
    content,
    context: review ? `Replying to this ${review.rating}-star review: "${review.text}"` : undefined,
  });
  const updated = await applyEdit(draft, instruction, checked.content, checked.notes);
  await send(draftMessage(updated, ctx.restaurant), true);
}

// Test command: a random new review arrives and gets a drafted reply.
async function newReview(ctx: RestaurantContext, send: (text: string, withButtons?: boolean) => Promise<void>) {
  const pick = randomDummyReview();
  const { data: review, error } = await getSupabase()
    .from("reviews")
    .insert({ restaurant_id: ctx.restaurantId, author_name: pick.author, rating: pick.rating, text: pick.text, replied: false })
    .select("*")
    .single<Review>();
  if (error) throw new Error(error.message);
  const learning = await getLearningContext(ctx.restaurantId);
  const content = await writeReviewReply(ctx, learning, review);
  await checkCreateAndSend(
    ctx,
    {
      kind: "review_reply",
      content,
      audience: `Google review by ${review.author_name}`,
      request: "NEW REVIEW test command",
      reviewId: review.id,
      context: `Replying to this ${review.rating}-star review: "${review.text}"`,
    },
    send,
    `🔔 *New Google review* from ${review.author_name} ${"⭐".repeat(review.rating)}\n_"${review.text}"_\n\n`,
  );
}
