import "server-only";
import { messageOwner, type OwnerChannel } from "@/lib/notify";
import { downloadTwilioMedia, isSupportedImage } from "@/lib/photos";
import { appUrl, getSupabase } from "@/lib/supabase";
import { isTestMode } from "@/lib/test-mode";
import { replyUnregistered } from "@/lib/unregistered";
import * as engine from "./engine";
import { placesAvailable } from "./places";
import { formatPrice, menuItemCount, type MenuCategory } from "./profile-data";
import { parseOnboardingReply, parseRewardReply, splitMessage, STEP_LABELS, STEPS, type StepId } from "./steps";
import { getOnboarding, linkWhatsApp, saveOnboarding, type Onboarding } from "./store";

// Onboarding on WhatsApp: the same steps (and the same saved progress) as the
// web wizard, one message at a time. Most replies are a number, YES or SKIP;
// corrections are in the owner's own words. WEB sends a link to carry on there.
// What the bot is waiting for is saved as "<step>:<what>", so if the owner moved
// on in the web wizard meanwhile, an old question is simply asked afresh.

type Media = { url: string; contentType: string };
type Ctx = { restaurantId: string; send: (text: string) => Promise<void>; ourNumber: string };

export const setupUrl = (restaurantId: string) => `${appUrl()}/onboarding/setup?r=${restaurantId}`;

// Still setting up? (Restaurants from before onboarding existed, or if the
// onboarding table isn't there yet, count as set up.)
export async function onboardingInProgress(restaurantId: string) {
  try {
    const o = await getOnboarding(restaurantId);
    return Boolean(o && !o.completed_at);
  } catch (err) {
    console.error("Couldn't check onboarding; treating as set up", err);
    return false;
  }
}

function channelFor(restaurantId: string, ourNumber: string, owner: string): Ctx {
  const channel: OwnerChannel = { restaurantId, from: ourNumber, to: owner };
  return {
    restaurantId,
    ourNumber,
    send: async (text) => {
      for (const part of splitMessage(text)) await messageOwner(channel, part);
    },
  };
}

const LINK_FAILED: Record<"no_code" | "expired" | "number_taken", string> = {
  no_code: "That code didn't work. It may already have been used. Open your Naila setup page to get a fresh one. 🙏",
  expired: "That code has expired. Open your Naila setup page to get a fresh one. 🙏",
  number_taken: "This WhatsApp number is already linked to another restaurant on Naila, so I can't link it to this one.",
};

// Someone sent "Link my restaurant: K7Q2MZ".
export async function linkFromWhatsApp(code: string, number: string, ourNumber: string) {
  try {
    // Guessing codes: after 20 messages in a day from a number nobody has linked, stop listening.
    const { count } = await getSupabase()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("restaurant_id", null)
      .eq("direction", "inbound")
      .eq("from_number", number)
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) > 20) return console.warn("Too many link attempts from one number; ignoring");

    const result = await linkWhatsApp(code, number, ourNumber);
    if (!result.ok) {
      // Like the "not registered" reply: a few a day at most.
      await replyUnregistered(number, ourNumber, LINK_FAILED[result.reason], 3);
      return;
    }
    const ctx = channelFor(result.restaurant.id, ourNumber, number);
    await ctx.send(`✅ Linked! This WhatsApp is now connected to *${result.restaurant.name}*.`);
    if (result.onboarding.completed_at) return;
    await prompt(ctx, { fromLink: true });
  } catch (err) {
    console.error("Linking a WhatsApp number failed", err);
  }
}

// One message from an owner whose restaurant is still being set up.
export async function handleOnboardingMessage(input: { restaurantId: string; owner: string; sandbox: string; body: string; media: Media[] }) {
  const ctx = channelFor(input.restaurantId, input.sandbox, input.owner);
  try {
    await handle(ctx, input.body, input.media);
  } catch (err) {
    console.error("Onboarding message failed", err);
    await ctx.send("Sorry, something went wrong on my side. Please try again in a minute (or send HELP to see where we were). 🙏");
  }
}

function waitingFor(o: Onboarding, step: StepId) {
  const [s, what] = (o.wa_waiting ?? "").split(":");
  return s === step ? what : null;
}
const wait = (restaurantId: string, step: StepId, what: string) => saveOnboarding(restaurantId, { wa_waiting: `${step}:${what}` });

async function handle(ctx: Ctx, body: string, media: Media[]) {
  const s = await engine.state(ctx.restaurantId);
  if (s.onboarding.completed_at || !s.step) return;
  const step = s.step;
  const reply = parseOnboardingReply(body);
  if (isTestMode() && /^reset (onboarding|setup)$/i.test(body.trim())) return ctx.send(await resetOnboardingText(s.restaurant));

  if (!media.length && reply.kind === "web") {
    return ctx.send(`Carry on in your browser here (it picks up where we are): ${setupUrl(ctx.restaurantId)}`);
  }
  if (!media.length && reply.kind === "help") return prompt(ctx);
  if (!media.length && reply.kind === "skip" && step !== "finish") {
    await engine.skip(ctx.restaurantId, step);
    await ctx.send(`⏭️ Skipped ${STEP_LABELS[step].toLowerCase()}. You can do it later in Settings.`);
    return prompt(ctx);
  }

  if (media.length && step !== "menu") {
    await ctx.send("Thanks! I only use photos for the menu, and we're past that step.");
    return prompt(ctx);
  }
  const what = waitingFor(s.onboarding, step);
  switch (step) {
    case "google":
      return googleStep(ctx, s.onboarding, what, reply);
    case "menu":
      return menuStep(ctx, s.onboarding, what, reply, media);
    case "allergens":
      if (what === "confirm" && reply.kind === "yes") {
        await engine.confirmAllergens(ctx.restaurantId, s.restaurant.menu ?? []);
        await ctx.send("✅ Allergens confirmed. Customers can now be told about them.");
        return prompt(ctx);
      }
      if (what === "confirm" && reply.kind === "text") {
        const menu = await engine.correctAllergens(ctx.restaurantId, reply.text);
        return ctx.send(`${allergenList(menu)}\n\nReply *YES* if that's all right now, or tell me what else to change.`);
      }
      return prompt(ctx);
    case "voice": {
      const samples = s.onboarding.data.voice?.samples ?? [];
      if (what === "pick" && reply.kind === "pick" && samples[reply.n - 1]) {
        await engine.chooseVoice(ctx.restaurantId, samples[reply.n - 1].voice);
        await ctx.send(`✅ Got it: *${samples[reply.n - 1].tone}*. I'll write like that.`);
        return prompt(ctx);
      }
      if (what === "pick" && reply.kind === "text" && reply.text.length > 30) {
        await ctx.send("Thanks! Writing three new options in your style… ✍️");
        const captions = reply.text.split(/\n\s*\n|\n(?=\S)/).map((c) => c.trim()).filter(Boolean).slice(0, 5);
        const { samples: fresh } = await engine.draftVoiceOptions(ctx.restaurantId, captions);
        return ctx.send(voiceOptions(fresh));
      }
      return prompt(ctx);
    }
    case "reward": {
      if (what !== "confirm") return prompt(ctx);
      const defaults = await engine.rewardDefaults(ctx.restaurantId);
      if (reply.kind === "yes") {
        await engine.acceptReward(ctx.restaurantId, defaults.reward, defaults.cap);
      } else if (reply.kind === "text") {
        const change = parseRewardReply(reply.text);
        await engine.acceptReward(ctx.restaurantId, change.reward ?? defaults.reward, change.cap ?? defaults.cap);
        await ctx.send(`✅ Saved: new customers get *${change.reward ?? defaults.reward}*, discounts capped at ${change.cap ?? defaults.cap}%.`);
      } else return prompt(ctx);
      return prompt(ctx);
    }
    case "finish":
      if (reply.kind === "yes" || reply.kind === "done" || what !== "confirm") return finishHere(ctx);
      return prompt(ctx);
  }
}

// RESET ONBOARDING (test mode, demo restaurants only): back to just signed up.
export async function resetOnboardingText(r: { id: string; is_demo: boolean; name: string }) {
  if (!r.is_demo) return "🧪 Only demo (test) restaurants can be reset, so nothing changed.";
  await engine.resetOnboarding(r.id);
  return `🧪 Reset: ${r.name} is back to just signed up (menu, hours, voice and reward cleared; WhatsApp still linked). Reply *START* to set up again here, or carry on in the browser: ${setupUrl(r.id)}`;
}

// ---------- Asking for each step ----------

const header = (step: StepId) => `*Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}: ${STEP_LABELS[step]}*`;

// Asks the question for wherever the owner is now (after anything they did on the web, too).
async function prompt(ctx: Ctx, opts: { fromLink?: boolean } = {}) {
  const s = await engine.state(ctx.restaurantId);
  const step = s.step;
  if (!step || s.onboarding.completed_at) return;
  const intro = opts.fromLink && s.done > 0 ? "Let's carry on from where you got to. (Reply *WEB* any time to switch back to the browser.)\n\n" : "";
  const introFirst = opts.fromLink && s.done === 0 ? `Let's set up *${s.restaurant.name}*: 6 quick steps, mostly just checking what I find. Reply *SKIP* to skip a step, *WEB* to carry on in your browser instead.\n\n` : "";

  switch (step) {
    case "google": {
      if (!placesAvailable()) {
        await engine.skip(ctx.restaurantId, "google");
        await ctx.send(`${introFirst}${intro}(Google search isn't switched on yet, so I've skipped finding you on Google. You can add your address and hours later.)`);
        return prompt(ctx);
      }
      await ctx.send(`${introFirst}${intro}${header("google")}\nLooking for ${s.restaurant.name} on Google… 🔎`);
      const { candidates } = await engine.findOnGoogle(ctx.restaurantId);
      return askGoogle(ctx, candidates);
    }
    case "menu":
      await wait(ctx.restaurantId, "menu", "photos");
      return ctx.send(
        `${introFirst}${intro}${header("menu")}\nSend me photos of your menu: one per page, as many as you need. Reply *DONE* when you've sent them all. (Or *SKIP* to add it later.)`,
      );
    case "allergens": {
      await ctx.send(`${intro}${header("allergens")}\nChecking your dishes for likely allergens… ⏳`);
      const menu = await engine.suggestMenuAllergens(ctx.restaurantId);
      await wait(ctx.restaurantId, "allergens", "confirm");
      return ctx.send(
        `${allergenList(menu)}\n\nThese are my guesses from the dish names. ⚠️ Please check with your kitchen: customers are never told about allergens until you confirm.\n\nReply *YES* to confirm, or correct me, e.g. _Samosa: gluten, mustard_ or _Lamb chops: no milk_.`,
      );
    }
    case "voice": {
      await ctx.send(`${intro}${header("voice")}\nReading your website and writing three ways your messages could sound… ✍️`);
      const { samples } = await engine.draftVoiceOptions(ctx.restaurantId);
      await wait(ctx.restaurantId, "voice", "pick");
      return ctx.send(voiceOptions(samples));
    }
    case "reward": {
      const d = await engine.rewardDefaults(ctx.restaurantId);
      await wait(ctx.restaurantId, "reward", "confirm");
      return ctx.send(
        `${intro}${header("reward")}\nCustomers who join your list get *${d.reward}*, and any discount I suggest is capped at *${d.cap}%*.\n\nReply *YES* to keep these, or tell me what to change, e.g. _a free samosa_ or _cap 20%_.`,
      );
    }
    case "finish":
      if (opts.fromLink) {
        await wait(ctx.restaurantId, "finish", "confirm");
        return ctx.send("Everything's ready. Reply *FINISH* to finish here, or tap Finish on the web page.");
      }
      return finishHere(ctx);
  }
}

async function finishHere(ctx: Ctx) {
  const result = await engine.finish(ctx.restaurantId);
  if (!result.ok) {
    return ctx.send(`Not quite done yet: ${result.missing.join(", ")} still to do. Send *HELP* to carry on.`);
  }
  await engine.sendFinishSummary(result.restaurant, result.summary, result.qrPack, ctx.ourNumber);
}

// ---------- 1. Google ----------

async function askGoogle(ctx: Ctx, candidates: { name: string; address: string }[]) {
  if (!candidates.length) {
    await wait(ctx.restaurantId, "google", "area");
    return ctx.send("I couldn't find you on Google. What's your postcode or area? (Or *SKIP*.)");
  }
  await wait(ctx.restaurantId, "google", "pick");
  const list = candidates.map((c, i) => `${i + 1}) *${c.name}*, ${c.address}`).join("\n");
  return ctx.send(
    `Is this you?\n\n${list}\n\nReply ${candidates.length === 1 ? "*1* (or *YES*)" : `*1*–*${candidates.length}*`}, or *NO* if it isn't. I'll copy your address, opening hours, phone number, rating and photos.`,
  );
}

async function googleStep(ctx: Ctx, o: Onboarding, what: string | null, reply: ReturnType<typeof parseOnboardingReply>) {
  const candidates = o.data.google?.candidates ?? [];
  if (what === "pick") {
    const n = reply.kind === "pick" ? reply.n : reply.kind === "yes" && candidates.length === 1 ? 1 : null;
    if (n && candidates[n - 1]) {
      const r = await engine.confirmGoogle(ctx.restaurantId, candidates[n - 1].id);
      const days = Object.keys(r.opening_hours ?? {}).length;
      await ctx.send(
        [
          "✅ Saved from Google:",
          r.address && `- Address: ${r.address}`,
          r.phone && `- Phone: ${r.phone}`,
          days ? `- Opening hours for ${days} days` : null,
          r.google_rating && `- Rating: ${r.google_rating}★ (${r.google_rating_count ?? 0} reviews)`,
          r.photos?.length ? `- ${r.photos.length} photos` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return prompt(ctx);
    }
    if (reply.kind === "no") {
      await wait(ctx.restaurantId, "google", "area");
      return ctx.send("No problem. What's your postcode or area? I'll look again. (Or *SKIP*.)");
    }
  }
  if ((what === "pick" || what === "area") && reply.kind === "text") {
    const { candidates: found } = await engine.findOnGoogle(ctx.restaurantId, reply.text.slice(0, 60));
    return askGoogle(ctx, found);
  }
  return prompt(ctx);
}

// ---------- 2. Menu ----------

async function menuStep(ctx: Ctx, o: Onboarding, what: string | null, reply: ReturnType<typeof parseOnboardingReply>, media: Media[]) {
  if (media.length) {
    const images = media.filter((m) => isSupportedImage(m.contentType));
    if (!images.length) return ctx.send("I can only read photos (JPEG or PNG). Could you send the menu as a photo?");
    const photos = [];
    for (const m of images) photos.push({ bytes: await downloadTwilioMedia(m.url), contentType: m.contentType as "image/jpeg" });
    const count = await engine.addMenuPhotos(ctx.restaurantId, photos);
    await wait(ctx.restaurantId, "menu", "photos");
    return ctx.send(`📷 Got it (${count} so far). Send more, or reply *DONE*.`);
  }
  if (what === "photos" && (reply.kind === "done" || reply.kind === "yes")) {
    if (!(await engine.menuPhotos(ctx.restaurantId)).length) return ctx.send("I haven't got any menu photos yet. Send one (or *SKIP*).");
    await ctx.send("Reading your menu… this takes about a minute. ⏳");
    const draft = await engine.readMenuPhotos(ctx.restaurantId);
    if (!menuItemCount(draft)) {
      return ctx.send("I couldn't read any dishes from those photos. Could you send clearer ones (flat, in good light)? Or *SKIP* for now.");
    }
    await wait(ctx.restaurantId, "menu", "confirm");
    return ctx.send(menuCheck(draft));
  }
  if (what === "confirm") {
    const draft = o.data.menu?.draft ?? [];
    if (reply.kind === "yes") {
      await engine.confirmMenu(ctx.restaurantId, draft);
      await ctx.send(`✅ Menu saved: ${menuItemCount(draft)} dishes.`);
      return prompt(ctx);
    }
    if (reply.kind === "text") {
      const fixed = await engine.correctMenuDraft(ctx.restaurantId, reply.text);
      return ctx.send(menuCheck(fixed));
    }
  }
  return prompt(ctx);
}

function menuCheck(menu: MenuCategory[]) {
  return `${engine.menuSummaryText(menu, 3000)}\n\nIs that right? Reply *YES*, or tell me what to change, e.g. _Lamb chops are £14_, _remove the samosa_, _add Mango Lassi £3.50 to Drinks_.`;
}

// ---------- 3 and 4 ----------

function allergenList(menu: MenuCategory[]) {
  return menu
    .flatMap((c) => c.items)
    .map((i) => `- ${i.name}${i.price ? ` (${formatPrice(i.price)})` : ""}: ${i.allergens?.length ? i.allergens.join(", ") : "none"}`)
    .join("\n");
}

function voiceOptions(samples: { tone: string; sample: string }[]) {
  const list = samples.map((v, i) => `*${i + 1}) ${v.tone}*\n"${v.sample}"`).join("\n\n");
  return `Which sounds most like you?\n\n${list}\n\nReply *1*, *2* or *3*. Or paste 2–3 of your Instagram captions and I'll try again in your style.`;
}
