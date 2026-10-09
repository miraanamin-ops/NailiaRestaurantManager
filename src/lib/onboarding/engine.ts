import "server-only";
import { logSetting } from "@/lib/audit";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { DEFAULT_DISCOUNT_CAP, draftVoices, extractMenu, suggestAllergens, suggestReward, type MenuImage } from "./ai";
import { placesAvailable, profileFromPlace, searchPlaces } from "./places";
import { formatPrice, menuItemCount, type MenuCategory } from "./profile-data";
import { canFinish, mark, nextStep, STEP_LABELS, STEPS, stepsDone, type StepId } from "./steps";
import { getOnboarding, getRestaurant, patchData, saveOnboarding, updateRestaurantFields, type Onboarding } from "./store";
import { readWebsite } from "./website";

// The onboarding engine: every step's actions, used by BOTH the web wizard and
// WhatsApp. Each action saves progress, so the owner can switch at any point.
// Rule: never ask for what we can find; most steps are confirming, not typing.

const PHOTO_BUCKET = "post-photos";

export async function state(restaurantId: string) {
  const [restaurant, onboarding] = await Promise.all([getRestaurant(restaurantId), getOnboarding(restaurantId)]);
  if (!onboarding) throw new Error("This restaurant has no onboarding");
  return {
    restaurant,
    onboarding,
    step: nextStep(onboarding.steps),
    whatsappLinked: Boolean(restaurant.owner_whatsapp),
    done: stepsDone(onboarding.steps),
    total: STEPS.length,
  };
}
export type OnboardingState = Awaited<ReturnType<typeof state>>;

async function setStep(restaurantId: string, o: Onboarding, step: StepId, status: "done" | "skipped", extra: Partial<Onboarding> = {}) {
  let steps = mark(o.steps, step, status);
  // No menu means no allergens to check.
  if (step === "menu" && status === "skipped") steps = mark(steps, "allergens", "skipped");
  return saveOnboarding(restaurantId, { steps, ...extra });
}

export async function skip(restaurantId: string, step: StepId) {
  if (step === "finish") throw new Error("Finishing can't be skipped");
  const o = (await getOnboarding(restaurantId))!;
  return setStep(restaurantId, o, step, "skipped");
}

// ---------- 1. Google ----------

// Searches by the restaurant's name (plus an area, if the owner gave one).
export async function findOnGoogle(restaurantId: string, area?: string) {
  if (!placesAvailable()) return { available: false as const, candidates: [] };
  const r = await getRestaurant(restaurantId);
  const candidates = await searchPlaces([r.name, area].filter(Boolean).join(" "));
  await patchData(restaurantId, { google: { candidates } });
  return { available: true as const, candidates };
}

export async function confirmGoogle(restaurantId: string, placeId: string) {
  const fields = await profileFromPlace(restaurantId, placeId);
  const restaurant = await updateRestaurantFields(restaurantId, fields);
  const o = (await getOnboarding(restaurantId))!;
  await setStep(restaurantId, o, "google", "done", { data: { ...o.data, google: { ...o.data.google, chosen: placeId } } });
  return restaurant;
}

// ---------- 2. Menu ----------

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Saves menu photos (from the web form or WhatsApp) until the owner says that's all.
export async function addMenuPhotos(restaurantId: string, photos: { bytes: Buffer; contentType: MenuImage["mediaType"] }[]) {
  const storage = getSupabase().storage.from(PHOTO_BUCKET);
  const urls: string[] = [];
  for (const p of photos) {
    const path = `${restaurantId}/menu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[p.contentType] ?? "jpg"}`;
    const { error } = await storage.upload(path, p.bytes, { contentType: p.contentType });
    if (error) throw new Error(`Couldn't save the menu photo: ${error.message}`);
    urls.push(storage.getPublicUrl(path).data.publicUrl);
  }
  const o = (await getOnboarding(restaurantId))!;
  const all = [...(o.data.menu?.photos ?? []), ...urls];
  await patchData(restaurantId, { menu: { ...o.data.menu, photos: all } });
  return all.length;
}

// Reads every saved menu photo and keeps the result as a draft for the owner to check.
export async function readMenuPhotos(restaurantId: string) {
  const o = (await getOnboarding(restaurantId))!;
  const urls = o.data.menu?.photos ?? [];
  if (!urls.length) return [];
  const images: MenuImage[] = [];
  for (const url of urls) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0] as MenuImage["mediaType"];
    images.push({ base64: Buffer.from(await res.arrayBuffer()).toString("base64"), mediaType: EXT[type] ? type : "image/jpeg" });
  }
  const draft = await extractMenu(images);
  await patchData(restaurantId, { menu: { ...o.data.menu, draft } });
  return draft;
}

// The owner checked the menu (and maybe corrected it): it becomes the real menu.
export async function confirmMenu(restaurantId: string, menu: MenuCategory[]) {
  const before = await getRestaurant(restaurantId);
  await updateRestaurantFields(restaurantId, { menu });
  await logSetting(restaurantId, "menu", before.menu, menu, `Set up the menu (${menuItemCount(menu)} dishes)`);
  const o = (await getOnboarding(restaurantId))!;
  let steps = mark(o.steps, "menu", "done");
  if (!menuItemCount(menu)) steps = mark(steps, "allergens", "skipped");
  await saveOnboarding(restaurantId, { steps, data: { ...o.data, menu: { photos: o.data.menu?.photos ?? [], draft: menu } } });
}

// ---------- 3. Allergens ----------

// Suggestions are saved on the menu but marked unconfirmed, so they're never
// shown to customers or used in their messages until the owner confirms.
export async function suggestMenuAllergens(restaurantId: string) {
  const r = await getRestaurant(restaurantId);
  if (!menuItemCount(r.menu)) return r.menu;
  const withSuggestions = await suggestAllergens(r.menu);
  await updateRestaurantFields(restaurantId, { menu: withSuggestions });
  return withSuggestions;
}

// The owner's confirmed allergens (as checked, or corrected) for every dish.
export async function confirmAllergens(restaurantId: string, menu: MenuCategory[]) {
  const confirmed = menu.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, allergens: i.allergens ?? [], allergens_confirmed: true })) }));
  await updateRestaurantFields(restaurantId, { menu: confirmed });
  const o = (await getOnboarding(restaurantId))!;
  await setStep(restaurantId, o, "allergens", "done");
  return confirmed;
}

// ---------- 4. Brand voice ----------

export async function draftVoiceOptions(restaurantId: string, captions: string[] = []) {
  const r = await getRestaurant(restaurantId);
  const websiteText = await readWebsite(r.website);
  const samples = await draftVoices({
    name: r.name,
    cuisine: r.cuisine,
    websiteText,
    captions,
    dishes: (r.menu ?? []).flatMap((c) => c.items.map((i) => i.name)),
  });
  await patchData(restaurantId, { voice: { samples, captions } });
  return { samples, readWebsite: Boolean(websiteText) };
}

export async function chooseVoice(restaurantId: string, voice: string) {
  const before = await getRestaurant(restaurantId);
  await updateRestaurantFields(restaurantId, { brand_voice: voice });
  await logSetting(restaurantId, "brand_voice", before.brand_voice, voice, "Chose the brand voice");
  const o = (await getOnboarding(restaurantId))!;
  await setStep(restaurantId, o, "voice", "done");
}

// ---------- 5. Reward and discount cap ----------

export async function rewardDefaults(restaurantId: string) {
  const r = await getRestaurant(restaurantId);
  return { reward: r.signup_reward ?? suggestReward(r.menu ?? []), cap: r.discount_cap_percent ?? DEFAULT_DISCOUNT_CAP };
}

export async function acceptReward(restaurantId: string, reward: string, cap: number) {
  const capped = Math.max(0, Math.min(100, Math.round(cap)));
  await updateRestaurantFields(restaurantId, { signup_reward: reward.trim().slice(0, 100), discount_cap_percent: capped });
  const o = (await getOnboarding(restaurantId))!;
  await setStep(restaurantId, o, "reward", "done");
}

// ---------- 6. Finish ----------

export function qrPackUrl(r: Pick<Restaurant, "slug">) {
  return `${appUrl()}/r/${r.slug}/qr-pack`;
}

// What's been set up, in a few lines (for WhatsApp and the web).
export function summaryLines(r: Restaurant, o: Onboarding) {
  const items = menuItemCount(r.menu ?? []);
  const confirmedAllergens = (r.menu ?? []).every((c) => c.items.every((i) => i.allergens_confirmed));
  const line = (step: StepId, text: string) => `${o.steps[step]?.status === "skipped" ? "⏭️" : "✅"} ${text}`;
  return [
    line("google", o.steps.google?.status === "skipped" ? "Google: skipped" : `Google: ${r.address ?? "found"}${r.google_rating ? ` · ${r.google_rating}★ (${r.google_rating_count ?? 0} reviews)` : ""}`),
    line("menu", items ? `Menu: ${items} dishes in ${r.menu.length} section${r.menu.length === 1 ? "" : "s"}` : "Menu: skipped"),
    line("allergens", items && confirmedAllergens ? "Allergens: confirmed for every dish" : "Allergens: not confirmed yet (customers never see unconfirmed ones)"),
    line("voice", r.brand_voice ? `Voice: ${r.brand_voice.split(".")[0]}.` : "Voice: skipped"),
    line("reward", `Sign-up reward: ${r.signup_reward ?? "not set"} · discount cap ${r.discount_cap_percent}%`),
  ];
}

export async function finish(restaurantId: string) {
  const s = await state(restaurantId);
  if (!canFinish(s.onboarding.steps, s.whatsappLinked)) {
    const missing = STEPS.filter((x) => x !== "finish" && !s.onboarding.steps[x]).map((x) => STEP_LABELS[x]);
    return { ok: false as const, needsWhatsapp: !s.whatsappLinked, missing };
  }
  const now = new Date().toISOString();
  const restaurant = await updateRestaurantFields(restaurantId, { active: true });
  const onboarding = await saveOnboarding(restaurantId, { steps: mark(s.onboarding.steps, "finish", "done"), completed_at: now, wa_waiting: null });
  return { ok: true as const, restaurant, onboarding, summary: summaryLines(restaurant, onboarding), qrPack: qrPackUrl(restaurant) };
}

export function menuSummaryText(menu: MenuCategory[], maxChars = 1200) {
  const lines: string[] = [];
  for (const c of menu) {
    lines.push(`*${c.category}*`);
    for (const i of c.items) lines.push(`- ${i.name} ${i.price ? formatPrice(i.price) : ""}`.trimEnd());
  }
  let text = lines.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars).replace(/\n[^\n]*$/, "")}\n…`;
  return text;
}
