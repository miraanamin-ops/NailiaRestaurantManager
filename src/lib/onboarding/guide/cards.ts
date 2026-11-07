import type { QuestionCardData, QuestionOption, RecapData, RecapRow } from "@/components/chat/types";
import { stepState, type FlowStepKey } from "../flow";
import { defaultOptions, OWN, toneCards, type ToneConfig, type ToneOptions, type Voice } from "../dina/tones";
import { EMOJI_NO, EMOJI_YES } from "../dina/details-content";
import { availableChapters, CHAPTERS, type ChapterKey } from "./chapters";
import { questionsFor, isRecap, resolution, type Facts } from "./questions";
import { DEFAULT_PALETTE, type Palette } from "./palette";

// What code says and shows for each of its questions, and each chapter's recap.
// Plain code (tests/guide.test.ts): the words pass Dina's checks (one question,
// no dashes), and a card's contents come from what's saved, never the AI.

export const SKIP_ID = "skip_q";
export const OWN_ID = "own";
export const RECAP_OK = "recap_ok";

export type CardInputs = {
  tones: ToneConfig;
  toneOptions: (voice: Voice) => ToneOptions;
  ownerFirst: string | null;
  restaurantName: string;
  // The logo to check: the one picked up from the website or sent, else what's saved.
  logo: string | null;
  logoFromWebsite: boolean;
  palettes: Palette[];
};

export type AskedQuestion = { text: string; card: QuestionCardData };

// The inputs, from what's saved: the tone replies prepared on the tone step (else
// the defaults), the logo and colour choices picked up on the look step.
export function inputsFrom(src: { restaurant: Record<string, unknown>; state: Facts["state"]; tones: ToneConfig }): CardInputs {
  const r = src.restaurant;
  const look = stepState(src.state, "look").data as { brand_draft?: { logo_url?: string | null; from_website?: boolean }; palettes?: Palette[] };
  const prepared = stepState(src.state, "tone").data.options as Partial<Record<Voice, ToneOptions>> | undefined;
  const draftLogo = look.brand_draft?.logo_url ?? null;
  return {
    tones: src.tones,
    toneOptions: (voice) => prepared?.[voice] ?? defaultOptions(src.tones, voice),
    ownerFirst: typeof r.owner_name === "string" && r.owner_name.trim() ? r.owner_name.trim().split(/\s+/)[0] : null,
    restaurantName: typeof r.name === "string" ? r.name : "your restaurant",
    logo: draftLogo ?? (typeof r.logo_url === "string" ? r.logo_url : null),
    logoFromWebsite: Boolean(draftLogo && look.brand_draft?.from_website),
    palettes: look.palettes?.length ? look.palettes : [DEFAULT_PALETTE],
  };
}

const voiceOf = (id: string): Voice => (id === "tone.complaint" ? "complaint" : "praise");

export function signOffChoices(ownerFirst: string | null, restaurant: string) {
  return [...new Set([ownerFirst ? `${ownerFirst}, ${restaurant}` : null, `The ${restaurant} team`, ownerFirst ? `${ownerFirst} and the team` : null].filter((x): x is string => Boolean(x)))];
}

const card = (q: string, c: Partial<QuestionCardData> & { options: QuestionOption[] }): QuestionCardData => ({
  q,
  multi: false,
  confirm: true,
  skip: true,
  layout: "buttons",
  ...c,
});

// The question as code asks it, with its card. null: not one of code's questions.
export function askFor(id: string, f: Facts, inputs: CardInputs): AskedQuestion | null {
  const r = f.r;
  if (id === "look.logo") {
    if (inputs.logo)
      return {
        text: inputs.logoFromWebsite ? "I found this logo on your website. Shall I use it on your emails, QR codes and Google posts?" : "Is this the logo to use on your emails, QR codes and Google posts?",
        card: card(id, { options: [{ id: "use", label: "Yes, use this logo", short: "Use this logo" }], image: inputs.logo, upload: { accept: "photo", multiple: false, label: "Send a different one" } }),
      };
    return {
      text: "Could you send me your logo as a photo or image file? It goes on your emails, QR codes and Google posts.",
      card: card(id, { options: [], confirm: false, upload: { accept: "photo", multiple: false, label: "Send your logo" } }),
    };
  }
  if (id === "look.colours") {
    const site = inputs.palettes.some((p) => p.from === "website");
    return {
      text: `${site ? "I picked these colours up from your website. " : ""}Which colours should I use? The first goes on buttons, the second on headers and your QR codes.`,
      card: card(id, {
        layout: "swatches",
        options: [
          ...inputs.palettes.map((p, i) => ({ id: p.id, label: p.from === "website" ? `From your website${inputs.palettes.filter((x) => x.from === "website").length > 1 ? ` (${i + 1})` : ""}` : "Our suggestion", short: p.from === "website" ? `Website ${i + 1}` : "Our suggestion", swatches: [p.main, p.second] })),
          { id: OWN_ID, label: "Choose my own", short: "Choose my own" },
        ],
        input: { optionId: OWN_ID, placeholder: "e.g. dark green and cream, or #1B5E20 and #F3E9D2" },
        selected: f.confirmed.has("colours") ? inputs.palettes.filter((p) => p.main === r.brand_color && p.second === r.brand_dark).map((p) => p.id) : undefined,
      }),
    };
  }
  if (id === "look.photos")
    return {
      text: "Would you like to send up to 3 photos of your dishes for your Google posts? It's optional, and you can add more any time.",
      card: card(id, { options: [], confirm: false, upload: { accept: "photo", multiple: true, label: "Send dish photos" } }),
    };
  if (id === "tone.praise" || id === "tone.complaint") {
    const voice = voiceOf(id);
    const options = inputs.toneOptions(voice);
    const lead = voice === "praise" ? (options.real ? "Here's one of your good reviews." : "Here's a typical good review, so we can set your tone.") : options.real ? "Now one of your less happy reviews, for how you handle complaints." : "Now a typical bad review, for how you handle complaints.";
    const picks = (stepState(f.state, "tone").data.picks ?? {}) as Partial<Record<Voice, { tone: string | null; own: boolean }>>;
    const saved = picks[voice];
    return {
      text: `${lead} Which reply sounds most like you?`,
      card: card(id, {
        layout: "cards",
        quote: { ...options.review, real: options.real },
        options: toneCards(inputs.tones, options).map((c) => ({ id: c.id, label: c.title, short: c.short, body: c.body })),
        input: { optionId: OWN, placeholder: "Type how you'd reply" },
        selected: saved ? [saved.own ? OWN : (saved.tone ?? "")] : undefined,
      }),
    };
  }
  if (id === "tone.sign_off") {
    const choices = signOffChoices(inputs.ownerFirst, inputs.restaurantName);
    const saved = typeof r.sign_off_name === "string" ? r.sign_off_name : null;
    return {
      text: "How should I sign your replies to reviews?",
      card: card(id, {
        options: [...choices.map((c, i) => ({ id: `s${i + 1}`, label: c })), { id: OWN_ID, label: "Something else" }],
        input: { optionId: OWN_ID, placeholder: "e.g. Amina and the team" },
        selected: saved ? choices.flatMap((c, i) => (c === saved ? [`s${i + 1}`] : [])) : undefined,
      }),
    };
  }
  if (id === "tone.emoji") {
    const saved = f.confirmed.has("emoji_allowed") ? (JSON.stringify(r.emoji_allowed) === JSON.stringify(EMOJI_NO) ? "no" : "yes") : null;
    return {
      text: "Happy for me to use a couple of emoji in your posts and offer emails? Never in replies to reviews.",
      card: card(id, {
        options: [
          { id: "yes", label: "Yes, a couple is fine", short: "Yes, a couple" },
          { id: "no", label: "No emoji at all", short: "No emoji" },
        ],
        selected: saved ? [saved] : undefined,
      }),
    };
  }
  return null;
}

// What a picked option means, for the answer (and the line code says back).
export function pickedLabel(id: string, picked: string[], f: Facts, inputs: CardInputs, typed?: string | null) {
  if (typed?.trim()) return typed.trim();
  const asked = askFor(id, f, inputs);
  return picked.map((p) => asked?.card.options.find((o) => o.id === p)?.label ?? p).join(", ");
}

export const emojiValue = (choice: string) => (choice === "no" ? EMOJI_NO : EMOJI_YES);

// ---------- The recap ----------

export type StepDetail = (step: FlowStepKey) => string | null;

// One row per question in the chapter: what's saved, or that it was skipped.
export function recapFor(chapter: ChapterKey, f: Facts, inputs: Pick<CardInputs, "tones">, stepDetail: StepDetail): RecapData {
  const c = CHAPTERS[chapter];
  const rows: RecapRow[] = [];
  const toneName = (voice: Voice) => {
    const p = ((stepState(f.state, "tone").data.picks ?? {}) as Partial<Record<Voice, { tone: string | null; own: boolean }>>)[voice];
    return p ? (p.own ? "Your own words" : (inputs.tones.tones.find((t) => t.id === p.tone)?.name ?? "Set")) : "Not set";
  };
  for (const step of c.steps) {
    for (const q of questionsFor(step, f)) {
      if (isRecap(q.id)) continue;
      const res = resolution(q, f);
      if (res === "open") continue;
      const skipped = res === "skipped";
      const r = f.r;
      let value: string;
      let swatches: string[] | undefined;
      if (skipped) value = "Skipped for now";
      else if (q.id === "look.logo") value = "Saved";
      else if (q.id === "look.colours") {
        value = "Saved";
        swatches = [String(r.brand_color ?? ""), String(r.brand_dark ?? "")].filter((x) => /^#[0-9a-f]{6}$/i.test(x));
      } else if (q.id === "look.photos") value = `${Array.isArray(r.photo_library) ? r.photo_library.length : 0} in your library`;
      else if (q.id === "tone.praise") value = toneName("praise");
      else if (q.id === "tone.complaint") value = toneName("complaint");
      else if (q.id === "tone.sign_off") value = String(r.sign_off_name ?? "");
      else if (q.id === "tone.emoji") value = JSON.stringify(r.emoji_allowed) === JSON.stringify(EMOJI_NO) ? "None" : "A couple in posts and emails, never in review replies";
      else value = stepDetail(q.step) ?? "Done";
      rows.push({ q: q.id, label: q.label, value, status: skipped ? "skipped" : "answered", ...(swatches?.length ? { swatches } : {}) });
    }
  }
  const chapters = availableChapters();
  const i = chapters.findIndex((x) => x.key === chapter);
  return { chapter, title: c.title, rows, next: chapters[i + 1]?.title ?? null };
}

export const recapText = (chapter: ChapterKey) => `${CHAPTERS[chapter].title}: that's everything for this chapter. Have a look and check it's all right.`;
