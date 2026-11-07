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
import { catalogById, catalogValue } from "./catalog";
import { QUIETS, WINDOWS } from "./cards";
import { saveProfileFields } from "@/lib/profile-edits";
import { dishKey } from "../dina/facts-content";
import { DEFAULT_DISCOUNT_CAP, DEFAULT_SIGNUP_REWARD, rewardsProblems, timingProblems } from "../dina/ops-content";
import type { MenuCategory } from "../profile-data";
import { isRecap, questionById, questionsFor, recapId, resolution, withReask, withRecord, withoutRecord } from "./questions";

// Saving the owner's answer to one of code's questions (guide/questions.ts):
// checked here, saved to the profile as confirmed, recorded on the question, and
// the step counted again. Returns the short line code says back, or what was
// wrong (the question is then asked again). Both channels use this.

// component: a card to show with what code says back (the QR codes link).
export type AnswerResult = { ok: true; said: string; component?: { type: string } } | { ok: false; said: string };

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

// A typed time range: "10am to 8pm", "10:00-20:00", "midnight to 10am" -> ["10:00", "20:00"].
export function timeRange(text: string): [string, string] | null {
  const parts = text.toLowerCase().replace(/midnight/g, "12am").replace(/noon|midday/g, "12pm").split(/\s*(?:to|until|till|-|–)\s*/);
  if (parts.length !== 2) return null;
  const one = (t: string) => {
    const m = t.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
  };
  const a = one(parts[0]);
  const b = one(parts[1]);
  return a && b ? [a, b] : null;
}

export type GridAnswer = Record<string, string[] | "unsure">;

export async function answerQuestion(input: { restaurantId: string; q: string; picked: string[]; typed?: string | null; channel: Channel; grid?: GridAnswer | null }): Promise<AnswerResult> {
  const { restaurantId: id, q, channel } = input;
  const typed = input.typed?.trim() || null;
  const pick = input.picked[0] ?? (typed ? OWN_ID : null);
  const r = await getRestaurant(id);

  // One setting each (guide/catalog.ts): the value, checked, saved as confirmed.
  const cat = catalogById.get(q);
  if (cat) {
    const { state } = await loadFlow(id);
    const facts = await factsFor(id, state);
    const v = catalogValue(cat, facts, input.picked, typed);
    if ("error" in v) return no(v.error);
    // A day can't be both quiet and busy.
    if (q === "sales.busy" && Array.isArray(v.value)) {
      const both = (v.value as string[]).filter((d) => ((r as { quiet_days?: string[] | null }).quiet_days ?? []).includes(d));
      if (both.length) return no(`You said ${both.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(" and ")} ${both.length === 1 ? "is" : "are"} quiet. Pick your busy days, or change the quiet ones on the recap.`);
    }
    if (q === "offers.reward" || q === "offers.cap") {
      const reward = q === "offers.reward" ? String(v.value) : (r.signup_reward ?? DEFAULT_SIGNUP_REWARD);
      const cap = q === "offers.cap" ? Number(v.value) : (r.discount_cap_percent ?? DEFAULT_DISCOUNT_CAP);
      const problems = rewardsProblems({ signup_reward: reward, discount_cap_percent: cap }, r.recovery_offers ?? []);
      if (problems.length) return no(problems.join(" "));
    }
    await saveAndConfirmFields(r, { [cat.field]: v.value } as never, `${cat.label}, with Dina at setup`);
    await record(id, q, channel);
    return ok(savedLine(cat.label, v.value));
  }

  if (q === "menu.allergens") return answerGrid(id, input.picked, input.grid ?? null, channel);

  if (q === "menu.costs") {
    if (pick === "sheet") {
      await recordQuestion(id, "menu", (d, now) => withRecord(d, q, "skipped", now), { channel });
      return ok("No problem. Fill in the sheet whenever suits you and send it back here; I'll save the costs straight away.");
    }
    const pct = Number(pick?.replace("pct", ""));
    if (![25, 30, 35].includes(pct)) return no("Pick a rough share, or the spreadsheet.");
    const { saveMenuCosts } = await import("../dina/costs-step");
    const saved = await saveMenuCosts(id, { costs: [], rest_percent: pct, top_sellers: [], slow_sellers: [] });
    if (!saved.ok) return no("There's no menu saved yet, so there's nothing to cost.");
    await record(id, q, channel);
    return ok(`Saved: every dish costs about ${pct}% of its price to make, as an estimate. You can give exact costs any time.`);
  }

  if (q === "menu.top" || q === "menu.slow" || q === "menu.signature") {
    if (input.picked.length > (q === "menu.signature" ? 3 : 5)) return no(`Pick up to ${q === "menu.signature" ? 3 : 5}.`);
    // A dish can't be both a best and a slowest seller.
    if (q === "menu.slow") {
      const top = ((r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items.filter((i) => i.seller === "top" && input.picked.includes(dishKey(c.category, i.name))).map((i) => i.name));
      if (top.length) return no(`${top.join(" and ")} ${top.length === 1 ? "is" : "are"} on your best sellers. Pick the ones that sell least.`);
    }
    const menu = ((r.menu ?? []) as MenuCategory[]).map((c) => ({
      ...c,
      items: c.items.map((i) => {
        const on = input.picked.includes(dishKey(c.category, i.name));
        if (q === "menu.signature") return { ...i, signature: on };
        const tag = q === "menu.top" ? "top" : "slow";
        return on ? { ...i, seller: tag as "top" | "slow" } : i.seller === tag ? { ...i, seller: null } : i;
      }),
    }));
    await saveProfileFields(r, { menu }, q === "menu.signature" ? "Signature dishes, with Dina at setup" : "Best and slowest sellers, with Dina at setup");
    await record(id, q, channel);
    return ok(input.picked.length ? "Got it, thanks." : "No problem.");
  }

  if (q === "customers.qr") {
    const { sendQrKit } = await import("../dina/ops-step");
    const sent = await sendQrKit(id, channel);
    if (!sent.ok) return no("Your QR codes will be ready once setup is finished.");
    await record(id, q, channel);
    return { ok: true, said: "On their way. You can also open and print them here.", component: { type: "qr_kit" } };
  }

  if (q === "customers.import") {
    if (pick !== "none") return no("Send your customer list as a CSV or Excel file, or tap I don't have one.");
    await record(id, q, channel);
    return ok("No problem. Your QR codes will grow your list from here.");
  }

  if (q === "customers.consent") {
    const { importCustomers, dropImport } = await import("./import");
    if (pick === "agreed") {
      const done = await importCustomers(id);
      await record(id, q, channel);
      return ok(`Added ${done.added} customers${done.existing ? ` (${done.existing} were already on your list)` : ""}. Each one gets an email to confirm, up to 50 a day starting tomorrow, and only those who confirm ever get offers.`);
    }
    await dropImport(id);
    await record(id, q, channel);
    return ok("Then I won't add them: without their agreement we can't email them. Your QR codes will grow your list instead.");
  }

  if (q === "working.window" || q === "working.quiet") {
    const table = q === "working.window" ? WINDOWS : QUIETS;
    const chosen = pick && table[pick] ? [table[pick].start, table[pick].end] : pick === OWN_ID && typed ? timeRange(typed) : null;
    if (!chosen) return no(pick === OWN_ID ? "Type the hours like 10am to 8pm." : "Pick one of the choices, or type your own.");
    if (q === "working.window") {
      const problems = timingProblems({ brief_hour: r.brief_hour ?? 9, quiet_start: chosen[0], quiet_end: chosen[1] });
      if (problems.length) return no(problems.join(" "));
      await saveAndConfirmFields(r, { send_window_start: `${chosen[0]}:00`, send_window_end: `${chosen[1]}:00` }, "Sending hours, with Dina at setup");
      await patchStepData(id, "approvals_timing", { quiet_start: chosen[0], quiet_end: chosen[1], approver: "owner" }).catch(() => {});
    } else await saveAndConfirmFields(r, { quiet_hours_start: `${chosen[0]}:00`, quiet_hours_end: `${chosen[1]}:00` }, "Quiet hours, with Dina at setup");
    await record(id, q, channel);
    return ok(q === "working.window" ? `Customer messages will only go out between ${chosen[0]} and ${chosen[1]}.` : `I won't message you between ${chosen[0]} and ${chosen[1]}, unless it's urgent.`);
  }

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

// What code says after a setting is saved.
function savedLine(label: string, value: unknown) {
  void label;
  if (value === null || (Array.isArray(value) && !value.length)) return "Got it.";
  return "Got it, thanks.";
}

// The allergen grid confirmed: each dish's allergens and dietary tags as ticked, confirmed;
// a dish marked "not sure" stays unknown (never shown to customers) and is a gap.
async function answerGrid(id: string, picked: string[], grid: GridAnswer | null, channel: Channel): Promise<AnswerResult> {
  const r = await getRestaurant(id);
  const menu = (r.menu ?? []) as MenuCategory[];
  if (!menu.flatMap((c) => c.items).length) return no("There's no menu saved yet.");
  const notSure: string[] = [];
  const { UK_ALLERGENS } = await import("../profile-data");
  const allowed = new Set<string>(UK_ALLERGENS);
  const next = menu.map((c) => ({
    ...c,
    items: c.items.map((i) => {
      const key = dishKey(c.category, i.name);
      const row = grid ? grid[key] : undefined;
      if (row === "unsure") {
        notSure.push(key);
        return { ...i, allergens_confirmed: false };
      }
      // No grid sent (WhatsApp's "All correct"): the suggestions as they stand.
      const marks = row ?? [...(i.allergens ?? []), ...((i as { dietary?: string[] }).dietary ?? []).map((d) => `diet:${d}`)];
      return {
        ...i,
        allergens: marks.filter((m) => allowed.has(m)),
        dietary: marks.filter((m) => m.startsWith("diet:")).map((m) => m.slice(5)),
        allergens_confirmed: true,
      };
    }),
  }));
  void picked;
  await saveProfileFields(r, { menu: next }, "Allergens checked on the grid, with Dina at setup", { source: "manual" });
  const total = next.flatMap((c) => c.items).length;
  await patchStepData(id, "menu", { not_sure: notSure, allergens: { total, confirmed: total - notSure.length, unknown: notSure.length, left: 0 } });
  await recordQuestion(id, "menu", (d, now) => withRecord({ ...d, ...(notSure.length ? { gap_unlock: `Check the allergens for ${notSure.length} dish${notSure.length === 1 ? "" : "es"} and I'll answer allergy questions for all of them.` } : { gap_unlock: null }) }, "menu.allergens", notSure.length ? "skipped" : "answered", now), { channel });
  return ok(notSure.length ? `Saved. ${total - notSure.length} dishes confirmed; the ${notSure.length} you're not sure about stay unknown and are never shown to customers until you check them.` : `Saved: allergens confirmed for all ${total} dishes.`);
}
