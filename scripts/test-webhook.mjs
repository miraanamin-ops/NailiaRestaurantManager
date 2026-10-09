// Sends a fake, correctly signed Twilio WhatsApp message to the webhook.
// Usage: node --env-file=.env.local scripts/test-webhook.mjs [url] [message] [button id: approve|edit|skip] [image url]
// Optional: TEST_FROM=whatsapp:+44... (send as someone else), TEST_SID=SM... (re-send the same message id)
// The fake number only gets through if it's registered as the owner: see settings-snapshot.mjs test.
import twilio from "twilio";

const url = process.argv[2] ?? "http://localhost:3000/api/whatsapp";
const button = process.argv[4] && process.argv[4] !== "-" ? process.argv[4] : undefined; // "-" = no button
const image = process.argv[5];
const params = {
  From: process.env.TEST_FROM ?? "whatsapp:+447700900999", // fake number (Ofcom drama range)
  To: "whatsapp:+14155238886", // Twilio sandbox number
  Body: process.argv[3] ?? "Hi! How are our reviews looking?",
  MessageSid: process.env.TEST_SID ?? "SMtest" + Date.now(),
  ...(button ? { ButtonPayload: button, ButtonText: button[0].toUpperCase() + button.slice(1) } : {}),
  ...(image ? { NumMedia: "1", MediaUrl0: image, MediaContentType0: "image/png" } : {}),
};

const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
  body: new URLSearchParams(params),
});
console.log(res.status, await res.text());
