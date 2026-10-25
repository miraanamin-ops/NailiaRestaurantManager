import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Google tokens are stored encrypted (AES-256-GCM) with GOOGLE_TOKEN_KEY: 32
// random bytes, base64 (make one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))").
// Stored as "v1.<iv>.<tag>.<ciphertext>", all base64url. Someone with a copy of
// the database alone can't use a token.

function key() {
  const raw = process.env.GOOGLE_TOKEN_KEY;
  if (!raw) throw new Error("Missing GOOGLE_TOKEN_KEY (needed to store Google logins)");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("GOOGLE_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

export function encryptToken(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(stored: string) {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable stored Google token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
