import "server-only";
import { randomUUID } from "node:crypto";
import { sendAndLog, type OwnerChannel } from "@/lib/notify";
import { appUrl, getSupabase } from "@/lib/supabase";
import { sendDinaChoices, sendText } from "@/lib/whatsapp";
import { STEP_DEFS, type FlowStepKey } from "../flow";
import { getSession, skipStep } from "../sessions";
import { chatSources } from "./chat";
import { dinaTurn, type SavedMessage, type TurnInput } from "./turn";
import { describeFiles, refusedText } from "./uploads";
import { isFilePart, saveWhatsAppFiles, type FilePart } from "./uploads-store";
import { cardFor, chatMessage, confirmText, skippableNow, type StoredMessage } from "./view";
import { choicesOf, readWhatsAppReply, renderForWhatsApp, type Asking, type WaOut } from "./whatsapp";

// Dina on WhatsApp: the same turn as the web chat (dinaTurn), the same saved
// conversation and progress, so an owner can switch channels at any step and
// carry on exactly there. The webhook queues each message; the worker calls
// handleDinaWhatsApp (one at a time per restaurant). Drawing and reading the
// messages is plain code in whatsapp.ts.

// Several photos sent together arrive as separate WhatsApp messages a moment
// apart: wait this long, and if another file came in meanwhile, let the last one
// answer for all of them (one reply, not one per photo).
const BURST_MS = Number(process.env.DINA_FILE_BURST_MS ?? 6000);
// Between Dina's messages, so WhatsApp shows them in order.
const GAP_MS = Number(process.env.DINA_MESSAGE_GAP_MS ?? 900);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// A restaurant setting up with Dina (not yet finished, not yet running). Today's
// running restaurants never get here, even if someone opened the chat page.
export async function dinaSetupInProgress(restaurantId: string) {
  const session = await getSession(restaurantId);
  if (!session || session.flow_version !== 2 || session.completed_at) return false;
  const { data, error } = await getSupabase().from("restaurants").select("active").eq("id", restaurantId).maybeSingle<{ active: boolean }>();
  if (error) throw new Error(error.message);
  return Boolean(data && !data.active);
}

export type DinaWhatsAppInput = {
  restaurantId: string;
  owner: string;
  sandbox: string;
  body: string;
  buttonPayload?: string | null;
  listId?: string | null;
  media: { url: string; contentType: string }[];
  messageSid?: string | null;
};

export async function handleDinaWhatsApp(input: DinaWhatsAppInput) {
  const channel: OwnerChannel = { restaurantId: input.restaurantId, from: input.sandbox, to: input.owner };
  const [sources, recent] = await Promise.all([chatSources(input.restaurantId), recentMessages(input.restaurantId)]);
  const step = sources.focus?.current_step ?? null;
  // Coming over from the web chat: Dina is told, so she picks up right where they were.
  const switched = recent[0]?.channel === "web" ? "The owner has just switched from the web chat to WhatsApp. Carry on exactly where you were, without starting the step again." : null;

  if (input.media.length) return files(channel, input, step, switched);

  const reply = readWhatsAppReply(input, askingNow(recent, sources), skippableNow(step));
  const externalId = input.messageSid ?? null;
  let turn: Omit<TurnInput, "restaurantId" | "channel">;
  if (reply.kind === "skip" && step) {
    await skipStep(input.restaurantId, step, { channel: "whatsapp" });
    turn = {
      event: "action",
      text: "Skip for now",
      externalId,
      note: `The owner chose "Skip for now" on ${STEP_DEFS[step].title}. Code has skipped it and kept it as a setup gap, so don't ask about it now.`,
    };
  } else if (reply.kind === "confirm") {
    turn = { event: "message", text: confirmText(cardFor("basics", sources), {}), externalId, ownerParts: [{ type: "answer", to: reply.messageId, choice: "confirm" }], note: switched };
  } else if (reply.kind === "answer") {
    turn = { event: "message", text: reply.label, externalId, ownerParts: [{ type: "answer", to: reply.messageId, choice: reply.choiceId }], note: switched };
  } else {
    turn = { event: "message", text: reply.kind === "text" ? reply.text : input.body, externalId, note: switched };
  }
  const result = await dinaTurn({ ...turn, restaurantId: input.restaurantId, channel: "whatsapp" });
  if (!result.duplicate) await sendTurn(channel, result.messages);
}

// Straight after the owner's number is linked (by its first message, or by the
// one-time code): Dina says hello, or welcome back at the step they're on.
export async function greetOnWhatsApp(restaurantId: string, owner: string, sandbox: string) {
  const { count } = await getSupabase().from("onboarding_messages").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
  const result = await dinaTurn({
    restaurantId,
    channel: "whatsapp",
    event: count ? "resume" : "start",
    note: "Their WhatsApp was linked to the restaurant just now, by the message they sent. Say so in a few words before carrying on.",
  });
  if (!result.duplicate) await sendTurn({ restaurantId, from: sandbox, to: owner }, result.messages);
}

// ---------- Files ----------

async function files(channel: OwnerChannel, input: DinaWhatsAppInput, step: FlowStepKey | null, switched: string | null) {
  const messageId = input.messageSid ?? randomUUID();
  const { saved, refused } = await saveWhatsAppFiles({ restaurantId: input.restaurantId, step, messageId, media: input.media });
  const parts: FilePart[] = saved.map(({ type, path, kind, contentType, bytes }) => ({ type, path, kind, contentType, bytes }));
  const label = saved.length ? `📎 ${describeFiles(saved)}` : "📎 a file I couldn't use";
  const text = input.body.trim() ? `${input.body.trim()}\n${label}` : label;
  const refusal = refusedText(refused);

  // Nothing usable: say why, and no turn for Dina.
  if (!saved.length) {
    if (!(await saveOwnerMessage(input.restaurantId, step, text, [], input.messageSid))) return;
    if (refusal) await say(channel, step, refusal);
    return;
  }

  // Part of a burst: keep the files, let the last message of the burst answer.
  if (!input.body.trim()) {
    await sleep(BURST_MS);
    if (await moreFilesSince(input.restaurantId, input.owner, input.messageSid)) {
      if (!(await saveOwnerMessage(input.restaurantId, step, text, parts, input.messageSid))) return;
      if (refusal) await say(channel, step, refusal);
      return;
    }
  }

  if (refusal) await say(channel, step, refusal);
  const all = [...(await filesSinceDina(input.restaurantId)), ...saved];
  const stepName = step ? STEP_DEFS[step].title.toLowerCase() : "setup";
  const note = [
    `The owner has just sent ${describeFiles(all)} on WhatsApp, saved safely for ${stepName}.`,
    "Reading files comes in a later version: say in a few words that you've got them, then carry on with the step you're on.",
    refusal ? "Some other files couldn't be used, and code has already told them why: don't repeat it." : "",
    switched ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const result = await dinaTurn({ restaurantId: input.restaurantId, channel: "whatsapp", event: "message", text, externalId: input.messageSid ?? null, ownerParts: parts, note });
  if (!result.duplicate) await sendTurn(channel, result.messages);
}

// The owner's message, kept without a turn (part of a burst, or nothing usable).
// False if it was already saved (a repeated delivery).
async function saveOwnerMessage(restaurantId: string, step: FlowStepKey | null, body: string, parts: unknown[], externalId?: string | null) {
  const { error } = await getSupabase()
    .from("onboarding_messages")
    .insert({ id: randomUUID(), restaurant_id: restaurantId, role: "owner", channel: "whatsapp", step_key: step, body, parts, external_id: externalId ?? null });
  if (error?.code === "23505") return false;
  if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  return true;
}

// A fixed line from code (e.g. why a file was refused), sent and kept in the conversation.
async function say(channel: OwnerChannel, step: FlowStepKey | null, text: string) {
  const { error } = await getSupabase()
    .from("onboarding_messages")
    .insert({ id: randomUUID(), restaurant_id: channel.restaurantId, role: "dina", channel: "whatsapp", step_key: step, body: text, parts: [] });
  if (error) console.error("Couldn't save a setup message", error.message);
  await sendAndLog(channel, () => sendText(channel.from, channel.to, text), text);
}

// Did another file from this number arrive after this message? (The webhook logs
// every message before queuing it, so a later photo is already there.)
async function moreFilesSince(restaurantId: string, owner: string, messageSid?: string | null) {
  if (!messageSid) return false;
  const supabase = getSupabase();
  const { data: self } = await supabase.from("messages").select("created_at").eq("restaurant_id", restaurantId).eq("twilio_sid", messageSid).maybeSingle<{ created_at: string }>();
  if (!self) return false;
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("direction", "inbound")
    .eq("from_number", owner)
    .like("body", "[📷 photo]%")
    .gt("created_at", self.created_at);
  return (count ?? 0) > 0;
}

// Files the owner sent since Dina last spoke (the earlier messages of a burst).
async function filesSinceDina(restaurantId: string) {
  const rows = await recentMessages(restaurantId, 30);
  const out: FilePart[] = [];
  for (const r of rows) {
    if (r.role === "dina") break;
    if (r.role === "owner") out.push(...(r.parts ?? []).filter(isFilePart));
  }
  return out;
}

// ---------- The conversation ----------

type Row = StoredMessage & { channel: "web" | "whatsapp" | null };

async function recentMessages(restaurantId: string, limit = 10) {
  const { data, error } = await getSupabase()
    .from("onboarding_messages")
    .select("id, role, body, parts, channel")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

// The question a typed number or word answers: Dina's last message with choices,
// if the owner hasn't written since.
function askingNow(recent: Row[], sources: Awaited<ReturnType<typeof chatSources>>): Asking | null {
  for (const r of recent) {
    if (r.role === "owner") return null;
    if (r.role !== "dina") continue;
    const message = chatMessage(r, sources);
    if (choicesOf(message.component).length) return { messageId: r.id, component: message.component };
  }
  return null;
}

// Dina's messages from a turn, drawn for WhatsApp and sent in order.
async function sendTurn(channel: OwnerChannel, messages: SavedMessage[]) {
  const sources = await chatSources(channel.restaurantId);
  const shown = messages.map((m) => chatMessage({ id: m.id, role: "dina", body: m.text, parts: m.component ? [m.component] : [] }, sources));
  const outs = renderForWhatsApp(shown, {
    skippable: skippableNow(sources.focus?.current_step ?? null),
    chatUrl: `${appUrl()}/onboarding/chat?r=${channel.restaurantId}`,
  });
  for (const [i, out] of outs.entries()) {
    if (i) await sleep(GAP_MS);
    await sendOut(channel, out);
  }
}

function sendOut(channel: OwnerChannel, out: WaOut) {
  return sendAndLog(channel, () => (out.kind === "text" ? sendText(channel.from, channel.to, out.body) : sendDinaChoices(channel.from, channel.to, out)), out.body);
}
