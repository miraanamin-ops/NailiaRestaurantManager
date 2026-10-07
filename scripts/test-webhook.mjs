// Sends a fake, correctly signed Twilio WhatsApp message to the webhook.
// Usage: node --env-file=.env.local scripts/test-webhook.mjs [url] [message]
import twilio from "twilio";

const url = process.argv[2] ?? "http://localhost:3000/api/whatsapp";
const params = {
  From: "whatsapp:+447700900999", // fake number (Ofcom drama range)
  To: "whatsapp:+14155238886", // Twilio sandbox number
  Body: process.argv[3] ?? "Hi! How are our reviews looking?",
  MessageSid: "SMtest" + Date.now(),
};

const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
  body: new URLSearchParams(params),
});
console.log(res.status, await res.text());
