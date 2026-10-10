import "server-only";
import { logSetting } from "@/lib/audit";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { applyMenuCorrection, DEFAULT_DISCOUNT_CAP, draftVoices, extractMenu, suggestAllergens, suggestReward, type MenuImage } from "./ai";
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

// Menu photos are files in storage (<restaurant>/menu/...), not a list in the
// database: on WhatsApp several photos arrive at the same moment, and a list
// updated by each of them at once would lose some.
const menuFolder = (restaurantId: string) => `${restaurantId}/menu`;

export async function menuPhotos(restaurantId: string) {
  const storage = getSupabase().storage.from(PHOTO_BUCKET);
  const { data, error } = await storage.list(menuFolder(restaurantId), { limit: 50, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`Couldn't list the menu photos: ${error.message}`);
  return (data ?? []).filter((f) => f.id).map((f) => storage.getPublicUrl(`${menuFolder(restaurantId)}/${f.name}`).data.publicUrl);
}

// Saves menu photos (from the web form or WhatsApp) until the owner says that's all.
// Returns how many there are now.
export async function addMenuPhotos(restaurantId: string, photos: { bytes: Buffer; contentType: MenuImage["mediaType"] }[]) {
  const storage = getSupabase().storage.from(PHOTO_BUCKET);
  for (const p of photos) {
    const path = `${menuFolder(restaurantId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[p.contentType] ?? "jpg"}`;
    const { error } = await storage.upload(path, p.bytes, { contentType: p.contentType });
    if (error) throw new Error(`Couldn't save the menu photo: ${error.message}`);
  }
  return (await menuPhotos(restaurantId)).length;
}

// Starting the menu again: the photos so far are removed.
export async function clearMenuPhotos(restaurantId: string) {
  const storage = getSupabase().storage.from(PHOTO_BUCKET);
  const { data } = await storage.list(menuFolder(restaurantId), { limit: 100 });
  const paths = (data ?? []).filter((f) => f.id).map((f) => `${menuFolder(restaurantId)}/${f.name}`);
  if (paths.length) await storage.remove(paths);
  const o = (await getOnboarding(restaurantId))!;
  await patchData(restaurantId, { menu: { ...o.data.menu, draft: undefined } });
}

// Reads every saved menu photo and keeps the result as a draft for the owner to check.
export async function readMenuPhotos(restaurantId: string) {
  const o = (await getOnboarding(restaurantId))!;
  const urls = await menuPhotos(restaurantId);
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
  await saveOnboarding(restaurantId, { steps, data: { ...o.data, menu: { ...o.data.menu, draft: menu } } });
}

// A correction typed on WhatsApp ("Lamb Chops is £14", "remove the samosa") applied to the draft menu.
export async function correctMenuDraft(restaurantId: string, instruction: string) {
  const o = (await getOnboarding(restaurantId))!;
  const draft = await applyMenuCorrection(o.data.menu?.draft ?? [], instruction);
  await patchData(restaurantId, { menu: { ...o.data.menu, draft } });
  return draft;
}

// A correction to the suggested allergens ("Samosa: gluten, mustard"), still unconfirmed.
export async function correctAllergens(restaurantId: string, instruction: string) {
  const r = await getRestaurant(restaurantId);
  const menu = await applyMenuCorrection(r.menu ?? [], instruction, { allergens: true });
  await updateRestaurantFields(restaurantId, { menu });
  return menu;
}

// ---------- 3. Allergens ----------

// Suggestions are saved on the menu but marked unconfirmed, so they're never
// shown to customers or used in their messages until the owner confirms.
// Suggests once; after that (and after any corrections) it returns what's saved.
export async function suggestMenuAllergens(restaurantId: string) {
  const [r, o] = await Promise.all([getRestaurant(restaurantId), getOnboarding(restaurantId)]);
  if (!menuItemCount(r.menu) || o?.data.allergens?.suggested) return r.menu;
  const withSuggestions = await suggestAllergens(r.menu);
  await updateRestaurantFields(restaurantId, { menu: withSuggestions });
  await patchData(restaurantId, { allergens: { suggested: true } });
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

// The finished summary, as one WhatsApp message.
export function finishMessage(r: Restaurant, summary: string[], qrPack: string) {
  return [
    `🎉 *${r.name} is set up!*`,
    "",
    ...summary,
    "",
    `🖨️ Your QR codes to print (table cards and a counter sign): ${qrPack}`,
    "",
    "From now on, just message me like you would a person. You can change anything any time, e.g. _change Friday hours to 11pm_ or _add lamb chops, £14_. Send *HELP* for the commands.",
  ].join("\n");
}

// Sends the summary to the owner's WhatsApp (finishing on the web, or on WhatsApp).
export async function sendFinishSummary(r: Restaurant, summary: string[], qrPack: string, from: string) {
  if (!r.owner_whatsapp) return;
  const { messageOwner } = await import("@/lib/notify");
  await messageOwner({ restaurantId: r.id, from: r.whatsapp_from ?? from, to: r.owner_whatsapp }, finishMessage(r, summary, qrPack));
}

// TEST MODE only, demo restaurants only: back to a just-signed-up restaurant so
// onboarding can be tried again. Keeps the name, owner, email and WhatsApp link.
export async function resetOnboarding(restaurantId: string) {
  const r = await getRestaurant(restaurantId);
  if (!r.is_demo) throw new Error("Only demo restaurants can be reset");
  await clearMenuPhotos(restaurantId).catch(() => undefined);
  await updateRestaurantFields(restaurantId, {
    active: false,
    menu: [],
    brand_voice: null,
    signup_reward: null,
    discount_cap_percent: DEFAULT_DISCOUNT_CAP,
    address: null,
    phone: null,
    opening_hours: {},
    website: null,
    google_place_id: null,
    google_rating: null,
    google_rating_count: null,
    photos: [],
  });
  return saveOnboarding(restaurantId, { steps: {}, data: {}, wa_waiting: null, completed_at: null, started_at: new Date().toISOString() });
}
