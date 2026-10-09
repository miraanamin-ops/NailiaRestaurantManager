// Checks whether WhatsApp quick-reply buttons work: makes sure the approval
// template exists, sends it to the owner's phone, then reports delivery status.
// Usage: node --env-file=.env.local scripts/test-buttons.mjs
import twilio from "twilio";
import { createClient } from "@supabase/supabase-js";

const TEMPLATE_NAME = "naila_draft_approval_v1"; // keep in sync with src/lib/whatsapp.ts

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Owner's number = whoever last messaged the sandbox.
const { data: last, error } = await supabase
  .from("messages")
  .select("from_number, to_number")
  .eq("direction", "inbound")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
if (error) throw error;

let template = (await client.content.v1.contents.list({ pageSize: 100 })).find(
  (c) => c.friendlyName === TEMPLATE_NAME,
);
if (!template) {
  template = await client.content.v1.contents.create({
    friendly_name: TEMPLATE_NAME,
    language: "en",
    variables: { 1: "Draft text goes here" },
    types: {
      "twilio/quick-reply": {
        body: "{{1}}",
        actions: [
          { title: "Approve", id: "approve" },
          { title: "Edit", id: "edit" },
          { title: "Skip", id: "skip" },
        ],
      },
      "twilio/text": { body: "{{1}}\n\nReply 1 = Approve, 2 = Edit, 3 = Skip" },
    },
  });
  console.log("Created template", template.sid);
} else {
  console.log("Template exists", template.sid);
}

const msg = await client.messages.create({
  from: last.to_number,
  to: last.from_number,
  contentSid: template.sid,
  contentVariables: JSON.stringify({ 1: process.argv[2] ?? "🧪 Test from Naila: do these buttons show up? (No need to tap them.)" }),
});
console.log("Sent", msg.sid, msg.status);

for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const m = await client.messages(msg.sid).fetch();
  console.log("status:", m.status, m.errorCode ?? "", m.errorMessage ?? "");
  if (["delivered", "read", "failed", "undelivered"].includes(m.status)) break;
}
