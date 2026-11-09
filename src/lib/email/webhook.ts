// Resend's webhooks (email events) are signed the Svix way: HMAC-SHA256 of
// "<svix-id>.<svix-timestamp>.<body>" with the endpoint's secret ("whsec_..."),
// base64, in svix-signature ("v1,<sig> v1,<sig>"). Plain code, unit-tested
// (tests/customer-import.test.ts).
import { createHmac, timingSafeEqual } from "node:crypto";

// A signature older or newer than this is refused (a replayed event).
export const WEBHOOK_TOLERANCE_S = 5 * 60;

export function signWebhook(secret: string, id: string, timestamp: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifyWebhook(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > WEBHOOK_TOLERANCE_S) return false;
  const want = Buffer.from(signWebhook(secret, headers.id, headers.timestamp, body));
  return headers.signature.split(" ").some((part) => {
    const sig = Buffer.from(part.replace(/^v1,/, ""));
    return sig.length === want.length && timingSafeEqual(sig, want);
  });
}

// A hard bounce (the address doesn't exist), not a temporary one (a full inbox).
export type BounceEvent = { address: string; emailId: string | null };

export function hardBounceFrom(event: unknown): BounceEvent | null {
  const e = event as { type?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string } } };
  if (e?.type !== "email.bounced" || !e.data) return null;
  const kind = (e.data.bounce?.type ?? "").toLowerCase();
  if (kind && !/permanent|hard/.test(kind)) return null;
  const to = Array.isArray(e.data.to) ? e.data.to[0] : e.data.to;
  return to?.includes("@") ? { address: to.trim().toLowerCase(), emailId: e.data.email_id ?? null } : null;
}
