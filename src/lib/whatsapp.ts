import "server-only";
import twilio from "twilio";

// Quick-reply template with Approve / Edit / Skip buttons. Created in the
// Twilio account automatically the first time it's needed.
const TEMPLATE_NAME = "naila_draft_approval_v1";
// WhatsApp limits: quick-reply message bodies 1024 chars, plain text 1600.
const BUTTON_BODY_MAX = 1024;
const TEXT_MAX = 1600;

export const BUTTON_IDS = { approve: "approve", edit: "edit", skip: "skip" } as const;

export function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

let templateSid: Promise<string> | null = null;

async function findOrCreateTemplate(): Promise<string> {
  const client = getTwilio();
  const existing = (await client.content.v1.contents.list({ pageSize: 100 })).find(
    (c) => c.friendlyName === TEMPLATE_NAME,
  );
  if (existing) return existing.sid;

  // The SDK posts this object as-is, so it uses Twilio's wire format.
  const created = await client.content.v1.contents.create({
    friendly_name: TEMPLATE_NAME,
    language: "en",
    variables: { 1: "Draft text goes here" },
    types: {
      "twilio/quick-reply": {
        body: "{{1}}",
        actions: [
          { title: "Approve", id: BUTTON_IDS.approve },
          { title: "Edit", id: BUTTON_IDS.edit },
          { title: "Skip", id: BUTTON_IDS.skip },
        ],
      },
      "twilio/text": { body: "{{1}}\n\nReply 1 = Approve, 2 = Edit, 3 = Skip" },
    },
  } as never);
  return created.sid;
}

function approvalTemplateSid() {
  templateSid ??= findOrCreateTemplate().catch((err) => {
    templateSid = null; // try again next time
    throw err;
  });
  return templateSid;
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
export async function sendWithApprovalButtons(from: string, to: string, body: string) {
  if (body.length <= BUTTON_BODY_MAX) {
    try {
      const contentSid = await approvalTemplateSid();
      const msg = await getTwilio().messages.create({
        from,
        to,
        contentSid,
        contentVariables: JSON.stringify({ 1: body }),
      });
      return { sid: msg.sid, body, usedButtons: true };
    } catch (err) {
      console.error("Quick-reply buttons failed, falling back to text", err);
    }
  }
  const text = `${clip(body, TEXT_MAX - 60)}\n\nReply *1* Approve · *2* Edit · *3* Skip`;
  const msg = await getTwilio().messages.create({ from, to, body: text });
  return { sid: msg.sid, body: text, usedButtons: false };
}
