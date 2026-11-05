import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { TillCredentials } from "./types";

// Till logins (tokens, API keys) are stored encrypted (AES-256-GCM) with
// TILL_TOKEN_KEY, or GOOGLE_TOKEN_KEY if that isn't set: 32 random bytes,
// base64. Same format as the Google tokens: "v1.<iv>.<tag>.<ciphertext>".

function key() {
  const raw = process.env.TILL_TOKEN_KEY || process.env.GOOGLE_TOKEN_KEY;
  if (!raw) throw new Error("Missing TILL_TOKEN_KEY (needed to store till logins)");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("TILL_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

export function encryptCredentials(c: TillCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptCredentials(stored: string): TillCredentials {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable stored till login");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as TillCredentials;
}
