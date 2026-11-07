import "server-only";
import { addToPhotoLibrary } from "@/lib/agents/visibility";
import { isSupportedImage, LOGO_MAX_BYTES, saveLogo, savePostPhoto } from "@/lib/photos";
import { saveAndConfirmFields } from "@/lib/profile-edits";
import { stepState } from "../flow";
import { noteStep, loadFlow, patchStepData, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { brandFromHtml, isPublicWebAddress, readWebsitePage } from "../website";
import { colourFrom, detailFields, SUGGESTED_PHOTOS, type BrandDraft, type DetailNote } from "./details-content";
import { coloursIn, paletteChoices, stylesheetsIn, type Palette } from "../guide/palette";
import { readSavedFile, type FilePart } from "./uploads-store";

// Saving the details every agent needs (details-content.ts has the rules):
//   - her details notes (sign-off, emoji, allergen statement, offer types): saved
//     whichever step she hears them on, each as a confirmed profile field
//   - "Your look" on the customers and QR codes step: the logo and main colour,
//     picked up from their website first (nothing saved until "Looks right"), or
//     a logo they send; after that, photos they send go into the photo library.

export async function applyDetailNotes(restaurantId: string, notes: Partial<Record<DetailNote, string>>) {
  const { fields, problems } = detailFields(notes);
  if (problems.length) console.warn("Some setup details weren't usable", problems);
  if (!Object.keys(fields).length) return problems;
  const r = await getRestaurant(restaurantId);
  await saveAndConfirmFields(r, fields, "Confirmed with Dina at setup");
  return problems;
}

// ---------- Your look (its own step since 7 Nov 2026) ----------

type LookData = { brand_draft?: BrandDraft; brand_checked?: boolean; brand_confirmed?: boolean; photos_added?: number; palettes?: Palette[] };
export const lookData = async (restaurantId: string) => stepState((await loadFlow(restaurantId)).state, "look").data as LookData;

// A linked stylesheet, read for its colours (public addresses only, 8 seconds, 300 KB).
async function readStylesheet(href: string) {
  try {
    const u = new URL(href);
    if (!isPublicWebAddress(u)) return "";
    const res = await fetch(u, { headers: { "User-Agent": "NailaBot/1.0 (restaurant onboarding)" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    return new TextDecoder().decode((await res.arrayBuffer()).slice(0, 300_000));
  } catch {
    return "";
  }
}

// Once, when the step starts: the logo and colours from their website, as a
// draft (owner's call, 7 Nov: their website first). The logo is copied to our
// storage so the card (and WhatsApp) can show it. Nothing is saved until they confirm.
export async function prepareBrand(restaurantId: string) {
  const data = await lookData(restaurantId);
  if (data.brand_checked) return;
  const r = await getRestaurant(restaurantId);
  const draft: BrandDraft = {};
  let colours: string[] = [];
  try {
    const page = await readWebsitePage(r.website);
    if (page.html && page.url) {
      const found = brandFromHtml(page.html, page.url);
      const sheets = await Promise.all(stylesheetsIn(page.html, page.url).map(readStylesheet));
      colours = coloursIn([page.html, ...sheets], found.color);
      if (found.logo && !r.logo_url && isPublicWebAddress(new URL(found.logo))) {
        const res = await fetch(found.logo, { signal: AbortSignal.timeout(8000) });
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        const bytes = Buffer.from(await res.arrayBuffer());
        if (res.ok && isSupportedImage(type) && bytes.length <= LOGO_MAX_BYTES) draft.logo_url = await saveLogo(restaurantId, bytes, type);
      }
      if (draft.logo_url) draft.from_website = true;
    }
  } catch (err) {
    console.warn("Couldn't pick up the logo or colours from the website", err instanceof Error ? err.message : err);
  }
  await patchOrNoteLook(restaurantId, { brand_draft: draft, brand_checked: true, palettes: paletteChoices(colours) });
}

// The look step's data, whether or not the step has a row yet.
async function patchOrNoteLook(restaurantId: string, data: Record<string, unknown>) {
  const { state } = await loadFlow(restaurantId);
  if (stepState(state, "look").status === "not_started") await noteStep(restaurantId, "look", data);
  else await patchStepData(restaurantId, "look", data);
}

// Her brand notes: a colour they named (as a colour code), onto the card's draft.
export async function applyBrandNotes(restaurantId: string, notes: { colour?: string }) {
  const colour = notes.colour ? colourFrom(notes.colour) : null;
  if (!colour) return false;
  const data = await lookData(restaurantId);
  await patchStepData(restaurantId, "look", { brand_draft: { ...(data.brand_draft ?? {}), brand_color: colour } });
  return true;
}

// "Looks right" on the "Your look" card. Returns what Dina is told.
export async function confirmBrand(restaurantId: string, channel: Channel) {
  const data = await lookData(restaurantId);
  const r = await getRestaurant(restaurantId);
  const logo = data.brand_draft?.logo_url ?? r.logo_url ?? null;
  const colour = data.brand_draft?.brand_color ?? r.brand_color ?? null;
  if (!logo)
    return "There's no logo yet. Ask them to send their logo as a photo or image file (upload, photo); if they don't have one to hand, that's fine: it can be added later in settings, so carry on.";
  await saveAndConfirmFields(r, { logo_url: logo, ...(colour ? { brand_color: colour } : {}), brand_dark: r.brand_dark ?? "#1c1917" }, "Logo and colours, with Dina at setup");
  await noteStep(restaurantId, "look", { brand_confirmed: true }, { channel });
  const photos = (r.photo_library ?? []).length;
  return photos >= SUGGESTED_PHOTOS
    ? "Code saved their logo and colours. Now offer their QR codes."
    : `Code saved their logo and colours. Next, suggest they send ${SUGGESTED_PHOTOS} photos of their dishes for their Google posts (upload, photo, multiple); say it's optional. Then offer their QR codes.`;
}

// Photos sent on this step: the logo while "Your look" isn't confirmed, dish photos after.
// purpose: which question they answer (code knows from the open question); else
// the logo until "Your look" is confirmed, then dish photos.
export async function lookFiles(restaurantId: string, files: FilePart[], purpose?: "logo" | "photos") {
  const photos = files.filter((f) => f.kind === "photo");
  if (!photos.length) return "Only photos are used on this step (a logo, or photos of their dishes). Ask for a photo, then carry on.";
  const data = await lookData(restaurantId);
  if (purpose ? purpose === "logo" : !data.brand_confirmed) {
    const first = photos[0];
    const bytes = await readSavedFile(restaurantId, first.path);
    const type = isSupportedImage(first.contentType) ? first.contentType : "image/jpeg";
    if (bytes.length > LOGO_MAX_BYTES) return "That logo is over 2 MB. Ask for a smaller copy (a screenshot works).";
    const url = await saveLogo(restaurantId, bytes, type);
    await patchStepData(restaurantId, "look", { brand_draft: { ...(data.brand_draft ?? {}), logo_url: url, from_website: false } });
    return "Code kept that as their logo. Show editable_card brand so they can check it with their colour.";
  }
  let r = await getRestaurant(restaurantId);
  let added = 0;
  for (const f of photos) {
    const bytes = await readSavedFile(restaurantId, f.path);
    const url = await savePostPhoto(restaurantId, bytes, isSupportedImage(f.contentType) ? f.contentType : "image/jpeg");
    const library = await addToPhotoLibrary(r, url, "owner", null);
    r = { ...r, photo_library: library };
    added++;
  }
  const total = (r.photo_library ?? []).length;
  await patchStepData(restaurantId, "look", { photos_added: (data.photos_added ?? 0) + added });
  const more = total < SUGGESTED_PHOTOS ? ` They can send ${SUGGESTED_PHOTOS - total} more now or any time later.` : "";
  return `Code saved ${added} photo${added === 1 ? "" : "s"} to their library (${total} in all).${more} Then offer their QR codes.`;
}
