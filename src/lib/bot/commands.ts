import "server-only";
import { approveAll, sendBrief } from "@/lib/brief";
import { recentCampaignStats, statsText } from "@/lib/campaigns";
import { formatLondon, formatWindow, isInSendWindow, londonTimeOn } from "@/lib/clock";
import { getActiveDraft, getQueue, KIND_LABELS } from "@/lib/drafts";
import { draftMessage, sendResultMessage } from "@/lib/format";
import { releaseQueue } from "@/lib/followups";
import { presentNext, runPostJob, runReviewCheck } from "@/lib/google-jobs";
import { createReport, reportPeriod } from "@/lib/report/build";
import { attemptSend } from "@/lib/send";
import { appUrl, getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";
import { checkCreateAndSend, heldNote, newReview, proposeBirthdayCampaign } from "./flows";
import type { Command } from "./parse";
import { updateRestaurant, type Turn } from "./turn";

// Exact typed commands: settings, test commands and shortcuts. (Parsing is in ./parse.ts.)

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

export async function runCommand(command: Command, turn: Turn) {
  const { ctx, channel, send } = turn;
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
    case "cap":
      await updateRestaurant(r.id, { discount_cap_percent: command.percent });
      return send(`💷 Discount cap set to *${command.percent}%*. Any offer above that will be blocked.`);
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
    case "set_reward":
      await updateRestaurant(r.id, { signup_reward: command.reward });
      return send(
        `🎁 Sign-up reward set to *${command.reward}*.\nEveryone who signs up from now on gets this. (Rewards already emailed stay as they were.)\nSign-up page: ${appUrl()}/r/${r.slug}`,
      );
    case "reward":
      return send(`🎁 Current sign-up reward: *${r.signup_reward ?? "not set"}*\nChange it with: set sign-up reward to …`);
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
