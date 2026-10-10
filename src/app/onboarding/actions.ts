"use server";
import { redirect } from "next/navigation";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import * as engine from "@/lib/onboarding/engine";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";

import { STEPS, type StepId } from "@/lib/onboarding/steps";
import { getOnboarding } from "@/lib/onboarding/store";
import { isTestMode } from "@/lib/test-mode";
import { ownRestaurant } from "./load";

// Every button in the web wizard. Each checks the person owns the restaurant,
// saves through the onboarding engine (the same one WhatsApp uses), and goes
// back to the wizard, which shows whichever step is next.

const get = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const back = (rid: string): never => redirect(`/onboarding/setup?r=${rid}`);

async function rid(form: FormData) {
  const r = get(form, "r");
  await ownRestaurant(r);
  return r;
}

export async function skipStep(form: FormData) {
  const r = await rid(form);
  const step = get(form, "step") as StepId;
  if (STEPS.includes(step) && step !== "finish") await engine.skip(r, step);
  back(r);
}

// ---------- 1. Google ----------

export async function searchGoogle(form: FormData) {
  const r = await rid(form);
  await engine.findOnGoogle(r, get(form, "area").slice(0, 60) || undefined);
  back(r);
}

export async function pickGoogle(form: FormData) {
  const r = await rid(form);
  const o = await getOnboarding(r);
  const place = get(form, "place");
  // Only one of the places we offered.
  if (o?.data.google?.candidates?.some((c) => c.id === place)) await engine.confirmGoogle(r, place);
  back(r);
}

// ---------- 2. Menu (called from the browser, one photo at a time) ----------

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export async function uploadMenuPhoto(restaurantId: string, form: FormData) {
  await ownRestaurant(restaurantId);
  const file = form.get("photo");
  if (!(file instanceof Blob) || !IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) return { error: "That isn't a photo." };
  if (file.size > 2.5 * 1024 * 1024) return { error: "That photo is too large." };
  const count = await engine.addMenuPhotos(restaurantId, [{ bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type as (typeof IMAGE_TYPES)[number] }]);
  return { count };
}

export async function readMenu(restaurantId: string) {
  await ownRestaurant(restaurantId);
  try {
    const draft = await engine.readMenuPhotos(restaurantId);
    return { items: draft.reduce((n, c) => n + c.items.length, 0) };
  } catch (err) {
    console.error("Reading the menu failed", err);
    return { error: "Sorry, I couldn't read those photos. Please try again." };
  }
}

export async function startMenuAgain(form: FormData) {
  const r = await rid(form);
  await engine.clearMenuPhotos(r);
  back(r);
}

export async function saveMenu(restaurantId: string, menu: unknown) {
  await ownRestaurant(restaurantId);
  await engine.confirmMenu(restaurantId, cleanMenu(menu));
  back(restaurantId);
}

// ---------- 3. Allergens ----------

export async function saveAllergens(restaurantId: string, menu: unknown) {
  await ownRestaurant(restaurantId);
  await engine.confirmAllergens(restaurantId, cleanMenu(menu));
  back(restaurantId);
}

// ---------- 4. Voice ----------

export async function pickVoice(form: FormData) {
  const r = await rid(form);
  const o = await getOnboarding(r);
  const chosen = o?.data.voice?.samples?.[Number(get(form, "n"))];
  if (chosen) await engine.chooseVoice(r, chosen.voice);
  back(r);
}

export async function redraftVoices(form: FormData) {
  const r = await rid(form);
  const captions = get(form, "captions")
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((c) => c.slice(0, 600));
  await engine.draftVoiceOptions(r, captions);
  back(r);
}

// ---------- 5. Reward ----------

export async function saveReward(form: FormData) {
  const r = await rid(form);
  const defaults = await engine.rewardDefaults(r);
  const cap = Number(get(form, "cap"));
  await engine.acceptReward(r, get(form, "reward") || defaults.reward, Number.isFinite(cap) && get(form, "cap") ? cap : defaults.cap);
  back(r);
}

// ---------- 6. Finish ----------

export async function finishSetup(form: FormData) {
  const r = await rid(form);
  const result = await engine.finish(r);
  if (result.ok) {
    await engine.sendFinishSummary(result.restaurant, result.summary, result.qrPack, ourWhatsAppNumber()).catch((err) => console.error("Couldn't send the summary", err));
    redirect(`/onboarding?r=${r}`);
  }
  back(r);
}

// TEST MODE only, demo restaurants only.
export async function resetSetup(form: FormData) {
  const r = await rid(form);
  if (!isTestMode()) throw new Error("Test mode is off");
  await engine.resetOnboarding(r);
  redirect(`/onboarding?r=${r}`);
}
