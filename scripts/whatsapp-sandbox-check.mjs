// Checks what the Twilio WhatsApp sandbox really shows for Dina's setup chat, on
// your own phone: 3 quick-reply buttons, a list message with 5 rows, and the
// plain numbered text that every choice also carries. Then it waits and prints
// what Twilio says happened to each (delivered, read, or failed with a code).
//
// Your phone must have joined the sandbox and messaged it in the last 24 hours
// (WhatsApp only allows buttons and lists inside that window).
// Usage: node --env-file=.env.local scripts/whatsapp-sandbox-check.mjs +447...
//
// It makes (or reuses) the same templates the app uses, dina_buttons_3_v1 and
// dina_list_5_v1, so keep their shapes in step with dinaTemplate() in src/lib/whatsapp.ts.
import twilio from "twilio";

const to = process.argv[2];
if (!to || !/^\+?\d{10,15}$/.test(to.replace(/\s/g, ""))) {
  console.error("Give your WhatsApp number, e.g. node --env-file=.env.local scripts/whatsapp-sandbox-check.mjs +447700900123");
  process.exit(1);
}
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const from = `whatsapp:${(process.env.TWILIO_WHATSAPP_NUMBER ?? "+14155238886").replace(/^whatsapp:/, "")}`;
const toAddr = `whatsapp:${to.replace(/\s/g, "").replace(/^(?!\+)/, "+")}`;
const ZERO = "00000000-0000-0000-0000-000000000000";

async function template(kind, n) {
  const name = `dina_${kind}_${n}_v1`;
  const existing = (await client.content.v1.contents.list({ pageSize: 100 })).find((c) => c.friendlyName === name);
  if (existing) return existing.sid;
  const variables = { 1: "Which one?" };
  const rows = Array.from({ length: n }, (_, i) => {
    const base = kind === "buttons" ? 2 + i * 2 : 3 + i * 3;
    variables[base] = `Option ${i + 1}`;
    variables[base + 1] = `dina:${ZERO}:o${i + 1}`;
    if (kind === "list") variables[base + 2] = `Or reply ${i + 1}`;
    return base;
  });
  if (kind === "list") variables[2] = "See the options";
  const types =
    kind === "buttons"
      ? { "twilio/quick-reply": { body: "{{1}}", actions: rows.map((b) => ({ title: `{{${b}}}`, id: `{{${b + 1}}}` })) } }
      : { "twilio/list-picker": { body: "{{1}}", button: "{{2}}", items: rows.map((b) => ({ item: `{{${b}}}`, id: `{{${b + 1}}}`, description: `{{${b + 2}}}` })) } };
  const created = await client.content.v1.contents.create({ friendly_name: name, language: "en", variables, types: { ...types, "twilio/text": { body: "{{1}}" } } });
  console.log(`Made template ${name} (${created.sid})`);
  return created.sid;
}

const sent = [];
async function send(label, params) {
  try {
    const m = await client.messages.create({ from, to: toAddr, ...params });
    sent.push({ label, sid: m.sid });
    console.log(`Sent: ${label} (${m.sid})`);
  } catch (err) {
    console.log(`Twilio refused: ${label}: ${err.code ?? ""} ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

const buttons = ["Owner", "Manager", "Skip for now"];
await send("1. three buttons", {
  contentSid: await template("buttons", 3),
  contentVariables: JSON.stringify({
    1: "Sandbox check 1 of 3: three buttons. Are you the owner or the manager?\n\nReply 1, 2 or 3",
    ...Object.fromEntries(buttons.flatMap((t, i) => [[2 + i * 2, t], [3 + i * 2, `dina:${ZERO}:b${i + 1}`]])),
  }),
});

const tones = ["Warm and personal", "Polished and professional", "Fun and chatty", "Short and simple", "Skip for now"];
await send("2. a list with 5 rows", {
  contentSid: await template("list", 5),
  contentVariables: JSON.stringify({
    1: `Sandbox check 2 of 3: a list. Which tone sounds like you?\n\n${tones.map((t, i) => `*${i + 1}* ${t}`).join("\n")}\n\nReply with a number, or tap *See the options*.`,
    2: "See the options",
    ...Object.fromEntries(tones.flatMap((t, i) => [[3 + i * 3, t], [4 + i * 3, `dina:${ZERO}:t${i + 1}`], [5 + i * 3, `Or reply ${i + 1}`]])),
  }),
});

await send("3. plain numbered text", { body: "Sandbox check 3 of 3: plain text, the fallback.\n\nWhich are you?\n*1* Owner\n*2* Manager\n\nReply 1 or 2" });

console.log("\nWaiting 20 seconds for WhatsApp to report back...");
await new Promise((r) => setTimeout(r, 20000));
for (const s of sent) {
  const m = await client.messages(s.sid).fetch();
  console.log(`${s.label}: ${m.status}${m.errorCode ? ` (error ${m.errorCode}: ${m.errorMessage ?? "see twilio.com/docs/api/errors/" + m.errorCode})` : ""}`);
}
console.log("\nNow look at your phone: did 1 show three buttons, and 2 a 'See the options' button that opens a list?");
console.log("(No need to tap them: the sandbox sends taps to the live app as an ordinary message.)");
