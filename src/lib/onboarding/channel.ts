// Which WhatsApp number owners talk to, and (while we're on Twilio's sandbox)
// the phrase they must send first. No imports, so pages and the bot share it.
//   TWILIO_WHATSAPP_NUMBER  our number, e.g. whatsapp:+14155238886 (default: the sandbox)
//   TWILIO_SANDBOX_JOIN     the sandbox's join phrase, e.g. "join happy-tiger"
//                           (Twilio console > Messaging > Try it out > Send a WhatsApp message)

export const SANDBOX_NUMBER = "whatsapp:+14155238886";

export function ourWhatsAppNumber() {
  const n = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
  return n ? (n.startsWith("whatsapp:") ? n : `whatsapp:${n}`) : SANDBOX_NUMBER;
}

export function isSandbox() {
  return ourWhatsAppNumber() === SANDBOX_NUMBER;
}

export function sandboxJoinPhrase() {
  return process.env.TWILIO_SANDBOX_JOIN?.trim() || null;
}
