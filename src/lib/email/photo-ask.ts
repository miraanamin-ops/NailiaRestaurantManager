import "server-only";
import { logAction } from "@/lib/audit";
import { getCampaignForDraft } from "@/lib/campaigns";
import { check, createDraft, getDraft, type Draft } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { designOf, offerDish, type EmailDesign } from "./designs";
import { checkDishPhoto, PHOTO_FIX } from "./photo-check";
import { askText, photoDeadline, wantsPhoto, type PhotoAsk } from "./photo-ask-rules";

// The photo "part 2" (rules in ./photo-ask-rules.ts). The email's send time is moved
// to the deadline while it waits (campaigns.send_at, so the gate holds it and the
// hourly release sends it, as for any scheduled campaign); a photo or "Send without"
// puts the send time back and releases it at once.

type Design = EmailDesign & { photo_ask?: PhotoAsk | null };

// What a file really is, from its first bytes (never the name or the label).
export function imageTypeOf(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function saveDesign(restaurantId: string, campaignId: string, design: Design, sendAt?: string | null) {
  check(
    await getSupabase()
      .from("campaigns")
      .update({ email_design: design, ...(sendAt !== undefined ? { send_at: sendAt } : {}) })
      .eq("id", campaignId)
      .eq("restaurant_id", restaurantId),
  );
}

// Called as the owner approves an offer email in the app, before the approval runs.
// Returns the dish asked about, or null when no photo is wanted (the email goes as usual).
export async function startPhotoAsk(restaurant: Restaurant, draft: Draft, now: Date): Promise<string | null> {
  if (draft.kind !== "email_campaign") return null;
  const campaign = await getCampaignForDraft(draft.id);
  if (!campaign || campaign.sent_at || !campaign.email_design) return null; // no 071 yet: nothing to save it on
  const design = designOf(campaign) as Design;
  if (design.photo_ask) return null; // asked once already
  const dish = offerDish(campaign, restaurant.menu)?.name ?? null;
  if (!wantsPhoto(design, dish)) return null;
  const until = photoDeadline(now, campaign.send_at ?? null);
  const request = await createDraft({
    restaurantId: restaurant.id,
    kind: "photo_request",
    content: askText(dish!, until, now),
    audience: dish!,
    request: `Photo for "${campaign.name}"`,
    checks: {},
    mode: "hold",
    actor: "system",
    agentInput: { campaign_id: campaign.id, campaign_draft_id: draft.id, dish },
  });
  const ask: PhotoAsk = { request_draft_id: request.id, dish: dish!, until: until.toISOString(), original_send_at: campaign.send_at ?? null, answered: null };
  await saveDesign(restaurant.id, campaign.id, { ...design, photo_ask: ask }, until.toISOString());
  return dish;
}

async function requestFor(restaurant: Restaurant, requestDraftId: string) {
  const req = await getDraft(requestDraftId).catch(() => null);
  if (!req || req.restaurant_id !== restaurant.id || req.kind !== "photo_request" || req.status !== "pending") return null;
  const campaignId = String((req.agent_input as { campaign_id?: unknown } | null)?.campaign_id ?? "");
  const campaign = campaignId
    ? check(await getSupabase().from("campaigns").select("*").eq("id", campaignId).eq("restaurant_id", restaurant.id).maybeSingle<import("@/lib/campaigns").Campaign>())
    : null;
  if (!campaign) return null;
  return { req, campaign, design: designOf(campaign) as Design };
}

// The email goes at its own time again (now, if it had none), and is released if due.
async function release(restaurant: Restaurant, campaignId: string, design: Design, now: Date) {
  const ask = design.photo_ask!;
  const sendAt = ask.original_send_at && new Date(ask.original_send_at) > now ? ask.original_send_at : null;
  await saveDesign(restaurant.id, campaignId, design, sendAt);
  // The gate held the approved email until the deadline (drafts.scheduled_for): move that too,
  // or the release would still wait for it.
  const campaign = check(await getSupabase().from("campaigns").select("draft_id").eq("id", campaignId).eq("restaurant_id", restaurant.id).maybeSingle<{ draft_id: string }>());
  if (campaign) check(await getSupabase().from("drafts").update({ scheduled_for: sendAt }).eq("id", campaign.draft_id).eq("restaurant_id", restaurant.id).eq("status", "queued"));
  if (!sendAt) {
    const { processQueue } = await import("@/lib/send");
    await processQueue(restaurant, now);
  }
  return sendAt ? new Date(sendAt) : null;
}

async function closeRequest(req: Draft) {
  check(await getSupabase().from("drafts").update({ status: "answered", waiting_for: null }).eq("id", req.id).eq("restaurant_id", req.restaurant_id));
}

export type PhotoAnswer = { ok: true; sendAt: Date | null } | { ok: false; reason: string };

// A photo from the app (already in the private app-uploads bucket at `path`): checked,
// saved in the photo library under the dish's name, put in the email, which then goes.
export async function answerWithPhoto(restaurant: Restaurant, requestDraftId: string, path: string, now: Date): Promise<PhotoAnswer> {
  const found = await requestFor(restaurant, requestDraftId);
  if (!found) return { ok: false, reason: "That photo request has already been dealt with." };
  if (!path.startsWith(`${restaurant.id}/`) || path.includes("..")) return { ok: false, reason: "That photo isn't one of yours." };
  const file = await getSupabase().storage.from("app-uploads").download(path);
  if (file.error || !file.data) return { ok: false, reason: "That photo didn't arrive. Please try again." };
  const bytes = Buffer.from(await file.data.arrayBuffer());
  const mediaType = imageTypeOf(bytes);
  if (!mediaType) return { ok: false, reason: "That needs to be a photo (JPEG or PNG)." };
  const { design, campaign, req } = found;
  const dish = design.photo_ask?.dish ?? "dish";
  const problem = await checkDishPhoto({ base64: bytes.toString("base64"), mediaType }, dish, restaurant.id).catch(() => "ok" as const);
  if (problem !== "ok") return { ok: false, reason: PHOTO_FIX[problem] };

  const { savePostPhoto } = await import("@/lib/photos");
  const url = await savePostPhoto(restaurant.id, bytes, mediaType);
  const { addToPhotoLibrary } = await import("@/lib/agents/visibility");
  await addToPhotoLibrary(restaurant, url, "owner", dish);
  const next: Design = { ...design, photo_url: url, photo_ask: { ...design.photo_ask!, answered: "photo" } };
  await closeRequest(req);
  const sendAt = await release(restaurant, campaign.id, next, now);
  await logAction({ restaurantId: restaurant.id, actor: "owner", action: "setting", detail: `Added a photo of the ${dish.toLowerCase()} to "${campaign.name}"` });
  return { ok: true, sendAt };
}

// "Send without": the email goes as it is.
export async function answerWithoutPhoto(restaurant: Restaurant, requestDraftId: string, now: Date): Promise<PhotoAnswer> {
  const found = await requestFor(restaurant, requestDraftId);
  if (!found) return { ok: false, reason: "That photo request has already been dealt with." };
  await closeRequest(found.req);
  const sendAt = await release(restaurant, found.campaign.id, { ...found.design, photo_ask: { ...found.design.photo_ask!, answered: "without" } }, now);
  return { ok: true, sendAt };
}

// When the email goes anyway (its deadline passed), the photo card leaves the Inbox.
export async function closePhotoAskFor(campaign: { id: string; restaurant_id: string; email_design?: EmailDesign | null }) {
  const ask = (campaign.email_design as Design | null | undefined)?.photo_ask;
  if (!ask || ask.answered) return;
  check(
    await getSupabase()
      .from("drafts")
      .update({ status: "withdrawn", waiting_for: null })
      .eq("id", ask.request_draft_id)
      .eq("restaurant_id", campaign.restaurant_id)
      .eq("status", "pending"),
  );
}
