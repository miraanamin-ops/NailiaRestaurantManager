import "server-only";
import twilio from "twilio";

// Quick-reply template with Approve / Edit / Skip buttons. Created in the
// Twilio account automatically the first time it's needed.
const TEMPLATE_NAME = "naila_draft_approval_v1";
// WhatsApp limits: quick-reply message bodies 1024 chars, plain text 1600.
const BUTTON_BODY_MAX = 1024;
const TEXT_MAX = 1600;

export const BUTTON_IDS = { approve: "approve", edit: "edit", skip: "skip" } as const;

// Morning-brief items: each button carries its draft's id ("approve:<id>"),
// so tapping Approve on item 3 approves item 3, whatever else is on screen.
const TARGETED_TEMPLATE_NAME = "naila_draft_buttons_targeted_v1";
export type ButtonTarget = { draftId: string; briefNumber: number };

export function parseButtonPayload(payload: string | undefined) {
  const m = payload?.match(/^(approve|edit|skip):([0-9a-f-]{36})$/);
  return m ? { action: m[1] as keyof typeof BUTTON_IDS, draftId: m[2] } : null;
}

export function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

const templateSids = new Map<string, Promise<string>>();

async function findOrCreateTemplate(name: string, targeted: boolean): Promise<string> {
  const client = getTwilio();
  const existing = (await client.content.v1.contents.list({ pageSize: 100 })).find((c) => c.friendlyName === name);
  if (existing) return existing.sid;

  const id = (action: string) => (targeted ? `${action}:{{2}}` : action);
  // The SDK posts this object as-is, so it uses Twilio's wire format.
  const created = await client.content.v1.contents.create({
    friendly_name: name,
    language: "en",
    variables: targeted ? { 1: "Draft text goes here", 2: "00000000-0000-0000-0000-000000000000" } : { 1: "Draft text goes here" },
    types: {
      "twilio/quick-reply": {
        body: "{{1}}",
        actions: [
          { title: "Approve", id: id(BUTTON_IDS.approve) },
          { title: "Edit", id: id(BUTTON_IDS.edit) },
          { title: "Skip", id: id(BUTTON_IDS.skip) },
        ],
      },
      "twilio/text": { body: "{{1}}\n\nReply 1 = Approve, 2 = Edit, 3 = Skip" },
    },
  } as never);
  return created.sid;
}

function templateSid(targeted: boolean) {
  const name = targeted ? TARGETED_TEMPLATE_NAME : TEMPLATE_NAME;
  let sid = templateSids.get(name);
  if (!sid) {
    sid = findOrCreateTemplate(name, targeted).catch((err) => {
      templateSids.delete(name); // try again next time
      throw err;
    });
    templateSids.set(name, sid);
  }
  return sid;
}

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export async function sendText(from: string, to: string, body: string) {
  const msg = await getTwilio().messages.create({ from, to, body: clip(body, TEXT_MAX) });
  return { sid: msg.sid, body: clip(body, TEXT_MAX) };
}

// Sends a draft with Approve / Edit / Skip buttons. Falls back to asking for
// 1 / 2 / 3 as plain text if the buttons can't be used.
export async function sendWithApprovalButtons(from: string, to: string, body: string, target?: ButtonTarget) {
  if (body.length <= BUTTON_BODY_MAX) {
    try {
      const contentSid = await templateSid(Boolean(target));
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
  const text = n
    ? `${clip(body, TEXT_MAX - 70)}\n\nReply *APPROVE ${n}* · *EDIT ${n}* · *SKIP ${n}*`
    : `${clip(body, TEXT_MAX - 60)}\n\nReply *1* Approve · *2* Edit · *3* Skip`;
  const msg = await getTwilio().messages.create({ from, to, body: text });
  return { sid: msg.sid, body: text, usedButtons: false };
}
