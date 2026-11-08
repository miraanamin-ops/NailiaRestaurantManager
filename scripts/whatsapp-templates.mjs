// The WhatsApp templates for outside the 24-hour window (step 46): creates any
// that are missing in the Twilio account, shows Meta's approval status, and with
// --submit sends the unsubmitted ones to Meta for approval (category UTILITY).
// Wording: src/lib/whatsapp-templates.json (the app creates them the same way).
//   node --env-file=.env.local scripts/whatsapp-templates.mjs            status
//   node --env-file=.env.local scripts/whatsapp-templates.mjs --submit   create + submit
// Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Templates belong to the Twilio
// account, so dev and live share them. Submitting costs nothing.
import { readFileSync } from "node:fs";

const submit = process.argv.includes("--submit");
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
if (!sid || !token) {
  console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
const API = "https://content.twilio.com/v1";

async function call(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    method,
    headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.message ?? text}`);
  return json;
}

const file = JSON.parse(readFileSync(new URL("../src/lib/whatsapp-templates.json", import.meta.url), "utf8"));
const list = [...Object.values(file.templates), ...Object.values(file.other)];

// Same definition as quickReplyTemplate in src/lib/whatsapp.ts.
function definition(t) {
  const button = t.button ?? { title: "Show me", id: file.showButtonId };
  return {
    friendly_name: t.name,
    language: "en",
    variables: t.sample,
    types: {
      "twilio/quick-reply": { body: t.body, actions: [{ title: button.title, id: button.id }] },
      "twilio/text": { body: t.textBody ?? t.body.replace(/ Tap below[^.]*\.$/, " Reply to see it.") },
    },
  };
}

const existing = new Map();
for (let url = "/Content?PageSize=100"; url; ) {
  const page = await call("GET", url);
  for (const c of page.contents ?? []) existing.set(c.friendly_name, c.sid);
  url = page.meta?.next_page_url ?? null;
}

for (const t of list) {
  let contentSid = existing.get(t.name);
  if (!contentSid) {
    if (!submit) {
      console.log(`${t.name}: not created yet`);
      continue;
    }
    contentSid = (await call("POST", "/Content", definition(t))).sid;
    console.log(`${t.name}: created (${contentSid})`);
  }
  const approval = (await call("GET", `/Content/${contentSid}/ApprovalRequests`)).whatsapp ?? {};
  let status = approval.status ?? "unsubmitted";
  if (submit && (status === "unsubmitted" || !approval.status)) {
    const res = await call("POST", `/Content/${contentSid}/ApprovalRequests/whatsapp`, { name: t.name, category: "UTILITY" });
    status = `${res.status ?? "submitted"} (just submitted)`;
  }
  console.log(`${t.name}: ${status}${approval.rejection_reason ? ` (rejected: ${approval.rejection_reason})` : ""}${approval.category && approval.category !== "UTILITY" ? ` [Meta made it ${approval.category}]` : ""}`);
}
