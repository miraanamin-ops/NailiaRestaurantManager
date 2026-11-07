import type { ChatComponent, ChatMessage } from "@/components/chat/types";

// Dina on WhatsApp: her checked messages drawn as WhatsApp messages, and the
// owner's replies (a tap, a number, the option's own words, "skip") read back
// to what they answered. Plain code, unit-tested (tests/dina-whatsapp.test.ts);
// whatsapp-turn.ts sends and receives. The web chat draws the same messages as
// components (view.ts), so both channels show one conversation.
//
// What Twilio allows in a live chat (no Meta approval needed, only inside the
// 24-hour window, which every reply to the owner is):
//   quick-reply buttons: at most 3, titles at most 20 characters
//   list message: at most 10 rows, titles at most 24, a description of at most 72, a menu button of at most 20
//   body: 1,024 characters with buttons or a list, 1,600 for plain text
// Every message with choices also says them as numbers ("Reply 1, 2 or 3"),
// so typing a number always works, whatever the phone shows.

export const WA = { buttons: 3, buttonTitle: 20, rows: 10, rowTitle: 24, rowDescription: 72, listButton: 20, interactiveBody: 1024, text: 1600 } as const;

export type WaOption = { id: string; title: string; description: string };
export type WaOut =
  // mediaUrl: a picture sent with the text (a screenshot), from our public address.
  | { kind: "text"; body: string; mediaUrl?: string }
  | { kind: "buttons"; body: string; options: WaOption[] }
  | { kind: "list"; body: string; button: string; options: WaOption[] };

// A tap carries "dina:<message id>:<option id>", so it answers that message
// whatever came after it.
export const payloadFor = (messageId: string, optionId: string) => `dina:${messageId}:${optionId}`;
const SKIP: Choice = { id: "skip", label: "Skip for now" };
const LIST_BUTTON = "See the options";

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

type Choice = { id: string; label: string; description?: string };

// The choices a message offers, in order (a confirmation card's are its two buttons).
export function choicesOf(c: ChatComponent | null | undefined): Choice[] {
  if (!c) return [];
  if (c.type === "quick_replies") return c.options.map((o) => ({ id: o.id, label: o.short ?? o.label }));
  if (c.type === "choice_cards") return c.cards.map((card) => ({ id: card.id, label: card.short ?? card.title, description: card.body }));
  if (c.type === "steps" || c.type === "dish_check") return c.actions.map((a) => ({ id: a.id, label: a.short ?? a.label }));
  if (c.type === "confirmation")
    return [
      { id: "confirm", label: "Looks right" },
      { id: "change", label: "Change something" },
    ];
  // Code's question cards: each option (a reply in a tone keeps its text as the
  // description), then "Skip this question".
  if (c.type === "question")
    return [
      ...c.card.options.map((o) => ({ id: o.id, label: o.short ?? o.label, description: o.body ?? (o.swatches ? o.swatches.join(" and ") : undefined) })),
      ...(c.card.skip ? [{ id: QUESTION_SKIP, label: "Skip this question", description: "Move on; we can come back to it" }] : []),
    ];
  // A recap: "Looks right", then Change for each line.
  if (c.type === "recap") return [{ id: "recap_ok", label: "Looks right" }, ...c.recap.rows.map((r) => ({ id: `change:${r.q}`, label: `Change: ${r.label}`.slice(0, 40), description: r.value }))];
  return [];
}

// Matches guide/cards.ts SKIP_ID (kept apart: this file has no imports).
export const QUESTION_SKIP = "skip_q";

const numbers = (n: number) => (n === 1 ? "1" : `${Array.from({ length: n - 1 }, (_, i) => i + 1).join(", ")} or ${n}`);

// One message with choices: buttons when there are 3 or fewer and every title
// fits on a button, otherwise a list. Always with the numbers as text.
function withChoices(text: string, messageId: string, choices: Choice[]): WaOut {
  const options = choices.map((c, i) => ({
    id: payloadFor(messageId, c.id),
    title: c.label,
    description: clip(c.description ?? `Or reply ${i + 1}`, WA.rowDescription),
  }));
  if (choices.length <= WA.buttons && choices.every((c) => c.label.length <= WA.buttonTitle)) {
    const tail = `\n\nReply ${numbers(choices.length)}`;
    return { kind: "buttons", body: clip(text, WA.interactiveBody - tail.length) + tail, options };
  }
  const listed = choices.slice(0, WA.rows);
  const tail = `\n\n${listed.map((c, i) => `*${i + 1}* ${c.label}`).join("\n")}\n\nReply with a number, or tap *${LIST_BUTTON}*.`;
  return {
    kind: "list",
    body: clip(text, WA.interactiveBody - tail.length) + tail,
    button: LIST_BUTTON,
    options: options.slice(0, WA.rows).map((o) => ({ ...o, title: clip(o.title, WA.rowTitle) })),
  };
}

const UPLOAD_HOW: Record<Extract<ChatComponent, { type: "upload" }>["accept"], string> = {
  photo: "Send me a photo of each page here.",
  document: "Send me the PDF here, or a photo of each page.",
  spreadsheet: "Send me the CSV or Excel file here.",
  any: "Send it here: photos, PDFs, and CSV or Excel files all work.",
};

// Dina's messages from one turn, as WhatsApp messages. skippable: the step she's
// on can be skipped, so the last question also offers "Skip for now".
// appUrl: our public address, for screenshots and links (Twilio fetches pictures from it).
export function renderForWhatsApp(messages: ChatMessage[], opts: { skippable: boolean; chatUrl: string; appUrl: string }): WaOut[] {
  const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${opts.appUrl}${path}`);
  const out: WaOut[] = [];
  const lastAsking = [...messages].reverse().find((m) => choicesOf(m.component).length);
  const lastAskingIndex = lastAsking ? messages.indexOf(lastAsking) : -1;
  messages.forEach((m, i) => {
    const c = m.component;
    let choices = choicesOf(c);
    if (opts.skippable && i === lastAskingIndex && c?.type !== "confirmation" && c?.type !== "question" && c?.type !== "recap" && !choices.some((x) => x.id === SKIP.id)) choices = [...choices, SKIP];
    const isLast = i === messages.length - 1;
    // No choices to add it to: say it, but only under a question or a request for a file (not after every line).
    const asks = c?.type === "upload" || m.text.includes("?");
    const skipLine = opts.skippable && isLast && lastAskingIndex === -1 && asks ? "\n\nOr reply *SKIP* to leave this for now." : "";

    if (c?.type === "choice_cards") {
      // One card per message (never a wall of text), then the choice itself.
      if (m.text) out.push({ kind: "text", body: clip(m.text, WA.text) });
      if (c.quote) {
        const stars = "★".repeat(c.quote.rating) + "☆".repeat(5 - c.quote.rating);
        const typical = c.quote.real ? "" : "\n\n_A typical review, to set your tone._";
        out.push({ kind: "text", body: clip(`*${c.quote.author}* ${stars}\n"${c.quote.text}"${typical}`, WA.text) });
      }
      c.cards.forEach((card, n) => out.push({ kind: "text", body: clip(`*${n + 1}. ${card.title}*\n${card.body}`, WA.text) }));
      out.push(withChoices("Which one?", m.id, choices));
    } else if (c?.type === "steps") {
      // Each step on its own with its screenshot, then the buttons.
      if (m.text) out.push({ kind: "text", body: clip(m.text, WA.text) });
      for (const st of c.steps) out.push({ kind: "text", body: clip(`*${st.n}.* ${st.text}${st.link ? `\n${st.link.href}` : ""}`, WA.text), ...(st.image ? { mediaUrl: abs(st.image) } : {}) });
      // The email on its own too, so it's easy to copy.
      for (const st of c.steps) if (st.copy) out.push({ kind: "text", body: st.copy });
      out.push(withChoices(`${c.note}\n\nTell me when it's done.`, m.id, choices));
    } else if (c?.type === "forward") {
      // The message alone, so it can be forwarded as it is.
      out.push({ kind: "text", body: clip(`${m.text}\n\n${c.intro}`, WA.text) });
      out.push({ kind: "text", body: clip(c.text, WA.text) });
    } else if (c?.type === "link") {
      const hint = c.hint ? `\n\n${c.hint}` : "";
      out.push({ kind: "text", body: clip(`${m.text}${hint}\n\n${c.label}: ${abs(c.href)}`, WA.text) });
    } else if (c?.type === "confirmation") {
      // A card with a picture (the logo): the picture first, on its own.
      if (c.card.image) out.push({ kind: "text", body: `*${c.card.title}*`, mediaUrl: abs(c.card.image) });
      const rows = c.card.fields.map((f) => `${f.label}: ${f.value?.trim() ? f.value : "not given yet"}`);
      const all = `${m.text}\n\n*${c.card.title}*\n${rows.join("\n")}`;
      if (all.length <= WA.interactiveBody - 40) out.push(withChoices(all, m.id, choices));
      else {
        // A long card (a whole menu): the rows in as many messages as it takes, then the question with its buttons.
        let chunk = `*${c.card.title}*`;
        for (const row of rows) {
          if (chunk.length + row.length + 1 > WA.text - 20) {
            out.push({ kind: "text", body: chunk });
            chunk = "";
          }
          chunk += `${chunk ? "\n" : ""}${row}`;
        }
        if (chunk) out.push({ kind: "text", body: chunk });
        out.push(withChoices(m.text, m.id, choices));
      }
    } else if (c?.type === "dish_check") {
      // Code's own allergen cards already say the dish; Dina's first one gets it added.
      const said = m.text.includes(c.dish);
      const line = `*${c.dish}* (${c.section}), dish ${c.position} of ${c.total}. Suggested: ${c.suggested.length ? c.suggested.join(", ") : "none of the 14"}.`;
      out.push(withChoices(said ? m.text : `${m.text}\n\n${line}`, m.id, choices));
    } else if (c?.type === "summary") {
      const s = c.summary;
      const lines = [
        m.text,
        `Setup ${s.done} of ${s.total} done.`,
        ...s.items.map((it) => `✅ ${it.title}: ${it.detail}`),
        ...(s.locked.length ? ["", "For later:", ...s.locked.map((l) => `• ${l.title}: ${l.unlock}`)] : []),
        "",
        `Everything is here too: ${opts.chatUrl}`,
      ];
      out.push({ kind: "text", body: clip(lines.join("\n"), WA.text) });
    } else if (c?.type === "question") {
      const card = c.card;
      // A picture first (the logo to check), then the review being answered, then each reply.
      if (card.image) out.push({ kind: "text", body: "*Your logo*", mediaUrl: abs(card.image) });
      if (card.quote) {
        const stars = "★".repeat(card.quote.rating) + "☆".repeat(5 - card.quote.rating);
        out.push({ kind: "text", body: clip(`*${card.quote.author}* ${stars}\n"${card.quote.text}"`, WA.text) });
      }
      if (card.layout === "cards") card.options.forEach((o, n) => o.body && out.push({ kind: "text", body: clip(`*${n + 1}. ${o.label}*\n${o.body}`, WA.text) }));
      // The allergen grid as text: each dish and what's marked, in as many messages as it takes.
      if (card.grid) {
        const cols = new Map(card.grid.columns.map((col) => [col.id, col.label]));
        const rows = card.grid.rows.map((r) => `*${r.label}*: ${r.unsure ? "not sure" : r.marked.map((x) => cols.get(x) ?? x).join(", ") || "none of the 14"}`);
        let chunk = "";
        for (const row of rows) {
          if (chunk.length + row.length + 1 > WA.text - 40) {
            out.push({ kind: "text", body: chunk });
            chunk = "";
          }
          chunk += `${chunk ? "\n" : ""}${row}`;
        }
        if (chunk) out.push({ kind: "text", body: chunk });
      }
      const upload = card.upload ? `\n\n${card.upload.accept === "spreadsheet" ? "Send the CSV or Excel file here." : card.upload.multiple ? "Send the photos here." : "Send it here as a photo."}` : "";
      const link = card.link ? `\n\n${card.link.label}: ${abs(card.link.href)}` : "";
      const words = card.input && card.options.length ? "\n\nOr type your own." : "";
      const several = card.multi ? "\n\nReply with all the numbers that apply, for example 1, 3." : "";
      const gridHow = card.grid ? `\n\nTell me any changes in your own words, like "Lamb chops: add sesame", or check them on the web: ${opts.chatUrl}` : "";
      if (choices.length) out.push(withChoices(`${m.text}${gridHow}${upload}${link}${words}${several}`, m.id, choices));
      else out.push({ kind: "text", body: clip(`${m.text}${upload}${link}`, WA.text) });
    } else if (c?.type === "recap") {
      const rows = c.recap.rows.map((r) => `${r.status === "skipped" ? "⏭" : "✅"} ${r.label}: ${r.value}${r.swatches?.length ? ` (${r.swatches.join(", ")})` : ""}`);
      out.push({ kind: "text", body: clip(`${m.text}\n\n*${c.recap.title}*\n${rows.join("\n")}`, WA.text) });
      out.push(withChoices("All right, or anything to change?", m.id, choices));
    } else if (c?.type === "upload") {
      out.push({ kind: "text", body: clip(`${m.text}\n\n${UPLOAD_HOW[c.accept]}`, WA.text - skipLine.length) + skipLine });
    } else if (choices.length) {
      out.push(withChoices(m.text, m.id, choices));
    } else {
      out.push({ kind: "text", body: clip(m.text, WA.text - skipLine.length) + skipLine });
    }
  });
  return out;
}

// ---------- Reading replies ----------

// The question a reply can answer: the last message from Dina that offered
// choices, if the owner hasn't written anything since.
export type Asking = { messageId: string; component: ChatComponent | null | undefined };

export type WaReply =
  | { kind: "answer"; messageId: string; choiceId: string; label: string }
  | { kind: "confirm"; messageId: string }
  | { kind: "skip" }
  | { kind: "text"; text: string };

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[*_~.!,?"'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const SKIP_WORDS = new Set(["skip", "skip for now", "skip this", "skip it", "later", "not now"]);

export function readWhatsAppReply(input: { body: string; buttonPayload?: string | null; listId?: string | null }, asking: Asking | null, skippable: boolean): WaReply {
  const body = input.body.trim();
  const tapped = (input.buttonPayload || input.listId || "").match(/^dina:([0-9a-f-]{36}):(.+)$/i);
  if (tapped) return choose(tapped[1], tapped[2], asking?.messageId === tapped[1] ? asking.component : null, body);

  if (skippable && SKIP_WORDS.has(norm(body))) return { kind: "skip" };
  if (!asking) return { kind: "text", text: body };

  const choices = choicesOf(asking.component);
  const own = asking.component?.type === "question" || asking.component?.type === "recap";
  const offered = skippable && asking.component?.type !== "confirmation" && !own ? [...choices, SKIP] : choices;
  const n = /^\d{1,2}$/.test(norm(body)) ? Number(norm(body)) : NaN;
  const picked = Number.isInteger(n) && n >= 1 && n <= offered.length ? offered[n - 1] : offered.find((c) => norm(c.label) === norm(body));
  if (picked) return choose(asking.messageId, picked.id, asking.component, picked.label);
  return { kind: "text", text: body };
}

function choose(messageId: string, choiceId: string, component: ChatComponent | null | undefined, fallbackLabel: string): WaReply {
  if (choiceId === SKIP.id) return { kind: "skip" };
  // A card's two buttons (or a tap on an older card, whose message isn't the one asking now).
  if (component?.type === "confirmation" || (!component && (choiceId === "confirm" || choiceId === "change"))) {
    if (choiceId === "confirm") return { kind: "confirm", messageId };
    if (choiceId === "change") return { kind: "answer", messageId, choiceId, label: "Change something" };
  }
  const label = choicesOf(component).find((c) => c.id === choiceId)?.label ?? fallbackLabel;
  return { kind: "answer", messageId, choiceId, label: label || choiceId };
}
