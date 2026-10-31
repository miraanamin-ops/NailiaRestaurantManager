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

type Saved = { saved: (FilePart & Received)[]; refused: Refused[] };

// Checks and saves one file's bytes. The path comes from the message id (and the
// file's place in it), so sending the same message again overwrites the same file.
async function saveOne(out: Saved, input: { restaurantId: string; step: string | null; messageId: string }, n: number, label: string, bytes: Buffer) {
  if (bytes.length > MAX_UPLOAD_BYTES) return void out.refused.push({ reason: "size", label });
  const kind = uploadKind(label, bytes);
  if (!kind) return void out.refused.push({ reason: "type", label });
  const safeId = input.messageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "file";
  const path = `${input.restaurantId}/${input.step ?? "setup"}/${safeId}-${n + 1}.${kind.ext}`;
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, bytes, { contentType: kind.contentType, upsert: true });
  if (error) {
    console.error("Couldn't save a file the owner sent", error.message);
    return void out.refused.push({ reason: "failed", label });
  }
  out.saved.push({ type: "file", path, kind: kind.kind, contentType: kind.contentType, bytes: bytes.length });
}

// Every acceptable file from one WhatsApp message.
export async function saveWhatsAppFiles(input: { restaurantId: string; step: string | null; messageId: string; media: { url: string; contentType: string }[] }) {
  const out: Saved = { saved: [], refused: [] };
  for (const [n, m] of input.media.slice(0, MAX_FILES_PER_MESSAGE).entries()) {
    let bytes: Buffer;
    try {
      bytes = await downloadTwilio(m.url);
    } catch (err) {
      out.refused.push({ reason: err instanceof TooBig ? "size" : "failed", label: m.contentType });
      if (!(err instanceof TooBig)) console.error("Couldn't download a file the owner sent", err);
      continue;
    }
    await saveOne(out, input, n, m.contentType, bytes);
  }
  return out;
}

// Every acceptable file from one web chat upload (already read by the upload route).
export async function saveUploadedFiles(input: { restaurantId: string; step: string | null; messageId: string; files: { type: string; bytes: Buffer }[] }) {
  const out: Saved = { saved: [], refused: [] };
  for (const [n, f] of input.files.slice(0, MAX_FILES_PER_MESSAGE).entries()) await saveOne(out, input, n, f.type, f.bytes);
  return out;
}

// A saved file's bytes, for reading it (a menu). Only from this restaurant's own folder.
export async function readSavedFile(restaurantId: string, path: string) {
  if (!path.startsWith(`${restaurantId}/`)) throw new Error("That file isn't this restaurant's");
  const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn't read a saved file: ${error?.message ?? "missing"}`);
  return Buffer.from(await data.arrayBuffer());
}

// Files the web chat sent straight to the bucket (api/onboarding/upload): only from
// this restaurant's incoming folder, each checked by its own bytes; anything else
// is removed and refused. Kept where they are (the paths are already unguessable).
export async function checkUploadedFiles(restaurantId: string, paths: string[]): Promise<Saved> {
  const out: Saved = { saved: [], refused: [] };
  const storage = getSupabase().storage.from(BUCKET);
  for (const path of paths.slice(0, MAX_FILES_PER_MESSAGE)) {
    if (!path.startsWith(`${restaurantId}/incoming/`) || path.includes("..")) {
      out.refused.push({ reason: "failed", label: "not this restaurant's" });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readSavedFile(restaurantId, path);
    } catch {
      out.refused.push({ reason: "failed", label: path });
      continue;
    }
    const ext = path.split(".").pop() ?? "";
    const label = ext === "xlsx" || ext === "xls" ? "application/vnd.ms-excel" : ext === "csv" ? "text/csv" : "";
    const kind = bytes.length <= MAX_UPLOAD_BYTES ? uploadKind(label, bytes) : null;
    if (!kind) {
      await storage.remove([path]);
      out.refused.push({ reason: bytes.length > MAX_UPLOAD_BYTES ? "size" : "type", label: ext });
      continue;
    }
    out.saved.push({ type: "file", path, kind: kind.kind, contentType: kind.contentType, bytes: bytes.length });
  }
  return out;
}
