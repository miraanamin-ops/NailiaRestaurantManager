"use server";
import { redirect } from "next/navigation";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import * as engine from "@/lib/onboarding/engine";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";

import { STEPS, type StepId } from "@/lib/onboarding/steps";
import { getOnboarding, getRestaurant } from "@/lib/onboarding/store";
import { headers } from "next/headers";
import { billingStanding } from "@/lib/billing/access";
import { createTrialCheckout } from "@/lib/billing/checkout";
import { stripeConfigured } from "@/lib/billing/config";
import { randomBytes } from "node:crypto";
import { MAX_DIRECT_UPLOAD_BYTES } from "@/lib/sales/pos-file";
import { receivePosFile } from "@/lib/sales/pos-import";
import { downloadSalesFile, SALES_BUCKET } from "@/lib/sales/store";
import { baseUrlFrom, getSupabase } from "@/lib/supabase";
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

// ---------- Free trial (if they didn't finish Stripe Checkout when signing up) ----------

export async function startTrial(form: FormData) {
  const r = await rid(form);
  const restaurant = await getRestaurant(r);
  if (billingStanding(restaurant).ok) redirect(`/onboarding?r=${r}`);
  if (!stripeConfigured()) redirect(`/onboarding?r=${r}&billing=off`);
  let url: string | null = null;
  try {
    url = await createTrialCheckout(restaurant, baseUrlFrom(await headers()));
  } catch (err) {
    console.error("Couldn't start Stripe Checkout", err);
  }
  redirect(url ?? `/onboarding?r=${r}&billing=error`);
}

// TEST MODE only, demo restaurants only.
export async function resetSetup(form: FormData) {
  const r = await rid(form);
  if (!isTestMode()) throw new Error("Test mode is off");
  await engine.resetOnboarding(r);
  redirect(`/onboarding?r=${r}`);
}

// ---------- 4. Voice: the website, if Google didn't find one ----------

export async function saveWebsite(form: FormData) {
  const r = await rid(form);
  const ok = await engine.setWebsite(r, get(form, "website") || null);
  if (!ok) redirect(`/onboarding/setup?r=${r}&website_error=1`);
  back(r);
}

export async function noWebsite(form: FormData) {
  const r = await rid(form);
  await engine.setWebsite(r, null);
  back(r);
}

// ---------- 5. Replying to reviews ----------

export async function saveReplies(form: FormData) {
  const r = await rid(form);
  const pick = (side: "positive" | "negative") => {
    const own = get(form, `${side}_own`);
    const n = Number(get(form, side));
    return own ? { own } : Number.isInteger(n) && n >= 1 && n <= 3 ? { n } : undefined;
  };
  const ok = await engine.chooseReplies(r, { positive: pick("positive"), negative: pick("negative") });
  if (!ok) redirect(`/onboarding/setup?r=${r}&replies_error=1`);
  back(r);
}

// ---------- 7. Last year's sales ----------
// A year of sales can be bigger than a normal upload allows (4 MB), so the browser
// sends the file straight to the private sales bucket, then asks for it to be read.

export async function salesUploadTarget(r: string, fileName: string, size: number): Promise<{ path: string; url: string } | { error: string }> {
  await ownRestaurant(r);
  if (size > MAX_DIRECT_UPLOAD_BYTES) return { error: `That file is over ${MAX_DIRECT_UPLOAD_BYTES / 1024 / 1024} MB. Export a few months at a time instead.` };
  const ext = (fileName.match(/\.(csv|xlsx|xls|txt)$/i)?.[1] ?? "csv").toLowerCase();
  const path = `${r}/pos/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const { data, error } = await getSupabase().storage.from(SALES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "Couldn't start the upload. Please try again." };
  return { path, url: data.signedUrl };
}

export async function importStoredSales(r: string, path: string, fileName: string, contentType: string): Promise<string> {
  const owner = await ownRestaurant(r);
  if (!path.startsWith(`${r}/pos/`)) throw new Error("Not this restaurant's file");
  const done = (key: "msg" | "error", text: string) => `/onboarding/setup?r=${r}&sales_${key}=${encodeURIComponent(text.replace(/^📊 /, ""))}`;
  try {
    const outcome = await receivePosFile({
      restaurantId: r,
      bytes: await downloadSalesFile(path),
      contentType,
      fileName,
      channel: "web",
      sentBy: owner.email,
      actor: "owner",
      storedPath: path,
      maxBytes: MAX_DIRECT_UPLOAD_BYTES,
    });
    if (outcome.status === "needs_mapping") return `/sales/import/${outcome.importId}?r=${r}&back=onboarding`;
    return done(outcome.status === "imported" ? "msg" : "error", outcome.message);
  } catch (err) {
    console.error("Onboarding sales import failed", err);
    return done("error", "Something went wrong reading that file. Please try again.");
  }
}

export async function finishSales(form: FormData) {
  const r = await rid(form);
  await engine.finishSalesStep(r);
  back(r);
}
