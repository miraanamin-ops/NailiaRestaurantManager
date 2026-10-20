import "server-only";
import twilio from "twilio";
import { BUTTON_IDS, HOURS_IDS, QUESTION_IDS } from "@/lib/bot/parse";
import { clip } from "@/lib/text";

// Quick-reply template with Approve / Edit / Skip buttons. Created in the
// Twilio account automatically the first time it's needed.
const TEMPLATE_NAME = "naila_draft_approval_v1";
// WhatsApp limits: quick-reply message bodies 1024 chars, plain text 1600.
const BUTTON_BODY_MAX = 1024;
const TEXT_MAX = 1600;

// Morning-brief items: each button carries its draft's id ("approve:<id>"),
// so tapping Approve on item 3 approves item 3, whatever else is on screen.
// (Reading the taps back is in lib/bot/parse.ts.)
const TARGETED_TEMPLATE_NAME = "naila_draft_buttons_targeted_v1";
// buttons "question": Reply publicly / Handle privately / Both, for a question
// about a review (ids "public:<id>", "private:<id>", "both:<id>").
// buttons "hours": Same hours / Closed / Different hours, for a question about a
// bank holiday's hours (ids "same:<id>", "closed:<id>", "different:<id>").
// buttons "choice": 2 or 3 options for an unclear message (ids "choose:<id>:<n>", titles from options).
// buttons "idea": Like it / Skip, for a special idea (Draft only). buttons "reasons": one-tap skip reasons.
// buttons "offer": Draft an offer / Not now, for the brief's quiet-night offer (draftId is then
// the forecast_briefs row id; ids "quietoffer:<id>", "noquiet:<id>").
export type ButtonTarget = { draftId: string; briefNumber?: number; buttons?: "approval" | "question" | "hours" | "choice" | "idea" | "reasons" | "offer"; options?: string[] };
const QUESTION_TEMPLATE_NAME = "naila_review_question_v1";
const HOURS_TEMPLATE_NAME = "naila_hours_question_v1";
const CHOICE2_TEMPLATE_NAME = "naila_choice_two_v1";
const CHOICE3_TEMPLATE_NAME = "naila_choice_three_v1";
const IDEA_TEMPLATE_NAME = "naila_special_idea_v1";
const REASONS_TEMPLATE_NAME = "naila_skip_reasons_v1";
const OFFER_TEMPLATE_NAME = "naila_quiet_offer_v1";
// The one-tap skip reasons (lib/agents/gm-rules.ts SKIP_REASONS), in order.
const SKIP_REASON_TITLES = ["Wrong tone", "Wrong offer", "Not now"];

export function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

const templateSids = new Map<string, Promise<string>>();

type TemplateKind = "approval" | "approval_targeted" | "question" | "hours" | "choice2" | "choice3" | "idea" | "reasons" | "offer";
const TEMPLATE_NAMES: Record<TemplateKind, string> = {
  approval: TEMPLATE_NAME,
  approval_targeted: TARGETED_TEMPLATE_NAME,
  question: QUESTION_TEMPLATE_NAME,
  hours: HOURS_TEMPLATE_NAME,
  choice2: CHOICE2_TEMPLATE_NAME,
  choice3: CHOICE3_TEMPLATE_NAME,
  idea: IDEA_TEMPLATE_NAME,
  reasons: REASONS_TEMPLATE_NAME,
  offer: OFFER_TEMPLATE_NAME,
};
const FALLBACKS: Record<TemplateKind, string> = {
  approval: "Reply 1 = Approve, 2 = Edit, 3 = Skip",
  approval_targeted: "Reply 1 = Approve, 2 = Edit, 3 = Skip",
  question: "Reply PUBLIC, PRIVATE or BOTH",
  hours: "Reply SAME, CLOSED or DIFFERENT",
  choice2: "Reply 1 or 2",
  choice3: "Reply 1, 2 or 3",
  idea: "Reply LIKE or SKIP",
  offer: "Reply DRAFT OFFER or NO OFFER",
  reasons: "Reply with a reason, or ignore this",
};

async function findOrCreateTemplate(kind: TemplateKind): Promise<string> {
  const client = getTwilio();
  const name = TEMPLATE_NAMES[kind];
  const existing = (await client.content.v1.contents.list({ pageSize: 100 })).find((c) => c.friendlyName === name);
  if (existing) return existing.sid;

  const targeted = kind !== "approval";
  const id = (action: string) => (targeted ? `${action}:{{2}}` : action);
  const buttons =
    kind === "choice2" || kind === "choice3"
      ? Array.from({ length: kind === "choice2" ? 2 : 3 }, (_, i) => ({ title: `{{${i + 3}}}`, id: `choose:{{2}}:${i + 1}` }))
      : kind === "idea"
      ? [
          { title: "Like it", id: "like:{{2}}" },
          { title: "Skip", id: "skipidea:{{2}}" },
        ]
      : kind === "offer"
      ? [
          { title: "Draft an offer", id: "quietoffer:{{2}}" },
          { title: "Not now", id: "noquiet:{{2}}" },
        ]
      : kind === "reasons"
      ? SKIP_REASON_TITLES.map((title, i) => ({ title, id: `reason:{{2}}:${i + 1}` }))
      : kind === "hours"
      ? [
          { title: "Same hours", id: id(HOURS_IDS.same) },
          { title: "Closed", id: id(HOURS_IDS.closed) },
          { title: "Different hours", id: id(HOURS_IDS.different) },
        ]
      : kind === "question"
      ? [
          { title: "Reply publicly", id: id(QUESTION_IDS.public) },
          { title: "Handle privately", id: id(QUESTION_IDS.private) },
          { title: "Both", id: id(QUESTION_IDS.both) },
        ]
      : [
          { title: "Approve", id: id(BUTTON_IDS.approve) },
          { title: "Edit", id: id(BUTTON_IDS.edit) },
          { title: "Skip", id: id(BUTTON_IDS.skip) },
        ];
  const fallback = FALLBACKS[kind];
  // The SDK posts this object as-is, so it uses Twilio's wire format.
  const created = await client.content.v1.contents.create({
    friendly_name: name,
    language: "en",
    variables: targeted
      ? { 1: "Draft text goes here", 2: "00000000-0000-0000-0000-000000000000", ...(kind === "choice2" || kind === "choice3" ? { 3: "Option one", 4: "Option two", 5: "Option three" } : {}) }
      : { 1: "Draft text goes here" },
    types: {
      "twilio/quick-reply": { body: "{{1}}", actions: buttons },
      "twilio/text": { body: `{{1}}

${fallback}` },
    },
  } as never);
  return created.sid;
}

function templateSid(kind: TemplateKind) {
  const name = TEMPLATE_NAMES[kind];
  let sid = templateSids.get(name);
  if (!sid) {
    sid = findOrCreateTemplate(kind).catch((err) => {
      templateSids.delete(name); // try again next time
      throw err;
    });
    templateSids.set(name, sid);
  }
  return sid;
}

// A picture (e.g. the email preview), with an optional caption. Twilio fetches it from mediaUrl, which must be public.
export async function sendImage(from: string, to: string, mediaUrl: string, caption = "") {
  const msg = await getTwilio().messages.create({ from, to, mediaUrl: [mediaUrl], ...(caption ? { body: clip(caption, TEXT_MAX) } : {}) });
  return { sid: msg.sid, body: caption ? `${caption} [image]` : "[image]" };
}

export async function sendText(from: string, to: string, body: string) {
  const msg = await getTwilio().messages.create({ from, to, body: clip(body, TEXT_MAX) });
  return { sid: msg.sid, body: clip(body, TEXT_MAX) };
}

// Sends a draft with Approve / Edit / Skip buttons (or, for a question about a
// review, Reply publicly / Handle privately / Both). Falls back to asking for a
// typed answer if the buttons can't be used.
export async function sendWithApprovalButtons(from: string, to: string, body: string, target?: ButtonTarget) {
  if (body.length <= BUTTON_BODY_MAX) {
    try {
      const kind: TemplateKind =
        target?.buttons === "choice"
          ? (target.options ?? []).length >= 3
            ? "choice3"
            : "choice2"
          : target?.buttons === "question" || target?.buttons === "hours" || target?.buttons === "idea" || target?.buttons === "reasons" || target?.buttons === "offer"
            ? target.buttons
            : target
              ? "approval_targeted"
              : "approval";
      const contentSid = await templateSid(kind);
      const options = Object.fromEntries((target?.options ?? []).slice(0, 3).map((o, i) => [i + 3, o]));
      const msg = await getTwilio().messages.create({
        from,
        to,
        contentSid,
        contentVariables: JSON.stringify(target ? { 1: body, 2: target.draftId, ...options } : { 1: body }),
      });
      return { sid: msg.sid, body, usedButtons: true };
    } catch (err) {
      console.error("Quick-reply buttons failed, falling back to text", err);
    }
  }
  const n = target?.briefNumber;
  const text = target?.buttons === "choice"
    ? `${clip(body, TEXT_MAX - 120)}

${(target.options ?? []).map((o, i) => `*${i + 1}* ${o}`).join(" · ")}`
    : target?.buttons === "idea"
    ? `${clip(body, TEXT_MAX - 40)}

Reply *LIKE* or *SKIP*`
    : target?.buttons === "offer"
    ? `${clip(body, TEXT_MAX - 50)}

Reply *DRAFT OFFER* or *NO OFFER*`
    : target?.buttons === "reasons"
    ? `${clip(body, TEXT_MAX - 80)}

(Optional) ${SKIP_REASON_TITLES.join(" · ")}`
    : target?.buttons === "hours"
    ? `${clip(body, TEXT_MAX - 70)}\n\nReply *SAME*${n ? ` ${n}` : ""} · *CLOSED*${n ? ` ${n}` : ""} · *DIFFERENT*${n ? ` ${n}` : ""}`
    : target?.buttons === "question"
    ? `${clip(body, TEXT_MAX - 70)}

Reply *PUBLIC*${n ? ` ${n}` : ""} · *PRIVATE*${n ? ` ${n}` : ""} · *BOTH*${n ? ` ${n}` : ""}`
    : n
    ? `${clip(body, TEXT_MAX - 70)}\n\nReply *APPROVE ${n}* · *EDIT ${n}* · *SKIP ${n}*`
    : `${clip(body, TEXT_MAX - 60)}\n\nReply *1* Approve · *2* Edit · *3* Skip`;
  const msg = await getTwilio().messages.create({ from, to, body: text });
  return { sid: msg.sid, body: text, usedButtons: false };
}
