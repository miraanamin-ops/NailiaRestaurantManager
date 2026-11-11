import "server-only";
import { randomUUID } from "node:crypto";
import { alertBuilder } from "@/lib/builder-alerts";
import { check, focusDraft, getDraft } from "@/lib/drafts";
import { buttonsFor } from "@/lib/google-jobs";
import { logAppMessage, messageOwner, type AppSink, type OwnerChannel } from "@/lib/notify";
import { OwnerToldError, SORRY } from "@/lib/sorry";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { APP_ADDRESS, APP_CHANNEL_TO, chatItems, checkUpload, fileLine, type ChatItem, type ChatMeta, type MessageRow } from "./chat-rules";
import type { InboxCard } from "./cards";
import { inboxCards } from "./inbox";

// The app's Chat tab (step 50, phase 3): the owner talks to DinerAI exactly as on
// WhatsApp. Each message runs through the WhatsApp bot's own handleMessage
// (lib/bot/index.ts) with an app sink on its channel (lib/notify.ts), so every
// command, "Thursday is quiet", edits, sales, the rota and photos work unchanged;
// the replies are logged in the messages table (to/from "app") and collected
// instead of sent. The answer is the conversation as it now stands.

const BUCKET = "app-uploads";
const HISTORY = 60;
const SIGNED_SECONDS = 3600;

export type ChatEntry = ChatItem & { card: InboxCard | null; imageUrl: string | null };
export type ChatState = { restaurantId: string; messages: ChatEntry[]; hasMore: boolean };

const ownerOf = (r: Restaurant) => r.owner_whatsapp ?? APP_ADDRESS;

async function rowsFor(r: Restaurant, before: string | null) {
  const owner = ownerOf(r);
  const query = (cols: string) => {
    let q = getSupabase()
      .from("messages")
      .select(cols)
      .eq("restaurant_id", r.id)
      // The owner's conversation only (never a staff number's), on WhatsApp or in the app.
      .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
      .order("created_at", { ascending: false })
      .limit(HISTORY + 1);
    if (before) q = q.lt("created_at", before);
    return q.returns<MessageRow[]>();
  };
  let res = await query("id, direction, body, created_at, from_number, to_number, app");
  // Before migration 066 there's no app column: the words only.
  if (res.error?.code === "42703") res = await query("id, direction, body, created_at, from_number, to_number");
  const rows = check(res) ?? [];
  return { rows: rows.slice(0, HISTORY).reverse(), hasMore: rows.length > HISTORY };
}

// A file the owner sent, as a short signed link (the bucket is private).
async function signedLinks(paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const { data } = await getSupabase().storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

export async function chatState(r: Restaurant, before: string | null = null): Promise<ChatState> {
  const { rows, hasMore } = await rowsFor(r, before);
  const draftIds = [...new Set(rows.map((m) => m.app?.draftId).filter((d): d is string => Boolean(d)))];
  const open = draftIds.length
    ? (check(await getSupabase().from("drafts").select("id").eq("restaurant_id", r.id).eq("status", "pending").in("id", draftIds).returns<{ id: string }[]>()) ?? []).map((d) => d.id)
    : [];
  const items = chatItems(rows, new Set(open));
  const cards = open.length ? new Map((await inboxCards(r.id)).map((c) => [c.id, c])) : new Map<string, InboxCard>();
  const links = await signedLinks(rows.filter((m) => m.app?.file?.contentType.startsWith("image/")).map((m) => m.app!.file!.path));
  return {
    restaurantId: r.id,
    hasMore,
    messages: items.map((m) => {
      const path = rows.find((row) => row.id === m.id)?.app?.file?.path;
      return { ...m, card: m.draftId ? (cards.get(m.draftId) ?? null) : null, imageUrl: m.image ?? (path ? (links.get(path) ?? null) : null) };
    }),
  };
}

type TurnInput = { body: string; logged?: string; payload?: string | null; clientId?: string | null; media?: { url: string; contentType: string } | null; file?: ChatMeta["file"] };

// One owner message from the app, start to finish. A clientId already answered
// (the app resent after losing its connection) is not answered twice.
export async function chatTurn(r: Restaurant, input: TurnInput): Promise<{ duplicate: boolean; replies: number }> {
  const owner = ownerOf(r);
  const clientId = input.clientId && /^[A-Za-z0-9-]{8,64}$/.test(input.clientId) ? input.clientId : randomUUID();
  try {
    await logAppMessage(r.id, {
      direction: "inbound",
      from_number: owner,
      to_number: APP_ADDRESS,
      body: (input.logged ?? input.body).slice(0, 1600),
      twilio_sid: `app-${clientId}`,
      status: "received",
      app: { clientId, ...(input.file ? { file: input.file } : {}) } satisfies ChatMeta,
    });
  } catch (err) {
    // 23505: this message id is already logged, so it was (or is being) answered.
    if ((err as { code?: string }).code === "23505") return { duplicate: true, replies: 0 };
    throw err;
  }
  const sink: AppSink = { owner, messages: [] };
  const { handleMessage } = await import("@/lib/bot");
  try {
    await handleMessage({
      restaurantId: r.id,
      owner,
      sandbox: r.whatsapp_from ?? APP_ADDRESS,
      body: input.body,
      buttonPayload: input.payload ?? undefined,
      media: input.media ?? null,
      app: sink,
    });
  } catch (err) {
    // handleMessage has already said sorry (OwnerToldError); anything else, we do.
    const cause = err instanceof OwnerToldError ? err.cause : err;
    console.error("App chat message failed", cause);
    if (!(err instanceof OwnerToldError)) await messageOwner(appChannel(r, sink), SORRY);
    await alertBuilder(`app-chat:${r.id}`, `App chat failed for ${r.name}: ${cause instanceof Error ? cause.message : String(cause)}`).catch(() => {});
  }
  return { duplicate: false, replies: sink.messages.length };
}

function appChannel(r: Restaurant, sink: AppSink): OwnerChannel {
  return { restaurantId: r.id, from: r.whatsapp_from ?? APP_ADDRESS, to: APP_CHANNEL_TO, app: sink };
}

export class UploadRefused extends Error {}

const cleanName = (name: string, photo: boolean) => name.replace(/[^\w .()-]/g, "").slice(0, 80) || (photo ? "photo.jpg" : "file");

// Step 1 of a photo or file sent in the app: a one-time link to put it straight into
// the private bucket (Vercel takes at most 4.5 MB through a function; files go to 16 MB).
export async function prepareUpload(r: Restaurant, file: { name: string; contentType: string | null; size: number }) {
  const ok = checkUpload(file.contentType, file.name, file.size);
  if (!ok.ok) throw new UploadRefused(ok.reason);
  const path = `${r.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ok.ext}`;
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new Error(`Couldn't make an upload link: ${error?.message ?? "no link"}`);
  return { path, uploadUrl: data.signedUrl, contentType: ok.contentType, name: cleanName(file.name, ok.photo) };
}

// Step 2: the message that carries it. Handled exactly like WhatsApp media (a till
// report, a sales or customer file, our spreadsheets, or a dish photo for a Google
// post), through a short signed link to the saved file.
export async function fileTurn(r: Restaurant, file: { path: string; name: string; contentType: string }, caption: string, clientId: string | null) {
  // Only this restaurant's own uploads, and only the kinds we read.
  if (!file.path.startsWith(`${r.id}/`) || file.path.includes("..")) throw new UploadRefused("That file isn't one of yours.");
  const ok = checkUpload(file.contentType, file.name || file.path, 1);
  if (!ok.ok) throw new UploadRefused(ok.reason);
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(file.path, 600);
  if (error || !data?.signedUrl) throw new UploadRefused("That file didn't arrive. Please send it again.");
  const name = cleanName(file.name, ok.photo);
  return chatTurn(r, {
    body: caption.trim().slice(0, 1000),
    logged: fileLine(ok.photo, name, caption),
    clientId,
    media: { url: data.signedUrl, contentType: ok.contentType },
    file: { path: file.path, name, contentType: ok.contentType },
  });
}

// "Answer in Chat" from the Inbox: the question is put on screen (so a typed answer
// goes to it) and shown in the chat with its buttons, as it would arrive on WhatsApp.
export async function focusQuestion(r: Restaurant, draftId: string) {
  const draft = await getDraft(draftId).catch(() => null);
  if (!draft || draft.restaurant_id !== r.id) return { ok: false as const, error: "not_found" };
  if (draft.status !== "pending") return { ok: false as const, error: "not_waiting" };
  await focusDraft(draft, "decision");
  const sink: AppSink = { owner: ownerOf(r), messages: [] };
  const buttons = draft.kind === "agent_question" ? false : draft.kind === "choice" ? { draftId: draft.id, buttons: "choice" as const, options: choiceLabels(draft) } : buttonsFor(draft);
  const answer = draft.kind === "agent_question" ? "\n\nType your answer below." : "";
  await messageOwner(appChannel(r, sink), `${draft.content}${answer}`, buttons);
  return { ok: true as const };
}

function choiceLabels(draft: { agent_input?: unknown }) {
  const options = (draft.agent_input as { options?: { label?: string }[] } | null)?.options ?? [];
  return options.map((o) => o.label ?? "").filter(Boolean).slice(0, 3);
}
