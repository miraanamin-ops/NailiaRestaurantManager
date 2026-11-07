import "server-only";
import { saveAndConfirmFields } from "@/lib/profile-edits";
import { stepState } from "../flow";
import { factsFor, loadFlow, patchStepData, recordQuestion, skipStep, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { colourFrom, detailFields } from "../dina/details-content";
import { lookData } from "../dina/details-step";
import { saveToneChoice } from "../dina/tone-step";
import { OWN, type Voice } from "../dina/tones";
import { afterSkip } from "../dina/answers";
import { availableChapters, CHAPTERS, type ChapterKey } from "./chapters";
import { emojiValue, OWN_ID, signOffChoices } from "./cards";
import { contrastWithWhite, darken, DEFAULT_PALETTE, type Palette } from "./palette";
import { isRecap, questionById, questionsFor, recapId, resolution, withReask, withRecord, withoutRecord } from "./questions";

// Saving the owner's answer to one of code's questions (guide/questions.ts):
// checked here, saved to the profile as confirmed, recorded on the question, and
// the step counted again. Returns the short line code says back, or what was
// wrong (the question is then asked again). Both channels use this.

export type AnswerResult = { ok: true; said: string } | { ok: false; said: string };

const ok = (said: string): AnswerResult => ({ ok: true, said });
const no = (said: string): AnswerResult => ({ ok: false, said });

async function record(restaurantId: string, id: string, channel: Channel) {
  const q = questionById(id)!;
  await recordQuestion(restaurantId, q.step, (d, now) => withRecord(d, id, "answered", now), { channel });
}

// "dark green and cream", "#1B5E20, #F3E9D2" -> the two colours (the second
// worked out from the first when only one is given, dark enough for white text).
export function coloursFromText(text: string): { main: string; second: string } | null {
  const parts = text
    .split(/,|\band\b|\bwith\b|\/|\+|&/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const found = parts.map(colourFrom).filter((c): c is string => Boolean(c));
  if (!found.length) return null;
  const main = found[0];
  const second = found[1] && contrastWithWhite(found[1]) >= 4.5 ? found[1] : found[1] ? darken(found[1]) : contrastWithWhite(main) >= 7 ? "#1c1917" : darken(main);
  return { main, second };
}

export async function answerQuestion(input: { restaurantId: string; q: string; picked: string[]; typed?: string | null; channel: Channel }): Promise<AnswerResult> {
  const { restaurantId: id, q, channel } = input;
  const typed = input.typed?.trim() || null;
  const pick = input.picked[0] ?? (typed ? OWN_ID : null);
  const r = await getRestaurant(id);

  if (q === "look.logo") {
    const data = await lookData(id);
    const logo = data.brand_draft?.logo_url ?? r.logo_url ?? null;
    if (pick !== "use" || !logo) return no("Send me your logo as a photo or image file, and I'll show it to you first.");
    await saveAndConfirmFields(r, { logo_url: logo }, "Logo, with Dina at setup");
    await patchStepData(id, "look", { brand_confirmed: true });
    await record(id, q, channel);
    return ok("Lovely, that's your logo saved.");
  }

  if (q === "look.colours") {
    const data = await lookData(id);
    const palettes: Palette[] = data.palettes?.length ? data.palettes : [DEFAULT_PALETTE];
    let chosen: { main: string; second: string } | null = null;
    if (pick === OWN_ID) {
      chosen = typed ? coloursFromText(typed) : null;
      if (!chosen) return no(typed ? `I couldn't read "${typed}" as colours. Try a name like "dark green", or a colour code like #1B5E20.` : "Type the colours you'd like, for example dark green and cream.");
    } else {
      const p = palettes.find((x) => x.id === pick);
      if (!p) return no("Pick one of the colour choices, or choose your own.");
      chosen = { main: p.main, second: p.second };
    }
    await saveAndConfirmFields(r, { brand_color: chosen.main, brand_dark: chosen.second }, "Colours, with Dina at setup");
    await record(id, q, channel);
    return ok("Great, your colours are saved.");
  }

  if (q === "tone.praise" || q === "tone.complaint") {
    const voice: Voice = q === "tone.complaint" ? "complaint" : "praise";
    if (!pick) return no("Pick the reply that sounds most like you, or write your own.");
    if ((pick === OWN || pick === OWN_ID) && !typed) return no("Type how you'd reply, and I'll use that as your example.");
    const said = await saveToneChoice(id, voice, pick === OWN || pick === OWN_ID ? { tone: OWN, own: typed! } : { tone: pick }, channel);
    if (/wasn't one of the tones/.test(said)) return no("Pick one of the replies, or write your own.");
    await record(id, q, channel);
    return ok(voice === "praise" ? "Got it, that's how you'll reply to good reviews." : "Got it, that's how you'll handle complaints.");
  }

  if (q === "tone.sign_off") {
    const choices = signOffChoices(r.owner_name?.split(" ")[0] ?? null, r.name);
    const value = pick === OWN_ID ? typed : (choices[Number(pick?.slice(1)) - 1] ?? null);
    if (!value) return no(pick === OWN_ID ? "Type how you'd like replies signed, for example Amina and the team." : "Pick how you'd like replies signed.");
    const { fields, problems } = detailFields({ sign_off_name: value });
    if (problems.length || !fields.sign_off_name) return no("That's a bit long for a sign-off. Something like Amina and the team works best.");
    await saveAndConfirmFields(r, { sign_off_name: fields.sign_off_name }, "Sign-off, with Dina at setup");
    await record(id, q, channel);
    return ok(`Replies will be signed "${fields.sign_off_name}".`);
  }

  if (q === "tone.emoji") {
    if (pick !== "yes" && pick !== "no") return no("Is a couple of emoji fine, or none at all?");
    await saveAndConfirmFields(r, { emoji_allowed: emojiValue(pick) }, "Emoji, with Dina at setup");
    await record(id, q, channel);
    return ok(pick === "yes" ? "Noted: a couple of emoji in posts and emails, never in review replies." : "Noted: no emoji anywhere.");
  }

  return no("That question isn't one I can answer here.");
}

// "Skip this question": only that question (never the rest of its chapter).
export async function skipQuestion(restaurantId: string, id: string, channel: Channel) {
  const q = questionById(id);
  if (!q || isRecap(id)) return false;
  await recordQuestion(restaurantId, q.step, (d, now) => withRecord(d, id, "skipped", now), { channel });
  return true;
}

// The step a chapter's recap is held on: its last step that's part of setup.
const recapStep = (chapter: ChapterKey) => availableChapters().find((c) => c.key === chapter)?.steps.at(-1) ?? null;

// "Looks right" on a chapter's recap.
export async function confirmRecap(restaurantId: string, chapter: ChapterKey, channel: Channel) {
  const last = recapStep(chapter);
  if (last) await recordQuestion(restaurantId, last, (d, now) => withRecord(d, recapId(chapter), "answered", now), { channel, reopen: false });
}

// Change on a recap row: that question is asked again, and the recap waits for a fresh "Looks right".
export async function reaskFromRecap(restaurantId: string, chapter: ChapterKey, id: string, channel: Channel) {
  const q = questionById(id);
  if (!q || isRecap(id) || !CHAPTERS[chapter].steps.includes(q.step)) return null;
  const last = recapStep(chapter);
  if (last) await recordQuestion(restaurantId, last, (d) => withoutRecord(d, recapId(chapter)), { channel });
  await recordQuestion(restaurantId, q.step, (d, now) => withReask(d, id, now), { channel });
  return q;
}

// "Do this chapter later": every step of the chapter not dealt with yet is skipped
// (each becomes a setup gap). Returns the steps skipped.
export async function skipChapter(restaurantId: string, chapter: ChapterKey, channel: Channel) {
  const { state } = await loadFlow(restaurantId);
  const facts = await factsFor(restaurantId, state);
  const skipped = [];
  for (const step of CHAPTERS[chapter].steps) {
    const s = stepState(state, step);
    if (["done", "partial", "skipped"].includes(s.status) || (s.status === "in_progress" && s.waitingOn)) continue;
    // A step whose questions are all answered but the recap: it's finished, not skipped.
    if (questionsFor(step, facts).every((qq) => isRecap(qq.id) || resolution(qq, facts) !== "open") && s.status !== "not_started") continue;
    await skipStep(restaurantId, step, { channel });
    await afterSkip(restaurantId, step);
    skipped.push(step);
  }
  // Nothing left to check in it, so no recap either.
  await confirmRecap(restaurantId, chapter, channel);
  return skipped;
}
