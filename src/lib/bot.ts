import "server-only";
import {
  captionPhoto,
  chat,
  loadRestaurantContext,
  rewriteCampaign,
  rewriteDraft,
  writeBirthdayCampaign,
  writeReviewReply,
  type RestaurantContext,
  type StoredMessage,
} from "@/lib/assistant";
import {
  birthdayWeek,
  createCampaignDraft,
  getCampaignForDraft,
  recentCampaignStats,
  recipientsFor,
  statsText,
  updateCampaignDraft,
  type CampaignFields,
} from "@/lib/campaigns";
import { checkCampaign, checkDraft } from "@/lib/checker";
import { formatLondon, formatWindow, isInSendWindow, londonParts, londonTimeOn } from "@/lib/clock";
import {
  applyEdit,
  approveDraft,
  check,
  createDraft,
  getActiveDraft,
  getLastApprovedDraft,
  getLearningContext,
  getQueue,
  KIND_LABELS,
  saveSkipReason,
  skipDraft,
  startEdit,
  type Draft,
  type DraftKind,
} from "@/lib/drafts";
import { approveAll, draftByBriefNumber, remainingInBrief, remainingNote, sendBrief } from "@/lib/brief";
import { randomDummyReview } from "@/lib/dummy-reviews";
import { draftMessage, sendResultMessage } from "@/lib/format";
import { releaseQueue } from "@/lib/followups";
import { google } from "@/lib/google";
import { createPostDraft, postMessage, presentNext, runPostJob, runReviewCheck, type Send } from "@/lib/google-jobs";
import { deliverWaitingBrief } from "@/lib/morning";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { downloadTwilioMedia, isSupportedImage, savePostPhoto } from "@/lib/photos";
import { createReport, reportPeriod } from "@/lib/report/build";
import { attemptSend } from "@/lib/send";
import { appUrl, getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";
import { BUTTON_IDS, parseButtonPayload } from "@/lib/whatsapp";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;
// A second tap on Approve within this long counts as a duplicate attempt.
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

type Action = "approve" | "edit" | "skip";

// A decision about one particular draft: a button on a brief item ("approve:<id>"),
// or a typed "APPROVE 2" / "EDIT 2" / "SKIP 2" (item 2 of the latest brief).
type TargetedAction = { action: Action; draftId?: string; briefNumber?: number };

function parseTargetedAction(buttonPayload: string | undefined, body: string): TargetedAction | null {
  const button = parseButtonPayload(buttonPayload);
  if (button) return { action: button.action, draftId: button.draftId };
  const typed = body.trim().toUpperCase().match(/^(APPROVE|EDIT|SKIP)\s*#?(\d{1,2})[.!]?$/);
  if (typed) return { action: typed[1].toLowerCase() as Action, briefNumber: Number(typed[2]) };
  return null;
}

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
  | { name: "help" | "status" | "pause" | "resume" | "time_off" | "test_send" | "test_checker" }
  | { name: "run_brief" | "run_report" | "approve_all" }
  | { name: "new_review"; rating: number | null }
  | { name: "run_reviews" | "run_posts" | "queue" | "next" }
  | { name: "time"; hhmm: string; plusDays: number }
  | { name: "cap"; percent: number }
  | { name: "set_reward"; reward: string }
  | { name: "reward" | "qr" | "birthday_campaign" | "report" }
  | { name: "my_email"; email: string };

// Exact typed commands. Anything else is treated as normal chat.
function parseCommand(body: string): Command | null {
  // "set sign-up reward to a free mango lassi" (keeps the owner's wording)
  const reward = body.trim().match(/^set\s+(?:the\s+)?sign[\s-]?up\s+reward\s*(?:to|:|=)\s*(.+?)[.!]?$/i);
  if (reward && reward[1].trim()) return { name: "set_reward", reward: reward[1].trim().slice(0, 100) };

  const t = body.trim().toUpperCase().replace(/\s+/g, " ");
  if (t === "REWARD" || t === "SIGNUP REWARD" || t === "SIGN-UP REWARD") return { name: "reward" };
  if (t === "QR" || t === "QR CODE" || t === "SIGNUP LINK" || t === "SIGN-UP LINK") return { name: "qr" };
  if (t === "HELP" || t === "COMMANDS") return { name: "help" };
  if (t === "STATUS") return { name: "status" };
  if (t === "PAUSE") return { name: "pause" };
  if (t === "RESUME") return { name: "resume" };
  if (t === "TEST SEND") return { name: "test_send" };
  if (t === "TEST CHECKER") return { name: "test_checker" };
  if (t === "RUN BRIEF" || t === "BRIEF") return { name: "run_brief" };
  // WEEKLY was the old Sunday round-up; the Monday report replaced it.
  if (t === "RUN REPORT" || t === "WEEKLY" || t === "WEEKLY REPORT") return { name: "run_report" };
  if (/^APPROVE ALL[.!]?$/.test(t)) return { name: "approve_all" };
  const newReview = t.match(/^NEW REVIEW(?: ([1-5])(?: ?STARS?)?)?$/);
  if (newReview) return { name: "new_review", rating: newReview[1] ? Number(newReview[1]) : null };
  if (t === "RUN REVIEWS") return { name: "run_reviews" };
  if (t === "RUN POSTS") return { name: "run_posts" };
  if (t === "QUEUE") return { name: "queue" };
  if (t === "NEXT") return { name: "next" };
  if (/^TIME (OFF|NOW|RESET|REAL)$/.test(t)) return { name: "time_off" };
  // "TIME 22:00", "TIME TOMORROW 09:05", "TIME THURSDAY 18:00" (the next Thursday, or today if it's Thursday)
  const time = t.match(/^TIME (?:(TOMORROW|MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]* )?(\d{1,2})[:.](\d{2})$/);
  if (time && Number(time[2]) < 24 && Number(time[3]) < 60) {
    let plusDays = 0;
    if (time[1] === "TOMORROW") plusDays = 1;
    else if (time[1]) {
      const target = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].indexOf(time[1]);
      const p = londonParts(new Date());
      const todayDow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
      plusDays = (target - todayDow + 7) % 7;
    }
    return { name: "time", hhmm: `${time[2]}:${time[3]}`, plusDays };
  }
  const email = body.trim().match(/^my\s+email(?:\s+is)?\s*:?\s+(\S+@\S+\.\S+)$/i);
  if (email) return { name: "my_email", email: email[1].toLowerCase() };
  if (t === "BIRTHDAY CAMPAIGN") return { name: "birthday_campaign" };
  if (t === "REPORT" || t === "CAMPAIGN REPORT") return { name: "report" };
  const cap = t.match(/^CAP (\d{1,3})%?$/);
  if (cap && Number(cap[1]) <= 100) return { name: "cap", percent: Number(cap[1]) };
  return null;
}

const HELP_TEXT = `🛠️ *Commands*
- *RUN BRIEF*: the 9am morning brief, now
- *APPROVE ALL*: approve everything in the latest brief (or *APPROVE 2*, *EDIT 2*, *SKIP 2* for one item)
- *RUN REPORT*: the Monday weekly report (last 7 days), now
- *NEW REVIEW*: a random new review appears on (dummy) Google; *NEW REVIEW 2* / *NEW REVIEW 5* pick the stars. 1-3 stars alert you at once; 4-5 stars wait for the brief
- *RUN REVIEWS*: run the hourly review check now
- *RUN POSTS*: draft a Google post now and hold it for the brief (normally Mondays and Thursdays)
- *QUEUE*: see drafts waiting for you · *NEXT*: bring up the next one
- Send a *photo* (with a note if you like) to turn it into a Google post
- *PAUSE* / *RESUME*: stop / restart all sending
- *CAP 25*: set the max discount to 25%
- *TIME 22:00*: pretend it's 10pm today (*TIME TOMORROW 09:05*, *TIME THURSDAY 18:00* also work)
- *TIME OFF*: back to the real time
- *TEST SEND*: try to send the waiting draft *without* approving it
- *TEST CHECKER*: run a draft full of mistakes through the checker
- *STATUS*: show the current settings
- *set sign-up reward to a free mango lassi*: change the reward for new customers
- *REWARD*: show the current sign-up reward
- *QR*: get the sign-up page link and printable QR code
- *MY EMAIL you@example.com*: where your copy of each campaign email goes
- *BIRTHDAY CAMPAIGN*: draft this week's birthday email now (normally every Monday)
- *REPORT*: results of the latest email campaign`;

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

export async function handleMessage(input: {
  owner: string;
  sandbox: string;
  body: string;
  buttonPayload: string | undefined;
  media?: { url: string; contentType: string } | null;
}) {
  const { owner, sandbox, body } = input;
  const supabase = getSupabase();
  let ctx = await loadRestaurantContext();
  const channel: OwnerChannel = { restaurantId: ctx.restaurantId, from: sandbox, to: owner };
  const send: Send = (text, withButtons = false) => messageOwner(channel, text, withButtons);

  try {
    // Remember where reminders and reports should go.
    if (ctx.restaurant.owner_whatsapp !== owner || ctx.restaurant.whatsapp_from !== sandbox) {
      await updateRestaurant(ctx.restaurantId, { owner_whatsapp: owner, whatsapp_from: sandbox });
      ctx = await loadRestaurantContext();
    }

    const command = input.media ? null : parseCommand(body);

    // This morning's brief was held because the owner hadn't messaged in 24 hours:
    // now they have, so it goes first (unless they're asking for it anyway).
    if (ctx.restaurant.brief_waiting_since && command?.name !== "run_brief") {
      await deliverWaitingBrief(ctx.restaurant, channel, ctx.now);
      ctx = await loadRestaurantContext();
    }

    if (input.media) {
      await photoPost(ctx, input.media, body, send);
    } else if (command) {
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

  async function runCommand(command: Command, ctx: RestaurantContext, send: Send) {
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
        // Anything queued for this (fake) time goes out now.
        await releaseQueue(updated, now);
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
      case "set_reward": {
        await updateRestaurant(r.id, { signup_reward: command.reward });
        return send(
          `🎁 Sign-up reward set to *${command.reward}*.\nEveryone who signs up from now on gets this. (Rewards already emailed stay as they were.)\nSign-up page: ${appUrl()}/r/${r.slug}`,
        );
      }
      case "reward":
        return send(
          `🎁 Current sign-up reward: *${r.signup_reward ?? "not set"}*\nChange it with: set sign-up reward to …`,
        );
      case "qr":
        return send(
          `📱 *Sign-up page:* ${appUrl()}/r/${r.slug}\n🖨️ *Printable QR card:* ${appUrl()}/r/${r.slug}/qr\nOpen the QR link on a computer and press Ctrl+P to print it.`,
        );
      case "my_email":
        await updateRestaurant(r.id, { owner_email: command.email });
        return send(
          `📧 Got it. Your copy of every campaign email goes to *${command.email}*.${r.email_test_mode ? "\n_Test mode is on: that's the only real email; customers are logged as simulated._" : ""}`,
        );
      case "birthday_campaign":
        return proposeBirthdayCampaign(ctx, send);
      case "report": {
        const [latest] = await recentCampaignStats(r.id, 1);
        return send(latest ? statsText(latest) : "No email campaigns have been sent yet. Try: Thursday is quiet");
      }
      case "run_brief": {
        // Exactly what 9am sends, minus the once-a-day jobs (so tomorrow's real brief still comes).
        const outcome = await sendBrief(r, channel, ctx.now);
        if (!outcome.sent) {
          await send(
            "☀️ *Morning brief:* nothing to approve and no activity in the last 24 hours, so on a real morning I'd send nothing at all.\nTry NEW REVIEW 5 or RUN POSTS first, then RUN BRIEF again.",
          );
        }
        return;
      }
      case "approve_all":
        return send(await approveAll(r, ctx.now));
      case "run_report": {
        const report = await createReport(ctx, reportPeriod(ctx.now, false));
        return send(report.headline);
      }
      case "new_review":
        return newReview(ctx, command.rating, send);
      case "run_reviews": {
        const result = await runReviewCheck(ctx, send);
        if (!result.found) await send("🔎 Review check done: no new reviews since the last check.");
        else if (result.held) await send(heldNote(`${result.held} review repl${result.held === 1 ? "y" : "ies"}`));
        return;
      }
      case "run_posts":
        await runPostJob(ctx);
        return send(heldNote("a Google post"));
      case "queue": {
        const [active, queue] = await Promise.all([getActiveDraft(r.id), getQueue(r.id)]);
        const lines = ["📋 *Your approval queue*"];
        lines.push(active ? `- On screen now: ${KIND_LABELS[active.kind]} for ${active.audience}` : "- Nothing on screen right now");
        for (const d of queue) lines.push(`- Waiting: ${KIND_LABELS[d.kind]} for ${d.audience}`);
        if (!queue.length) lines.push("- Nothing else waiting 🎉");
        else if (!active) lines.push("\nText NEXT to bring up the next one.");
        return send(lines.join("\n"));
      }
      case "next": {
        const active = await getActiveDraft(r.id);
        if (active?.waiting_for === "decision") {
          return send(`👀 This one is still waiting for you:\n\n${draftMessage(active, r)}`, true);
        }
        if (!(await presentNext(ctx, send, true))) await send("Your queue is empty. 🎉");
        return;
      }
    }
  }

  // A button on a brief item, or "APPROVE 2" / "EDIT 2" / "SKIP 2".
  async function handleTargeted(ctx: RestaurantContext, t: TargetedAction, send: Send) {
    const r = ctx.restaurant;
    const draft = t.draftId
      ? check(await supabase.from("drafts").select("*").eq("id", t.draftId).eq("restaurant_id", r.id).maybeSingle<Draft>())
      : await draftByBriefNumber(r, t.briefNumber!);
    if (!draft) {
      return send(t.briefNumber ? `I can't find item ${t.briefNumber} in your latest brief. Text RUN BRIEF to see it again.` : "Sorry, I couldn't find that draft.");
    }
    const label = draft.brief_number ? `item ${draft.brief_number}` : "that draft";

    if (draft.status !== "pending") {
      // A second Approve on something already approved: the rules decide (and log) it.
      if (t.action === "approve" && draft.approved_at) {
        return send(sendResultMessage(await attemptSend(draft.id, r, ctx.now, "approve")));
      }
      return send(`${label[0].toUpperCase()}${label.slice(1)} isn't waiting any more (it was ${draft.status}).`);
    }

    if (t.action === "approve") {
      const wasOnScreen = draft.waiting_for !== null;
      const approved = await approveDraft(draft);
      const result = sendResultMessage(await attemptSend(approved.id, r, ctx.now, "approve"));
      await send(`${draft.brief_number ? `*${draft.brief_number}.* ` : ""}${result}${draft.briefed_at ? remainingNote(await remainingInBrief(r)) : ""}`);
      if (wasOnScreen) await presentNext(ctx, send);
      return;
    }
    if (t.action === "edit") {
      await startEdit(draft);
      return send(`✏️ What would you like me to change in ${label}?`);
    }
    await skipDraft(draft);
    return send(`👍 Skipped ${label}. Quick question so I can learn: why didn't this one work? A few words is fine.`);
  }

  async function handleConversation(
    ctx: RestaurantContext,
    body: string,
    buttonPayload: string | undefined,
    send: Send,
  ) {
    const r = ctx.restaurant;
    const targeted = parseTargetedAction(buttonPayload, body);
    if (targeted) return handleTargeted(ctx, targeted, send);

    const [active, learning] = await Promise.all([getActiveDraft(r.id), getLearningContext(r.id)]);
    const action = parseAction(buttonPayload, body);
    // The draft that Approve / Edit / Skip would apply to, if any.
    const decisionDraft =
      active && (active.waiting_for === "decision" || active.waiting_for === "edit_instructions") ? active : null;

    if (action === "approve") {
      if (decisionDraft) {
        const approved = await approveDraft(decisionDraft);
        await send(sendResultMessage(await attemptSend(approved.id, r, ctx.now, "approve")));
        await presentNext(ctx, send);
        return;
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
      if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, body, send);
      const rewritten = await rewriteDraft(ctx, learning, active, body);
      return reviseAndSend(ctx, active, body, rewritten, send);
    }

    // The owner is telling us why they skipped.
    if (active?.waiting_for === "skip_reason") {
      await saveSkipReason(active, body);
      await send("Thanks, noted. I'll keep that in mind for next time. 🙏");
      await presentNext(ctx, send);
      return;
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
    if (result.type === "campaign") {
      return campaignCreateAndSend(ctx, result.fields, body, send);
    }
    if (result.type === "pasted_review") {
      return pastedReviewReply(ctx, result, send);
    }
    if (result.type === "revise" && active?.waiting_for === "decision") {
      if (active.kind === "email_campaign") return reviseCampaignAndSend(ctx, active, result.instruction, send);
      return reviseAndSend(ctx, active, result.instruction, result.content, send);
    }
    if (result.type === "text") return send(result.text);
    return send("Sorry, I lost track of that draft. Could you ask again?");
  }
}

// What test commands say when their draft is held for the brief (as the real job would).
function heldNote(what: string) {
  return `📥 Drafted ${what} and held it for your morning brief, like the scheduled job does. Text *RUN BRIEF* to see the brief now.`;
}

// New email campaigns go through the campaign checker, then to the owner for approval
// (or, in hold mode, quietly into the morning brief).
async function campaignCreateAndSend(
  ctx: RestaurantContext,
  fields: CampaignFields,
  request: string,
  send: Send,
  intro = "",
  isBirthday = false,
  mode: "present" | "hold" = "present",
) {
  const checked = await checkCampaign(ctx, fields);
  const { draft } = await createCampaignDraft({
    restaurant: ctx.restaurant,
    fields: checked.fields,
    request,
    checkNotes: checked.notes,
    now: ctx.now,
    isBirthday,
    mode,
  });
  if (draft.waiting_for === "decision") await send(`${intro}${draftMessage(draft, ctx.restaurant)}`, true);
}

// Campaign edits: the AI rewrites the structured campaign, then it's re-checked.
async function reviseCampaignAndSend(ctx: RestaurantContext, draft: Draft, instruction: string, send: Send) {
  const campaign = await getCampaignForDraft(draft.id);
  if (!campaign) return send("Sorry, I couldn't find that campaign. Could you ask for it again?");
  const learning = await getLearningContext(ctx.restaurantId);
  const rewritten = await rewriteCampaign(ctx, learning, campaign, instruction);
  const checked = await checkCampaign(ctx, rewritten);
  const updated = await updateCampaignDraft({
    restaurant: ctx.restaurant,
    draft,
    campaign,
    fields: checked.fields,
    instruction,
    checkNotes: checked.notes,
    now: ctx.now,
  });
  await send(draftMessage(updated, ctx.restaurant), true);
}

// The weekly birthday email. Runs from the Monday morning job (held for the brief), or BIRTHDAY CAMPAIGN.
export async function proposeBirthdayCampaign(ctx: RestaurantContext, send: Send, mode: "present" | "hold" = "present") {
  const { eligible } = await recipientsFor(ctx.restaurant, "birthdays_7d", ctx.now);
  if (!eligible.length) {
    if (mode === "hold") return; // nothing to approve, so nothing to say
    return send("🎂 No customers with email consent have a birthday in the next 7 days, so there's no birthday email this week.");
  }
  const learning = await getLearningContext(ctx.restaurantId);
  const fields = await writeBirthdayCampaign(ctx, learning);
  await campaignCreateAndSend(
    ctx,
    // Dates and segment are fixed in plain code, not left to the AI.
    { ...fields, segment: "birthdays_7d", ...birthdayWeek(ctx.now) },
    "Weekly birthday email",
    send,
    `🎂 *This week's birthday email* (${eligible.length} customer${eligible.length === 1 ? "" : "s"}: ${eligible.map((c) => c.name.split(/\s+/)[0]).join(", ")})\n\n`,
    true,
    mode,
  );
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

// Test command: a new review "appears on Google" (dummy mode), then the
// normal review check runs straight away instead of waiting for the hour.
async function newReview(ctx: RestaurantContext, rating: number | null, send: Send) {
  const g = google();
  if (!g.addDummyReview) return send("NEW REVIEW only works in dummy Google mode.");
  const pick = randomDummyReview(rating ?? undefined);
  const review = await g.addDummyReview(ctx.restaurantId, pick);
  await send(
    `🌐 A new ${review.rating}-star review from ${review.author_name.replace(/\.$/, "")} just appeared on (dummy) Google. Running the review check now…`,
  );
  const result = await runReviewCheck(ctx, send);
  // 1-3 stars: the alert itself was the reply. 4-5 stars: held, as the hourly check would.
  if (result.held) await send(heldNote(`a reply to ${review.author_name.replace(/\.$/, "")}'s review`));
}

// The manual fallback: the owner pastes a review from anywhere; they get a
// checked reply to copy into Google themselves. Nothing is posted for them.
async function pastedReviewReply(
  ctx: RestaurantContext,
  review: { authorName: string; rating: number | null; text: string },
  send: Send,
) {
  const learning = await getLearningContext(ctx.restaurantId);
  const content = await writeReviewReply(ctx, learning, { author_name: review.authorName, rating: review.rating, text: review.text });
  const checked = await checkDraft(ctx, {
    kind: "review_reply",
    audience: `review by ${review.authorName}`,
    content,
    context: `Replying to this ${review.rating ? `${review.rating}-star ` : ""}review: "${review.text}"`,
  });
  const notes = [
    ...checked.notes.fixes.map((f) => `🔍 _Checker fixed: ${f}_`),
    ...checked.notes.flags.map((f) => `⚠️ _Check: ${f}_`),
  ];
  await send(
    `✍️ Here's a reply to ${review.authorName}'s review. *Copy the next message* and paste it as your reply on Google.${notes.length ? `\n\n${notes.join("\n")}` : ""}`,
  );
  // On its own, so it's easy to copy in one go.
  await send(checked.content);
}

// A photo sent on WhatsApp becomes a captioned Google post, waiting for approval.
async function photoPost(ctx: RestaurantContext, media: { url: string; contentType: string }, note: string, send: Send) {
  if (!isSupportedImage(media.contentType)) {
    return send("I can only turn photos (JPEG, PNG or WebP) into Google posts. Videos and documents aren't supported yet.");
  }
  await send("📷 Got your photo! Writing a caption…");
  const bytes = await downloadTwilioMedia(media.url);
  const photoUrl = await savePostPhoto(ctx.restaurantId, bytes, media.contentType);
  const learning = await getLearningContext(ctx.restaurantId);
  const post = await captionPhoto(ctx, learning, { base64: bytes.toString("base64"), mediaType: media.contentType }, note.trim());
  const draft = await createPostDraft(ctx, { topic: post.topic, text: post.text, photoUrl, request: note || "Photo post", mode: "present" });
  await send(`📷 *Photo post for Google*\n\n${postMessage(draft, post.topic, photoUrl, ctx)}`, true);
}
