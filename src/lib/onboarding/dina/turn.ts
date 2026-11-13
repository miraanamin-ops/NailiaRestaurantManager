import "server-only";
import { withAiContext } from "@/lib/ai-context";
import { randomUUID } from "node:crypto";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { availableSteps, currentStep, STEP_DEFS, statusOf, stepState, type FlowStepKey } from "../flow";
import { enterStep, getSession, loadFlow, startOnboarding, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { callDina, DinaReplyError, routeStep, type Call, type ToolCall } from "./call";
import { mightBeAnotherStep, turnText, type DataBlock, type HistoryLine, type TurnEvent } from "./prompt";
import { dinaReplyProblems, fallbackReply, type DinaReply } from "./reply";
import { applyFaqNotes, applyHoursNotes } from "./facts-step";
import { finishIfDone, reviewLine } from "./finish";
import { applyGoogleNotes } from "./google-step";
import { nextDishForCard } from "./menu-step";
import { helloPlacesData } from "./hello-step";
import { googleConnectOn } from "./setup-config";
import { prepareToneOptions } from "./tone-step";
import { DEFAULT_ALLERGEN_STATEMENT, OFFER_TYPE_HINT, SUGGESTED_PHOTOS, type BrandDraft } from "./details-content";
import { applyBrandNotes, applyDetailNotes } from "./details-step";
import { DEFAULT_DISCOUNT_CAP, LABOUR_HINT, POS_TIPS, SALES_DETAIL_HINT } from "./ops-content";
import { OFFERED_TOOLS, runTool, TOOLS } from "./tools";
import { factsFor } from "../sessions";
import { nextAction, type NextAction } from "../guide/questions";
import { alreadyAsking, codeAsksNext, guideNext } from "../guide/next";
import type { FilePart } from "./uploads-store";

// One turn of the setup conversation, whichever channel it came from (the web
// chat and WhatsApp call this, and only draw the result differently):
//   1. the owner's message is saved once (a repeated delivery is noticed and dropped)
//   2. Haiku decides if it's about another step ("go back to the menu"); if so we go there
//   3. Dina answers (Sonnet), saving only through her checked tools
//   4. her reply passes the coded checks, or the owner gets code's fallback line
//   5. her messages and every Claude call's cost are saved

export type TurnInput = {
  restaurantId: string;
  channel: Channel;
  event: TurnEvent;
  text?: string | null;
  // The channel's id for the message (e.g. Twilio's), so a repeat is saved once and answered once.
  externalId?: string | null;
  // Outside content for this turn (a menu read from photos, reviews...): data, never instructions.
  data?: DataBlock[];
  // For "action": what code already did (e.g. skipped a step), told to Dina.
  note?: string | null;
  // Saved with the owner's message: e.g. which button under which message it answered.
  ownerParts?: unknown[];
  // A short line while a tool runs ("Saving your basics…"), for the web chat to stream.
  onStatus?: (text: string) => void;
  // Set on the follow-up turn code starts itself (guide), so it never starts another.
  followUp?: boolean;
};

export type SavedMessage = { id: string; text: string; component: DinaReply["messages"][number]["component"] };

export type TurnResult =
  | { duplicate: true }
  | { duplicate: false; reply: DinaReply; messages: SavedMessage[]; step: FlowStepKey | null; costUsd: number; fallback: boolean; toolCalls: ToolCall[] };

// What Dina may be told about the restaurant: its own details only. Never the
// customer list, and (from the menu step on) only allergens the owner confirmed.
// (opening_hours too: the full run of 31 Oct showed an empty hours card because she couldn't tell there were none.)
// Steps 7 to 12 add the settings they change (what is set now, so she proposes it rather than asks).
const KNOWN_FIELDS = ["owner_name", "name", "address", "cuisine", "phone", "website", "google_rating", "google_rating_count", "opening_hours"] as const;
// (4 Nov: the details every agent needs: sign-off and emoji on the tone step, the
// allergen statement on the menu step, offer types on rewards, the logo and
// colour on customers and QR codes.)
const STEP_FIELDS: Partial<Record<FlowStepKey, readonly string[]>> = {
  tone: ["sign_off_name"],
  menu: ["allergen_statement"],
  team: ["labour_target_pct"],
  rewards: ["signup_reward", "discount_cap_percent", "recovery_offers", "approved_offer_types", "min_margin_pct"],
  customers_qr: ["logo_url", "brand_color"],
  approvals_timing: ["brief_hour", "send_window_start", "send_window_end"],
};

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

// The menu's dishes for the costs question: name, price, and whether it has a cost yet.
export function menuDishesLine(menu: { category: string; items: { name: string; price: number; cost?: number | null }[] }[] | null | undefined) {
  const items = (menu ?? []).flatMap((c) => c.items);
  if (!items.length) return null;
  const shown = items.slice(0, 60).map((i) => `${i.name} £${Number(i.price).toFixed(2)}${typeof i.cost === "number" ? ` (cost £${i.cost.toFixed(2)})` : ""}`);
  return `${shown.join("; ")}${items.length > 60 ? `; and ${items.length - 60} more` : ""}`;
}

// What she's told about "Your look" on the customers and QR codes step.
export function lookLine(data: Record<string, unknown>, photos: number) {
  const draft = (data.brand_draft ?? {}) as BrandDraft;
  const library = `${photos} dish photo${photos === 1 ? "" : "s"} in their library (${SUGGESTED_PHOTOS} suggested)`;
  if (data.brand_confirmed) return `logo and colours confirmed; ${library}`;
  const found = draft.logo_url ? (draft.from_website ? "a logo from their website" : "the logo they sent") : null;
  return `${found ? `${found} is ready: show editable_card brand` : "no logo found yet: ask them to send it as a photo"}; ${library}`;
}

// Team: the staff sheet the owner sent earlier in this step (whatsapp-turn.ts
// noteForFiles keeps it on the step), in front of her every turn until the team is
// saved. She asks one question at a time before save_team; the first real run lost
// the sheet after the upload turn and asked for it again and again.
async function staffSheetData(restaurantId: string, state: Awaited<ReturnType<typeof loadFlow>>["state"]) {
  const team = stepState(state, "team");
  const files = team.data.staff_files as FilePart[] | undefined;
  if (!files?.length || team.status === "done") return null;
  const { staffFileAsData } = await import("./ops-step");
  return (await staffFileAsData(restaurantId, files).catch(() => null)) as DataBlock | null;
}
// Code's note says it saved something this turn (so "that's saved" can be true without her tool).
const CODE_SAVED = /Code (saved|sent|made|kept|has (emailed|skipped)|read the menu|queued)|acceptance is simulated/;

// Every Claude call in a turn is counted against this restaurant (ai_usage).
export function dinaTurn(input: TurnInput): Promise<TurnResult> {
  return withAiContext({ restaurantId: input.restaurantId }, () => runTurn(input));
}

async function runTurn(input: TurnInput): Promise<TurnResult> {
  const supabase = getSupabase();
  const id = input.restaurantId;
  const session = (await getSession(id)) ?? (await startOnboarding(id, { channel: input.channel }));

  // 1. The owner's message, once.
  let ownerMessageId: string | null = null;
  if (input.event === "message" || (input.event === "action" && input.text)) {
    ownerMessageId = randomUUID();
    const { error } = await supabase.from("onboarding_messages").insert({
      id: ownerMessageId,
      restaurant_id: id,
      role: "owner",
      channel: input.channel,
      step_key: session.current_step,
      body: input.text ?? "",
      parts: input.ownerParts ?? [],
      external_id: input.externalId ?? null,
      // The app's clock, like Dina's messages after it, so the order always holds.
      created_at: new Date().toISOString(),
    });
    if (error?.code === "23505") return { duplicate: true };
    if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  }

  const calls: Call[] = [];
  let { state } = await loadFlow(id);
  let step: FlowStepKey | null = session.current_step ?? currentStep(state);
  let moved = false;

  // 2. Is it about another step? (Only for real sentences that mention another step's
  // subject or going back: a tap, a "yes" or a plain answer isn't.)
  if (input.event === "message" && !input.ownerParts?.length && input.text && words(input.text) >= 3 && mightBeAnotherStep(input.text)) {
    try {
      const routed = await routeStep(input.text, step);
      calls.push(routed.call);
      if (routed.step && STEP_DEFS[routed.step].available) {
        await enterStep(id, routed.step, { channel: input.channel });
        step = routed.step;
        moved = true;
      }
    } catch (err) {
      console.warn("The setup router failed; staying on the current step", err instanceof Error ? err.message : err);
    }
  }
  if (step && statusOf(state, step) === "not_started") {
    await enterStep(id, step, { channel: input.channel });
    moved = true;
  }

  // 3. Dina, with what we know, where we are and the recent chat (read side by side:
  // every database round trip is time the owner waits).
  const [restaurant, history, stateNow] = await Promise.all([
    getRestaurant(id),
    recentChat(id, ownerMessageId),
    moved ? loadFlow(id).then((f) => f.state) : Promise.resolve(state),
  ]);
  state = stateNow;
  // Hello: Google Maps matches for the name, so she can ask "Is this you?" (when we can search).
  const places = step === "hello" ? await helloPlacesData(restaurant, state) : null;
  // (On the turn it arrives the sheet is already in input.data.)
  const sheet = step === "team" && !input.data?.length ? await staffSheetData(id, state) : null;
  // ...and the people their past rotas show (names, roles, usual days; never pay), once the reading is checked.
  const rotaPeople = step === "team" && stepState(state, "team").status !== "done" ? await import("@/lib/rota/import").then((m) => m.rotaPeopleData(id)).catch(() => null) : null;
  // What setup asks next (code decides: guide/questions.ts). If it's one of code's
  // own cards, she only answers the owner in a line: code asks right after her.
  const before = nextAction(await factsFor(id, state));
  const asked = availableSteps();
  const near: FlowStepKey[] = step ? [step, ...(asked.includes(step) ? asked.slice(asked.indexOf(step) + 1, asked.indexOf(step) + 2) : [])] : [];
  const known = {
    // (An empty value, like hours of {}, counts as not known.)
    ...Object.fromEntries(
      KNOWN_FIELDS.map((k) => {
        const v = restaurant[k as keyof typeof restaurant] ?? null;
        return [k, v && typeof v === "object" && !Object.keys(v).length ? null : v];
      }),
    ),
    // Path A: the owner can connect Google directly (google_connect); the manager steps stay as the alternative.
    ...(googleConnectOn() ? { google_connect: "available: offer google_connect first in the Google step, with the Manager route as the alternative" } : {}),
    // This step's settings and the next one's: she often moves on in the same reply,
    // and must never guess what's set (the full run of 1 Nov proposed a 20% cap that was 15%).
    ...Object.fromEntries(near.flatMap((k) => STEP_FIELDS[k] ?? []).map((k) => [k, restaurant[k as keyof typeof restaurant] ?? null])),
    // The cap always has a value (the database default), so she never guesses one.
    ...(near.includes("rewards") ? { discount_cap_percent: restaurant.discount_cap_percent ?? DEFAULT_DISCOUNT_CAP } : {}),
    ...(near.includes("sales") ? { pos_tips: POS_TIPS, sales_detail: SALES_DETAIL_HINT } : {}),
    ...(near.includes("team") ? { labour_hint: LABOUR_HINT } : {}),
    ...(near.includes("menu") ? { allergen_wording: DEFAULT_ALLERGEN_STATEMENT, menu_dishes: menuDishesLine(restaurant.menu) } : {}),
    ...(near.includes("rewards") ? { offer_types: OFFER_TYPE_HINT } : {}),
  };
  const content = turnText({
    restaurant: known,
    state,
    step,
    channel: input.channel,
    event: input.event,
    history,
    ownerText: input.text ?? null,
    data: [...(input.data ?? []), ...(places ? [places] : []), ...(sheet ? [sheet] : []), ...(rotaPeople ? [rotaPeople as DataBlock] : [])],
    note: input.note,
    guide: guideLine(before),
  });

  // Step 3's choices, prepared alongside her answer (the first time only: the cards need them, she doesn't).
  const preparing = step === "tone" ? prepareToneOptions(id).catch((err) => console.error("Couldn't prepare the tone choices", err)) : null;

  let reply: DinaReply;
  let fallback = false;
  let toolCalls: ToolCall[] = [];
  try {
    const answer = await callDina({
      content,
      step,
      ctx: { restaurantId: id, channel: input.channel, onStatus: input.onStatus },
      tools: OFFERED_TOOLS,
      codeActed: CODE_SAVED.test(input.note ?? ""),
      // Code asks next (before her turn, or once her tool finished a step): she mustn't ask too.
      codeAsksNext: async () => codeAsksNext(nextAction(await factsFor(id, (await loadFlow(id)).state))),
    });
    reply = answer.reply;
    calls.push(...answer.calls);
    toolCalls = answer.toolCalls;
    // Notes only count on the step they're for, while it's the step this turn is on:
    // a note repeated after that step is finished would otherwise put the owner back
    // on it (the first real run of steps 2 and 3 did, 31 Oct).
    // The basics she noted with her reply: checked like a tool call, kept as a draft.
    // (And not once her own tool finished it in this same turn.)
    const stillOpen = async (key: FlowStepKey) => step === key && !["done", "skipped"].includes(statusOf((await loadFlow(id)).state, key));
    const notes = Object.fromEntries(Object.entries(reply.hello_notes ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
    if (Object.keys(notes).length && (await stillOpen("hello"))) {
      const noted = await runTool({ restaurantId: id, channel: input.channel }, TOOLS, "note_hello", notes);
      toolCalls.push({ name: "note_hello", ok: noted.ok, text: noted.text });
      if (!noted.ok) console.warn("Dina's hello notes weren't kept", noted.text);
    }
    // The owner's answers to the Google questions, the same way (code decides what they change).
    if (reply.google_notes && Object.values(reply.google_notes).some(Boolean) && (await stillOpen("google"))) {
      await applyGoogleNotes(id, reply.google_notes, input.channel).catch((err) => console.warn("Dina's Google notes weren't kept", err));
    }
    // Step 6: the hours and the answers to the common questions she heard.
    if (reply.hours_notes && Object.keys(reply.hours_notes).length && (await stillOpen("hours_faqs"))) {
      await applyHoursNotes(id, reply.hours_notes, input.channel).catch((err) => console.warn("Dina's hours notes weren't kept", err));
    }
    if (reply.faq_notes && Object.values(reply.faq_notes).some(Boolean) && (await stillOpen("hours_faqs"))) {
      await applyFaqNotes(id, reply.faq_notes as Record<string, string>, input.channel).catch((err) => console.warn("Dina's FAQ notes weren't kept", err));
    }
    // The details every agent needs (sign-off, emoji, allergen statement, offer types):
    // profile fields, so saved whichever step she hears them on.
    if (reply.details_notes && Object.values(reply.details_notes).some(Boolean)) {
      await applyDetailNotes(id, reply.details_notes).catch((err) => console.warn("Dina's details notes weren't kept", err));
    }
    // A colour for the "Your look" card (shown again for them to check).
    if (reply.brand_notes?.colour && step === "look") {
      await applyBrandNotes(id, reply.brand_notes).catch((err) => console.warn("Dina's brand notes weren't kept", err));
    }
  } catch (err) {
    // 4. Never leave the owner without an answer, or show an unchecked one.
    if (err instanceof DinaReplyError) {
      calls.push(...err.calls);
      toolCalls = err.toolCalls;
    }
    console.error("Dina's turn failed; sending the fallback", err);
    await alertBuilder(`dina-failed:${id}`, `Dina couldn't answer during setup (${step ?? "end"}): ${err instanceof Error ? err.message : String(err)}. The owner got the fallback line.`).catch(() => {});
    reply = fallbackReply((await getSession(id))?.current_step ?? step, { event: input.event, ownerName: restaurant.owner_name, restaurantName: restaurant.name });
    fallback = true;
  }

  await preparing;
  // She moved on to the tone step in this reply and showed its choices: prepare them now.
  if (!preparing && reply.messages.some((m) => m.component?.type === "tone_choices")) {
    await prepareToneOptions(id).catch((err) => console.error("Couldn't prepare the tone choices", err));
  }

  // 5. Her messages, then what code asks next (guide), (and, at the very end, the
  // summary and the WhatsApp link), and what this turn cost.
  const follow = await guideFollowUp(id, before, input.event === "start" || input.event === "resume" ? "no owner message" : "owner spoke");
  const shown = [...reply.messages, ...follow.messages];
  const { saved, stepNow } = await saveDinaMessages(id, input.channel, [...shown, ...(follow.dinaNote ? [] : await endOfSetup(id, shown, input.channel))]);
  let costUsd = await logUsage(id, session.started_at, step, calls);
  let messages = saved;
  let last = stepNow;
  // Her step is done and the next one is hers too (a new chapter): she starts it in a turn of its own.
  if (follow.dinaNote && !input.followUp) {
    const more = await dinaTurn({ restaurantId: id, channel: input.channel, event: "action", note: follow.dinaNote, onStatus: input.onStatus, followUp: true });
    if (!more.duplicate) {
      messages = [...saved, ...more.messages];
      costUsd += more.costUsd;
      last = more.step;
    }
  }
  return { duplicate: false, reply, messages, step: last, costUsd, fallback, toolCalls };
}

// What she's told about what comes next (prompt.ts puts it in her turn).
function guideLine(action: NextAction) {
  if (action.kind === "ask" || action.kind === "recap")
    return "Right after your reply, code shows the owner the next question itself (a card with its own buttons). So don't ask anything and don't add a component: answer what the owner said, or say what was saved, in one short line.";
  if (action.kind === "dina" && action.question?.brief) return `What to ask now: ${action.question.brief}. Stay on this; when it's done, code moves setup on (never start the next step yourself).`;
  return null;
}

// After a turn: code's next question (or recap, or a new chapter's opening line),
// unless it's already on screen; or, when the next thing is Dina's on another
// step, what to tell her for the turn that starts it.
// before: what setup expected when the turn started; Dina only gets a turn of her
// own when what's hers to ask moved on during this one (a new step).
async function guideFollowUp(id: string, before: NextAction | null, spoke: "owner spoke" | "no owner message") {
  const g = await guideNext(id);
  if (g.action.kind === "end") return { messages: [] as DinaReply["messages"], dinaNote: null as string | null };
  if (codeAsksNext(g.action)) {
    const { data } = await getSupabase().from("onboarding_messages").select("role, parts").eq("restaurant_id", id).order("created_at", { ascending: false }).limit(4);
    const rows = (data ?? []) as { role: string; parts: unknown[] | null }[];
    const lastDina = rows.find((r) => r.role === "dina");
    const ownerIndex = rows.findIndex((r) => r.role === "owner");
    const ownerSince = spoke === "owner spoke" || (ownerIndex !== -1 && ownerIndex < rows.findIndex((r) => r.role === "dina"));
    if (alreadyAsking(lastDina?.parts, g.action, ownerSince)) return { messages: [], dinaNote: null };
    return { messages: g.messages, dinaNote: null };
  }
  const step = g.action.step;
  const moved = g.action.kind === "dina" && !(before?.kind === "dina" && before.step === step);
  return moved ? { messages: g.messages, dinaNote: g.dinaNote ?? `Setup has moved on to ${STEP_DEFS[step].title}: start it.` } : { messages: [], dinaNote: null };
}

// Once every step is dealt with: setup finishes (with WhatsApp linked), and code
// adds the summary if she didn't show it; without WhatsApp, one message asking to
// link it (not repeated if it was asked in the last few messages).
async function endOfSetup(id: string, messages: DinaReply["messages"], channel: Channel): Promise<DinaReply["messages"]> {
  const outcome = await finishIfDone(id);
  if (!outcome) return [];
  const has = (type: string) => messages.some((m) => m.component?.type === type);
  const summary = has("summary") ? [] : [{ text: outcome.finished ? "Here's everything we've set up together." : "Here's where setup stands.", component: { type: "summary" as const } }];
  if (outcome.finished) {
    // Finished on the web: the same closing line on WhatsApp, where they'll hear from us next.
    const withReview = (c: "web" | "whatsapp" | "app") => (outcome.reviewStarted ? `${outcome.allSet} ${reviewLine(c)}` : outcome.allSet);
    // An app owner with no WhatsApp: everything comes in the app.
    if (outcome.reach === "app") return [...summary, { text: withReview("app"), component: null }];
    if (channel === "web") await whatsAppLine(id, withReview("whatsapp")).catch((err) => console.error("Couldn't send the all-set line on WhatsApp", err));
    return [...summary, { text: withReview(channel === "web" ? "web" : "whatsapp"), component: null }];
  }
  const { data: recent } = await getSupabase().from("onboarding_messages").select("parts").eq("restaurant_id", id).eq("role", "dina").order("created_at", { ascending: false }).limit(6);
  const askedRecently = (recent ?? []).some((r) => ((r.parts as { type?: string }[] | null) ?? []).some((p) => p?.type === "whatsapp_link"));
  if (askedRecently || has("whatsapp_link")) return [];
  return [...summary, { text: "One last thing: link your WhatsApp, so your morning brief and alerts can reach you. Then setup is finished.", component: { type: "whatsapp_link" as const } }];
}

// One line to the owner on WhatsApp, inside its 24-hour window (it's logged like any other).
async function whatsAppLine(restaurantId: string, text: string) {
  const [{ getRestaurant: load }, { ownerChannel }, { whatsappWindowOpen }, { sendAndLog }, { sendText }] = await Promise.all([
    import("../store"),
    import("@/lib/followups"),
    import("./say"),
    import("@/lib/notify"),
    import("@/lib/whatsapp"),
  ]);
  const r = await load(restaurantId);
  const channel = ownerChannel(r);
  if (!channel || !(await whatsappWindowOpen(restaurantId, r.owner_whatsapp))) return;
  await sendAndLog(channel, () => sendText(channel.from, channel.to, text), text);
}

// Dina's messages saved, in order (a millisecond apart, so they always read back
// in the order she said them). An allergen card gets the dish it's about now, so
// a tap on it later answers that dish; with no dish left to check, it's dropped.
async function saveDinaMessages(id: string, channel: Channel, messages: DinaReply["messages"]) {
  const stepNow = (await getSession(id))?.current_step ?? null;
  // Strictly after the owner's message they answer (saved a moment before, same clock).
  const base = Date.now() + 1;
  const saved: SavedMessage[] = [];
  for (const m of messages) {
    let component = m.component;
    if (component?.type === "allergen_check") {
      const dish = await nextDishForCard(id).catch(() => null);
      component = dish ? { type: "allergen_check", dish: dish.key } : null;
    }
    saved.push({ id: randomUUID(), text: m.text, component });
  }
  check(
    await getSupabase()
      .from("onboarding_messages")
      .insert(
        saved.map((m, i) => ({
          id: m.id,
          restaurant_id: id,
          role: "dina",
          channel,
          step_key: stepNow,
          body: m.text,
          parts: m.component ? [m.component] : [],
          created_at: new Date(base + i).toISOString(),
        })),
      ),
  );
  return { saved, stepNow };
}

// A turn code answers itself, with no Claude call (the next allergen card after a
// tap): the owner's message once, then code's message, which passes Dina's checks.
// note: what code did, passed on to Dina if she takes over in the same turn.
export async function codeTurn(input: { restaurantId: string; channel: Channel; text: string; externalId?: string | null; ownerParts?: unknown[]; messages: DinaReply["messages"]; note?: string | null }): Promise<TurnResult> {
  const problems = dinaReplyProblems({ messages: input.messages });
  if (problems.length) throw new Error(`Code's setup message failed its checks: ${problems.join("; ")}`);
  const session = (await getSession(input.restaurantId)) ?? (await startOnboarding(input.restaurantId, { channel: input.channel }));
  const { error } = await getSupabase()
    .from("onboarding_messages")
    .insert({ id: randomUUID(), restaurant_id: input.restaurantId, role: "owner", channel: input.channel, step_key: session.current_step, body: input.text, parts: input.ownerParts ?? [], external_id: input.externalId ?? null, created_at: new Date().toISOString() });
  if (error?.code === "23505") return { duplicate: true };
  if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  // Code just answered; unless its own messages carry the next card (the allergen
  // cards), what's next is asked now: code's card, or Dina's turn.
  const codeCarriesOn = input.messages.some((m) => m.component);
  const follow = codeCarriesOn ? { messages: [], dinaNote: null } : await guideFollowUp(input.restaurantId, null, "owner spoke");
  const shown = [...input.messages, ...follow.messages];
  const messages = [...shown, ...(follow.dinaNote ? [] : await endOfSetup(input.restaurantId, shown, input.channel))];
  const { saved, stepNow } = await saveDinaMessages(input.restaurantId, input.channel, messages);
  // Code finished its questions and the next ones are Dina's: she starts them now.
  const dinaNote = follow.dinaNote ?? (codeCarriesOn ? null : await dinaNoteIfHers(input.restaurantId, follow.messages.length > 0));
  if (dinaNote) {
    const more = await dinaTurn({ restaurantId: input.restaurantId, channel: input.channel, event: "action", note: `${input.note ? `${input.note} ` : ""}${dinaNote}`, followUp: true });
    if (!more.duplicate) return { duplicate: false, reply: { messages }, messages: [...saved, ...more.messages], step: more.step, costUsd: more.costUsd, fallback: more.fallback, toolCalls: more.toolCalls };
  }
  return { duplicate: false, reply: { messages }, messages: saved, step: stepNow, costUsd: 0, fallback: false, toolCalls: [] };
}

// After code's own turn when the next question is Dina's on the same step (e.g.
// Change on the recap of one of her steps): she's told what to ask. Not when the
// allergen cards carry on (code's own next card is already on its way).
async function dinaNoteIfHers(id: string, codeShowedSomething: boolean) {
  if (codeShowedSomething) return null;
  const g = nextAction(await factsFor(id, (await loadFlow(id)).state));
  if (g.kind !== "dina" || !g.question || g.question.id !== `${g.step}.base`) return null;
  const { data } = await getSupabase().from("onboarding_steps").select("data").eq("restaurant_id", id).eq("step_key", g.step).maybeSingle<{ data: { q?: Record<string, { status: string }> } | null }>();
  return data?.data?.q?.[g.question.id]?.status === "reask" ? `The owner wants to change ${g.question.label.toLowerCase()}. Ask what they'd like to change.` : null;
}

// The last messages before this one, oldest first (config: history_messages).
async function recentChat(restaurantId: string, excludeId: string | null): Promise<HistoryLine[]> {
  const { dinaConfig } = await import("./config");
  const rows =
    check(
      await getSupabase()
        .from("onboarding_messages")
        .select("id, role, body, created_at")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(dinaConfig().historyMessages + 1)
        .returns<{ id: string; role: HistoryLine["role"]; body: string }[]>(),
    ) ?? [];
  return rows
    .filter((r) => r.id !== excludeId)
    .slice(0, dinaConfig().historyMessages)
    .reverse()
    .map((r) => ({ role: r.role, text: r.body }));
}

// One row per Claude call, so a run's cost is the sum of its rows (scripts/onboarding-costs.mjs).
async function logUsage(restaurantId: string, runStartedAt: string, step: FlowStepKey | null, calls: Call[]) {
  if (!calls.length) return 0;
  const { error } = await getSupabase()
    .from("onboarding_ai_usage")
    .insert(
      calls.map((c) => ({
        restaurant_id: restaurantId,
        run_started_at: runStartedAt,
        step_key: step,
        purpose: c.purpose,
        model: c.model,
        input_tokens: c.tokens.input,
        output_tokens: c.tokens.output,
        cache_read: c.tokens.cacheRead,
        cache_write: c.tokens.cacheWrite,
        cost_usd: Number(c.tokens.cost.toFixed(6)),
      })),
    );
  // A missing cost line mustn't lose the owner's answer.
  if (error) console.error("Couldn't log onboarding cost", error.message);
  return calls.reduce((sum, c) => sum + c.tokens.cost, 0);
}
