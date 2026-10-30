import "server-only";
import { getSupabase } from "@/lib/supabase";
import { MAX_FILES_PER_MESSAGE, MAX_UPLOAD_BYTES, uploadKind, type Received, type Refused, type UploadKind } from "./uploads";

// Saving files the owner sent during setup into the private onboarding-uploads
// bucket (migration 051): never a public link. What's accepted is decided by
// uploads.ts from the file's own bytes; anything else is refused, not kept.

const BUCKET = "onboarding-uploads";

// What's saved with the owner's message, so later steps (menu reading, sales
// import) find the files: { type: "file", path, kind, contentType, bytes }.
export type FilePart = { type: "file"; path: string; kind: UploadKind; contentType: string; bytes: number };
export const isFilePart = (p: unknown): p is FilePart => typeof p === "object" && p !== null && (p as FilePart).type === "file" && typeof (p as FilePart).path === "string";

class TooBig extends Error {}

// Twilio media links need the account login. Stops reading past the limit.
async function downloadTwilio(url: string) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Twilio said ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) throw new TooBig();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new TooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Saves every acceptable file from one WhatsApp message. The path comes from the
// message id, so a repeated delivery overwrites the same files (never doubles them).
export async function saveWhatsAppFiles(input: { restaurantId: string; step: string | null; messageId: string; media: { url: string; contentType: string }[] }) {
  const saved: (FilePart & Received)[] = [];
  const refused: Refused[] = [];
  const storage = getSupabase().storage.from(BUCKET);
  for (const [n, m] of input.media.slice(0, MAX_FILES_PER_MESSAGE).entries()) {
    let bytes: Buffer;
    try {
      bytes = await downloadTwilio(m.url);
    } catch (err) {
      refused.push({ reason: err instanceof TooBig ? "size" : "failed", label: m.contentType });
      if (!(err instanceof TooBig)) console.error("Couldn't download a file the owner sent", err);
      continue;
    }
    const kind = uploadKind(m.contentType, bytes);
    if (!kind) {
      refused.push({ reason: "type", label: m.contentType });
      continue;
    }
    const safeId = input.messageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "file";
    const path = `${input.restaurantId}/${input.step ?? "setup"}/${safeId}-${n + 1}.${kind.ext}`;
    const { error } = await storage.upload(path, bytes, { contentType: kind.contentType, upsert: true });
    if (error) {
      console.error("Couldn't save a file the owner sent", error.message);
      refused.push({ reason: "failed", label: m.contentType });
      continue;
    }
    saved.push({ type: "file", path, kind: kind.kind, contentType: kind.contentType, bytes: bytes.length });
  }
  return { saved, refused };
}
