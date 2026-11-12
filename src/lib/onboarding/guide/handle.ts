import "server-only";
import { getSupabase } from "@/lib/supabase";
import { stepState } from "../flow";
import { loadFlow, patchStepData, type Channel } from "../sessions";
import type { DinaReply } from "../dina/reply";
import { CHAPTER_SKIP } from "../dina/view";
import { answerQuestion, confirmRecap, reaskFromRecap, skipChapter, skipQuestion, type GridAnswer } from "./answer";
import { askFor, inputsFrom, pickedLabel, RECAP_OK, SKIP_ID } from "./cards";
import type { StaffingAnswer } from "@/components/chat/types";
import { availableChapters, CHAPTERS, chapterOf, type ChapterKey } from "./chapters";
import { loadFacts } from "./next";
import { questionById } from "./questions";

// Every tap, typed answer and file that answers one of code's own cards (a
// question, a recap, "do this chapter later?"), the same on the web and on
// WhatsApp. Returns code's reply (turn.ts codeTurn saves and sends it, then asks
// what's next), or null when it isn't code's to answer (Dina takes it).
//
// The web card has its own Confirm, so a pick arrives confirmed. On WhatsApp a
// pick on a decision is read back first ("You picked ... Shall I save that?")
// and saved only on Confirm; a choice that needs words ("Choose my own") asks
// for them, and the next message is that answer.

export type GuideReply = { messages: DinaReply["messages"]; note?: string | null };

const say = (text: string): GuideReply => ({ messages: [{ text, component: null }] });

export type Pending = { q: string; picked: string[]; typed: string | null; awaiting_text?: boolean };

// The part a message carried, if it's one of this restaurant's Dina messages.
async function partOf(restaurantId: string, messageId: string) {
  const { data } = await getSupabase().from("onboarding_messages").select("parts").eq("restaurant_id", restaurantId).eq("id", messageId).eq("role", "dina").maybeSingle<{ parts: unknown[] | null }>();
  return (data?.parts?.[0] ?? null) as { type?: string; q?: string; chapter?: string } | null;
}

// A WhatsApp pick waiting for Confirm (or for its words), kept on the question's step.
async function pendingOf(restaurantId: string): Promise<Pending | null> {
  const { state } = await loadFlow(restaurantId);
  for (const k of Object.keys(state) as (keyof typeof state)[]) {
    const p = stepState(state, k).data.pending_pick as Pending | null | undefined;
    if (p?.q) return p;
  }
  return null;
}
async function setPending(restaurantId: string, q: string, pending: Pending | null) {
  const question = questionById(q);
  if (question) await patchStepData(restaurantId, question.step, { pending_pick: pending });
}

async function answer(restaurantId: string, q: string, picked: string[], typed: string | null, channel: Channel, grid?: GridAnswer | null, staffing?: StaffingAnswer | null): Promise<GuideReply> {
  if (picked.includes(SKIP_ID)) {
    await skipQuestion(restaurantId, q, channel);
    return say("No problem, we can come back to that later.");
  }
  const result = await answerQuestion({ restaurantId, q, picked, typed, channel, grid, staffing });
  return { messages: [{ text: result.said, component: (result.ok && result.component ? result.component : null) as never }] };
}

// A pick on one of code's question cards.
export async function guidePick(input: { restaurantId: string; messageId: string; choiceIds: string[]; text?: string | null; channel: Channel; confirmed: boolean; grid?: GridAnswer | null; staffing?: StaffingAnswer | null }): Promise<GuideReply | null> {
  const part = await partOf(input.restaurantId, input.messageId);
  if (!part?.type) return null;
  const typed = input.text?.trim() || null;

  if (part.type === "recap" && part.chapter && CHAPTERS[part.chapter as ChapterKey]) {
    const chapter = part.chapter as ChapterKey;
    const choice = input.choiceIds[0] ?? "";
    if (choice === RECAP_OK) {
      await confirmRecap(input.restaurantId, chapter, input.channel);
      return say(`Lovely, that's ${CHAPTERS[chapter].title} done.`);
    }
    if (choice.startsWith("change:")) {
      const q = await reaskFromRecap(input.restaurantId, chapter, choice.slice("change:".length), input.channel);
      return q ? say(`Sure, let's change ${q.label.toLowerCase()}.`) : say("Which line would you like to change?");
    }
    return null;
  }

  if (part.type === "chapter_skip" && part.chapter && CHAPTERS[part.chapter as ChapterKey]) {
    const chapter = part.chapter as ChapterKey;
    if (input.choiceIds[0] === CHAPTER_SKIP.yes) {
      const skipped = await skipChapter(input.restaurantId, chapter, input.channel);
      return { ...say(`No problem, we'll do ${CHAPTERS[chapter].title} later. I'll remind you in your morning brief.`), note: `The owner chose to do ${CHAPTERS[chapter].title} later; code skipped ${skipped.length} step${skipped.length === 1 ? "" : "s"} of it.` };
    }
    return say("Great, let's carry on.");
  }

  if (part.type === "pick_confirm" && part.q) {
    const pending = await pendingOf(input.restaurantId);
    await setPending(input.restaurantId, part.q, null);
    if (input.choiceIds[0] === "pick_ok" && pending?.q === part.q) return answer(input.restaurantId, part.q, pending.picked, pending.typed, input.channel);
    return say("No problem, pick again.");
  }

  if (part.type !== "question" || !part.q) return null;
  const q = questionById(part.q);
  if (!q) return null;
  // Not confirmed on a card (WhatsApp, or typed in the chat box): a choice that
  // needs words asks for them; a decision is read back first.
  if (!input.confirmed && !input.choiceIds.includes(SKIP_ID)) {
    const facts = await loadFacts(input.restaurantId);
    const { toneConfig } = await import("../dina/setup-config");
    const inputs = inputsFrom({ restaurant: facts.r, state: facts.state, tones: toneConfig() });
    const asked = askFor(q.id, facts, inputs);
    const needsWords = asked?.card.input && input.choiceIds.includes(asked.card.input.optionId) && !typed;
    if (needsWords) {
      await setPending(input.restaurantId, q.id, { q: q.id, picked: input.choiceIds, typed: null, awaiting_text: true });
      return say(`Type it here and I'll show you before saving. ${asked!.card.input!.placeholder.replace(/^e\.g\./, "For example")}.`);
    }
    if (q.decision) {
      await setPending(input.restaurantId, q.id, { q: q.id, picked: input.choiceIds, typed });
      const label = pickedLabel(q.id, input.choiceIds, facts, inputs, typed);
      return { messages: [{ text: `You picked: ${label}. Shall I save that?`, component: { type: "pick_confirm", q: q.id } as never }] };
    }
  }
  return answer(input.restaurantId, q.id, input.choiceIds, typed, input.channel, input.grid, input.staffing);
}

// A typed message while one of code's cards is on screen: the words it was
// waiting for (WhatsApp, after "Choose my own"), or a typed answer to a card that
// takes words. Anything else (a question, a change of subject) goes to Dina.
export async function guideTyped(input: { restaurantId: string; text: string; channel: Channel; asking: { messageId: string; part: { type?: string; q?: string } } | null }): Promise<GuideReply | null> {
  const text = input.text.trim();
  if (!text || text.endsWith("?") || text.split(/\s+/).length > 25) return null;
  const pending = await pendingOf(input.restaurantId);
  if (pending?.awaiting_text) {
    const q = questionById(pending.q);
    if (q?.decision) {
      await setPending(input.restaurantId, q.id, { q: q.id, picked: pending.picked, typed: text });
      return { messages: [{ text: `You wrote: ${text}. Shall I save that?`, component: { type: "pick_confirm", q: q.id } as never }] };
    }
    await setPending(input.restaurantId, pending.q, null);
    return answer(input.restaurantId, pending.q, pending.picked, text, input.channel);
  }
  if (input.asking?.part.type !== "question" || !input.asking.part.q) return null;
  const facts = await loadFacts(input.restaurantId);
  const { toneConfig } = await import("../dina/setup-config");
  const inputs = inputsFrom({ restaurant: facts.r, state: facts.state, tones: toneConfig() });
  const asked = askFor(input.asking.part.q, facts, inputs);
  if (!asked) return null;
  // Numbers for a question where several can be picked ("1, 3 and 5"; WhatsApp).
  if (asked.card.multi && /^\s*\d{1,2}(\s*(,|and|&|\s)\s*\d{1,2})*\s*$/i.test(text)) {
    const n = text.match(/\d{1,2}/g)!.map(Number);
    const picked = [...new Set(n)].map((i) => asked.card.options[i - 1]?.id).filter((x): x is string => Boolean(x));
    if (picked.length) return guidePick({ restaurantId: input.restaurantId, messageId: input.asking.messageId, choiceIds: picked, channel: input.channel, confirmed: false });
  }
  // Typed the words of one of the options ("yes", "no emoji").
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const option = asked.card.options.find((o) => norm(o.label) === norm(text) || norm(o.short ?? "") === norm(text) || norm(o.id) === norm(text));
  if (option && option.id !== asked.card.input?.optionId) return guidePick({ restaurantId: input.restaurantId, messageId: input.asking.messageId, choiceIds: [option.id], channel: input.channel, confirmed: false });
  // A card that takes words: what they typed is the answer (read back first).
  if (asked.card.input) return guidePick({ restaurantId: input.restaurantId, messageId: input.asking.messageId, choiceIds: [asked.card.input.optionId], text, channel: input.channel, confirmed: false });
  return null;
}

// Files while one of code's look questions is open: the logo, or dish photos.
export async function guideFiles(input: { restaurantId: string; files: import("../dina/uploads-store").FilePart[]; channel: Channel }): Promise<GuideReply | null> {
  const facts = await loadFacts(input.restaurantId);
  const { nextAction } = await import("./questions");
  const action = nextAction(facts);
  if (action.kind !== "ask") return null;
  // The customer list (a CSV or Excel file), read into a draft; how they agreed is asked next.
  if (action.question.id === "customers.import") {
    const sheet = input.files.find((f) => f.kind === "csv" || f.kind === "excel");
    if (!sheet) return say("Send your customer list as a CSV or Excel file, with a column of emails.");
    const { readCustomerFile } = await import("./import");
    const read = await readCustomerFile(input.restaurantId, sheet);
    return say(read.ok ? `Thanks, I've read ${read.count} customers with an email address${read.skipped ? ` (${read.skipped} rows had no usable email, so I left them out)` : ""}.` : read.text);
  }
  // Past rotas (photos, PDFs, a spreadsheet or a rota app's export), read into the
  // check card. Our own team sheet sent here by mistake goes to the team instead.
  if (action.question.id === "team.rotas" || action.question.id === "team.rotas_check") {
    const { recordQuestion } = await import("../sessions");
    const { withRecord } = await import("./questions");
    const sheet = input.files.find((f) => f.kind === "csv" || f.kind === "excel");
    if (sheet) {
      const [{ readOwnSheet }, { readSavedFile }] = await Promise.all([import("@/lib/templates/read-file"), import("../dina/uploads-store")]);
      const own = await readOwnSheet(await readSavedFile(input.restaurantId, sheet.path)).catch(() => null);
      if (own?.kind === "staff") {
        await recordQuestion(input.restaurantId, "team", (d, now) => withRecord(withRecord(d, "team.rotas", "skipped", now), "team.method", "answered", now), { channel: input.channel });
        await patchStepData(input.restaurantId, "team", { staff_files: [sheet] });
        return null;
      }
    }
    const { readRotaFiles } = await import("@/lib/rota/import");
    const read = await readRotaFiles(input.restaurantId, input.files).catch((err) => (console.error("Reading the rotas failed", err), null));
    if (!read) return say("I couldn't read those this time. Could you send them again?");
    if (!read.ok) return say(read.text);
    await recordQuestion(input.restaurantId, "team", (d, now) => withRecord(d, "team.rotas", "answered", now), { channel: input.channel });
    return say(read.text);
  }
  // The team sheet (or their own list) sent on the team card: that answers how,
  // and Dina reads it (dina/whatsapp-turn.ts noteForFiles), so code steps aside.
  if (action.question.id === "team.method") {
    if (!input.files.some((f) => f.kind === "csv" || f.kind === "excel")) return say("Send the team sheet or your staff list as a CSV or Excel file, or tap I'll tell you here.");
    const { recordQuestion } = await import("../sessions");
    const { withRecord } = await import("./questions");
    await recordQuestion(input.restaurantId, "team", (d, now) => withRecord(d, "team.method", "answered", now), { channel: input.channel });
    return null;
  }
  // Our menu costs sheet, filled in, while the costs are being asked.
  if (action.question.id === "menu.costs") {
    const sheet = input.files.find((f) => f.kind === "csv" || f.kind === "excel");
    if (!sheet) return null;
    const [{ readOwnSheet }, { readSavedFile }, { saveCostsSheet }, { getRestaurant }] = await Promise.all([import("@/lib/templates/read-file"), import("../dina/uploads-store"), import("@/lib/templates/import"), import("../store")]);
    const own = await readOwnSheet(await readSavedFile(input.restaurantId, sheet.path)).catch(() => null);
    if (own?.kind !== "menu_costs") return null;
    const saved = await saveCostsSheet(await getRestaurant(input.restaurantId), own.table);
    if (saved.ok) {
      const { recordQuestion } = await import("../sessions");
      const { withRecord } = await import("./questions");
      await recordQuestion(input.restaurantId, "menu", (d, now) => withRecord(d, "menu.costs", "answered", now), { channel: input.channel });
    }
    return say(saved.message.replace(/^✅\s*/, ""));
  }
  if (action.question.id !== "look.logo" && action.question.id !== "look.photos") return null;
  const { lookFiles } = await import("../dina/details-step");
  const purpose = action.question.id === "look.logo" ? "logo" : "photos";
  const said = await lookFiles(input.restaurantId, input.files, purpose).catch((err) => (console.error("Saving the photos failed", err), null));
  if (!said) return say("Those photos couldn't be saved this time. Could you send them again?");
  if (/^Only photos/.test(said)) return say("Only photos work here: send your logo or dish photos as pictures.");
  if (/over 2 MB/.test(said)) return say("That logo is over 2 MB. Could you send a smaller copy? A screenshot works.");
  if (purpose === "logo") return say("Got it. Here's how it looks.");
  const { recordQuestion } = await import("../sessions");
  const { withRecord } = await import("./questions");
  await recordQuestion(input.restaurantId, "look", (d, now) => withRecord(d, "look.photos", "answered", now), { channel: input.channel });
  const added = said.match(/saved (\d+) photo/)?.[1];
  return say(`Thanks, ${added ?? "those"} photo${added === "1" ? "" : "s"} saved to your library for your Google posts.`);
}

// "Do this chapter later" (the web button, or SKIP on WhatsApp): asked once first.
export async function guideSkipAsk(restaurantId: string, step: import("../flow").FlowStepKey | null): Promise<GuideReply | null> {
  if (!step) return null;
  const chapter = chapterOf(step);
  if (!chapter || chapter.key === availableChapters()[0]?.key) return null;
  return { messages: [{ text: `Do the rest of ${chapter.title} later? It'll stay on your setup list, and I'll remind you in your morning brief.`, component: { type: "chapter_skip", chapter: chapter.key } as never }] };
}
