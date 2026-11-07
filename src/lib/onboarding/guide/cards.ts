import type { QuestionCardData, QuestionOption, RecapData, RecapRow } from "@/components/chat/types";
import { stepState, type FlowStepKey } from "../flow";
import { defaultOptions, OWN, toneCards, type ToneConfig, type ToneOptions, type Voice } from "../dina/tones";
import { EMOJI_NO, EMOJI_YES } from "../dina/details-content";
import { availableChapters, CHAPTERS, type ChapterKey } from "./chapters";
import { questionsFor, isRecap, resolution, type Facts } from "./questions";
import { DEFAULT_PALETTE, type Palette } from "./palette";
import { catalogById, catalogRecap, catalogSelected, type CatalogQuestion } from "./catalog";
import { UK_ALLERGENS, type MenuCategory } from "../profile-data";
import { dishKey } from "../dina/facts-content";

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
  // Signed links to the owner's spreadsheets (the menu costs sheet), when there are.
  templateLinks?: Partial<Record<string, string>>;
};

export type AskedQuestion = { text: string; card: QuestionCardData };

// The inputs, from what's saved: the tone replies prepared on the tone step (else
// the defaults), the logo and colour choices picked up on the look step.
export function inputsFrom(src: { restaurant: Record<string, unknown>; state: Facts["state"]; tones: ToneConfig; templateLinks?: Partial<Record<string, string>> }): CardInputs {
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
    templateLinks: src.templateLinks,
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

// A catalog question's card (guide/catalog.ts).
function catalogCard(q: CatalogQuestion, f: Facts): AskedQuestion {
  const options = q.options?.(f) ?? [];
  return {
    text: q.text(f),
    card: card(q.id, {
      options: options.map((o) => ({ id: o.id, label: o.label, ...(o.short ? { short: o.short } : {}), ...(o.body ? { body: o.body } : {}) })),
      multi: q.kind === "many",
      confirm: q.decision,
      skip: q.skip ?? q.level === "important",
      layout: q.layout ?? "buttons",
      input: q.input ?? null,
      selected: catalogSelected(q, f),
    }),
  };
}

// The grid's columns: the 14 allergens, then the dietary tags.
export const DIETARY = { vegetarian: "Vegetarian", vegan: "Vegan", gluten_free: "Gluten free" } as const;
const SHORT: Record<string, string> = {
  celery: "Celery", "cereals containing gluten": "Gluten", crustaceans: "Crustacea", eggs: "Egg", fish: "Fish", lupin: "Lupin", milk: "Milk",
  molluscs: "Mollusc", mustard: "Mustard", "tree nuts": "Nuts", peanuts: "Peanut", sesame: "Sesame", soya: "Soya", sulphites: "Sulphite",
};
export const GRID_COLUMNS = [
  ...UK_ALLERGENS.map((a) => ({ id: a, label: a.charAt(0).toUpperCase() + a.slice(1), short: SHORT[a] ?? a })),
  ...Object.entries(DIETARY).map(([id, label]) => ({ id: `diet:${id}`, label, short: label === "Gluten free" ? "GF" : label === "Vegetarian" ? "V" : "VG" })),
];

type GridItem = MenuCategory["items"][number] & { dietary?: string[]; signature?: boolean };
const dishOptions = (f: Facts) => ((f.r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items.map((i) => ({ id: dishKey(c.category, i.name), label: i.name })));

export function allergenGrid(f: Facts) {
  const notSure = new Set((stepState(f.state, "menu").data.not_sure as string[] | undefined) ?? []);
  return {
    columns: GRID_COLUMNS,
    rows: ((f.r.menu ?? []) as MenuCategory[]).flatMap((c) =>
      c.items.map((i: GridItem) => {
        const id = dishKey(c.category, i.name);
        return { id, label: i.name, section: c.category, marked: [...(i.allergens ?? []), ...(i.dietary ?? []).map((d) => `diet:${d}`)], suggested: !i.allergens_confirmed, unsure: notSure.has(id) };
      }),
    ),
  };
}

const range = (start: unknown, end: unknown) => (typeof start === "string" && typeof end === "string" ? `${start.slice(0, 5)}-${end.slice(0, 5)}` : null);
export const WINDOWS: Record<string, { label: string; start: string; end: string }> = {
  w9_21: { label: "9am to 9pm", start: "09:00", end: "21:00" },
  w10_21: { label: "10am to 9pm", start: "10:00", end: "21:00" },
  w11_22: { label: "11am to 10pm", start: "11:00", end: "22:00" },
};
export const QUIETS: Record<string, { label: string; start: string; end: string }> = {
  q23_9: { label: "11pm to 9am", start: "23:00", end: "09:00" },
  q22_8: { label: "10pm to 8am", start: "22:00", end: "08:00" },
  q0_10: { label: "Midnight to 10am", start: "00:00", end: "10:00" },
};

// The question as code asks it, with its card. null: not one of code's questions.
export function askFor(id: string, f: Facts, inputs: CardInputs): AskedQuestion | null {
  const r = f.r;
  const cat = catalogById.get(id);
  if (cat) return catalogCard(cat, f);
  if (id === "menu.allergens") {
    const grid = allergenGrid(f);
    return {
      text: `Here are your ${grid.rows.length} dishes with the allergens I've suggested from each dish's name. They're only guesses: tick or untick each one so it's right, mark any dish you're not sure about, then confirm.`,
      card: card(id, { options: [{ id: "grid_ok", label: "These are right", short: "All correct" }], grid, skip: true }),
    };
  }
  if (id === "menu.costs")
    return {
      text: "Roughly what does a dish cost you to make, as a share of its price? An estimate is fine: it shows which dishes make the most, so offers push those and never the thin ones.",
      card: card(id, {
        options: [
          { id: "pct25", label: "About 25% of the price", short: "About 25%" },
          { id: "pct30", label: "About 30% of the price", short: "About 30%" },
          { id: "pct35", label: "About 35% of the price", short: "About 35%" },
          { id: "sheet", label: "I'll fill in the spreadsheet", short: "The spreadsheet" },
        ],
        link: inputs.templateLinks?.menu_costs ? { label: "Download your menu costs sheet", href: inputs.templateLinks.menu_costs } : null,
      }),
    };
  if (id === "menu.top" || id === "menu.slow" || id === "menu.signature") {
    const dishes = dishOptions(f);
    const items = ((r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items.map((i: GridItem & { seller?: string | null }) => ({ id: dishKey(c.category, i.name), seller: i.seller ?? null, signature: Boolean(i.signature) })));
    const selected = items.filter((i) => (id === "menu.signature" ? i.signature : i.seller === (id === "menu.top" ? "top" : "slow"))).map((i) => i.id);
    const text =
      id === "menu.top" ? "Which dishes sell best? Pick up to 5. Not sure is fine." : id === "menu.slow" ? "And which sell least? Pick up to 5." : "Which 3 dishes are you known for, or proudest of? I'll lead with them in posts and offers.";
    return { text, card: card(id, { options: dishes, multi: true, selected }) };
  }
  if (id === "customers.qr")
    return {
      text: "Your QR codes are ready: four table cards and a counter sign that let customers join your list for your sign-up reward. Shall I send them to you?",
      card: card(id, { options: [{ id: "send", label: "Send them to me" }], confirm: false }),
    };
  if (id === "customers.import")
    return {
      text: "Do you already have a list of customers who've agreed to hear from you, for example from your booking system or till? Send it as a CSV or Excel file with their names and emails, and I'll add them.",
      card: card(id, { options: [{ id: "none", label: "I don't have one", short: "Don't have one" }], confirm: false, upload: { accept: "spreadsheet", multiple: false, label: "Send your customer list" } }),
    };
  if (id === "customers.consent") {
    const d = stepState(f.state, "customers_qr").data.import_draft as { count?: number } | undefined;
    return {
      text: `I found ${d?.count ?? 0} customers with an email address. How did they agree to hear from you? I'll only email people who agreed, and each one confirms by email before getting any offers.`,
      card: card(id, {
        options: [
          { id: "agreed", label: "They signed up for our offers or newsletter", short: "They signed up" },
          { id: "not_sure", label: "I'm not sure, or they didn't", short: "Not sure" },
        ],
      }),
    };
  }
  if (id === "working.window") {
    const now = range(r.send_window_start, r.send_window_end);
    return {
      text: "When may I send messages to your customers? Never before 7am or after 10pm.",
      card: card(id, {
        options: Object.entries(WINDOWS).map(([k, w]) => ({ id: k, label: w.label })),
        input: { optionId: OWN_ID, placeholder: "e.g. 10am to 8pm" },
        selected: Object.entries(WINDOWS).filter(([, w]) => `${w.start}-${w.end}` === now).map(([k]) => k),
      }),
    };
  }
  if (id === "working.quiet") {
    const now = range(r.quiet_hours_start, r.quiet_hours_end);
    return {
      text: "And when should I not message you, unless something's urgent like a bad review?",
      card: card(id, {
        options: Object.entries(QUIETS).map(([k, w]) => ({ id: k, label: w.label })),
        input: { optionId: OWN_ID, placeholder: "e.g. 11pm to 8am" },
        selected: Object.entries(QUIETS).filter(([, w]) => `${w.start}-${w.end}` === now).map(([k]) => k),
      }),
    };
  }
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
      else if (catalogById.has(q.id)) value = catalogRecap(catalogById.get(q.id)!, f);
      else if (q.id === "menu.allergens") {
        const items = ((r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items);
        const confirmed = items.filter((i) => i.allergens_confirmed).length;
        value = `${confirmed} of ${items.length} dishes confirmed${confirmed < items.length ? `, ${items.length - confirmed} to check later` : ""}`;
      } else if (q.id === "menu.costs") {
        const items = ((r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items);
        const costed = items.filter((i) => typeof i.cost === "number").length;
        value = costed ? `Costs for ${costed} of ${items.length} dishes (estimates)` : "To fill in on the spreadsheet";
      } else if (q.id === "menu.top" || q.id === "menu.slow" || q.id === "menu.signature") {
        const items = ((r.menu ?? []) as MenuCategory[]).flatMap((c) => c.items as (GridItem & { seller?: string | null })[]);
        const names = items.filter((i) => (q.id === "menu.signature" ? i.signature : i.seller === (q.id === "menu.top" ? "top" : "slow"))).map((i) => i.name);
        value = names.length ? names.join(", ") : "Not sure";
      } else if (q.id === "customers.qr") value = "Sent to you";
      else if (q.id === "customers.import" || q.id === "customers.consent") {
        const d = stepState(f.state, "customers_qr").data as { imported?: number; import_draft?: unknown };
        value = d.imported ? `${d.imported} customers added, each asked to confirm by email` : "No list added";
      } else if (q.id === "working.window") value = `${String(r.send_window_start ?? "09:00").slice(0, 5)} to ${String(r.send_window_end ?? "21:00").slice(0, 5)}`;
      else if (q.id === "working.quiet") value = `${String(r.quiet_hours_start ?? "23:00").slice(0, 5)} to ${String(r.quiet_hours_end ?? "09:00").slice(0, 5)}`;
      else value = stepDetail(q.step) ?? "Done";
      rows.push({ q: q.id, label: q.label, value, status: skipped ? "skipped" : "answered", ...(swatches?.length ? { swatches } : {}) });
    }
  }
  const chapters = availableChapters();
  const i = chapters.findIndex((x) => x.key === chapter);
  return { chapter, title: c.title, rows, next: chapters[i + 1]?.title ?? null };
}

export const recapText = (chapter: ChapterKey) => `${CHAPTERS[chapter].title}: that's everything for this chapter. Have a look and check it's all right.`;
