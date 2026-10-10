import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Links that work without logging in, for a limited time, and only for one
// purpose and one thing (e.g. this restaurant's customer export for 1 hour, or
// the preview image of one draft). Signed with LINK_SECRET (or CRON_SECRET).

function secret() {
  const s = process.env.LINK_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("Missing LINK_SECRET or CRON_SECRET");
  return s;
}

const mac = (purpose: string, subject: string, expires: number) =>
  createHmac("sha256", secret()).update(`${purpose}:${subject}:${expires}`).digest("base64url");

export function signLink(purpose: string, subject: string, validForMs: number, now = Date.now()) {
  const expires = Math.floor((now + validForMs) / 1000);
  return `${expires}.${mac(purpose, subject, expires)}`;
}

export function verifyLink(purpose: string, subject: string, token: string | null | undefined, now = Date.now()) {
  const [exp, sig] = (token ?? "").split(".");
  const expires = Number(exp);
  if (!sig || !Number.isFinite(expires) || expires * 1000 < now) return false;
  const want = Buffer.from(mac(purpose, subject, expires));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
