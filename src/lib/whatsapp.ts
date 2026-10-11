import "server-only";
import twilio from "twilio";
import { BUTTON_IDS, QUESTION_IDS } from "@/lib/bot/parse";
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
export type ButtonTarget = { draftId: string; briefNumber?: number; buttons?: "approval" | "question" };
const QUESTION_TEMPLATE_NAME = "naila_review_question_v1";

export function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

const templateSids = new Map<string, Promise<string>>();

type TemplateKind = "approval" | "approval_targeted" | "question";
const TEMPLATE_NAMES: Record<TemplateKind, string> = { approval: TEMPLATE_NAME, approval_targeted: TARGETED_TEMPLATE_NAME, question: QUESTION_TEMPLATE_NAME };

async function findOrCreateTemplate(kind: TemplateKind): Promise<string> {
  const client = getTwilio();
  const name = TEMPLATE_NAMES[kind];
  const existing = (await client.content.v1.contents.list({ pageSize: 100 })).find((c) => c.friendlyName === name);
  if (existing) return existing.sid;

  const targeted = kind !== "approval";
  const id = (action: string) => (targeted ? `${action}:{{2}}` : action);
  const buttons =
    kind === "question"
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
  const fallback = kind === "question" ? "Reply PUBLIC, PRIVATE or BOTH" : "Reply 1 = Approve, 2 = Edit, 3 = Skip";
  // The SDK posts this object as-is, so it uses Twilio's wire format.
  const created = await client.content.v1.contents.create({
    friendly_name: name,
    language: "en",
    variables: targeted ? { 1: "Draft text goes here", 2: "00000000-0000-0000-0000-000000000000" } : { 1: "Draft text goes here" },
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
      const contentSid = await templateSid(target?.buttons === "question" ? "question" : target ? "approval_targeted" : "approval");
      const msg = await getTwilio().messages.create({
        from,
        to,
        contentSid,
        contentVariables: JSON.stringify(target ? { 1: body, 2: target.draftId } : { 1: body }),
      });
      return { sid: msg.sid, body, usedButtons: true };
    } catch (err) {
      console.error("Quick-reply buttons failed, falling back to text", err);
    }
  }
  const n = target?.briefNumber;
  const text = target?.buttons === "question"
    ? `${clip(body, TEXT_MAX - 70)}

Reply *PUBLIC*${n ? ` ${n}` : ""} · *PRIVATE*${n ? ` ${n}` : ""} · *BOTH*${n ? ` ${n}` : ""}`
    : n
    ? `${clip(body, TEXT_MAX - 70)}\n\nReply *APPROVE ${n}* · *EDIT ${n}* · *SKIP ${n}*`
    : `${clip(body, TEXT_MAX - 60)}\n\nReply *1* Approve · *2* Edit · *3* Skip`;
  const msg = await getTwilio().messages.create({ from, to, body: text });
  return { sid: msg.sid, body: text, usedButtons: false };
}
