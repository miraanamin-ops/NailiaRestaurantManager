import "server-only";
import { randomBytes } from "node:crypto";
import { getSupabase } from "@/lib/supabase";

const BUCKET = "post-photos";
// Claude reads images up to 5 MB; WhatsApp photos are usually well under 1 MB.
const MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type ImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImage(contentType: string | undefined): contentType is ImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(contentType ?? "");
}

// Downloads a photo the owner sent on WhatsApp. Twilio media links need the account login.
export async function downloadTwilioMedia(url: string) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Couldn't download the photo from Twilio (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("That photo is too large (over 5 MB)");
  return bytes;
}

// Saves the photo in Supabase Storage and returns its public address.
export async function savePostPhoto(restaurantId: string, bytes: Buffer, contentType: ImageType) {
  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const path = `${restaurantId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const storage = getSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Couldn't save the photo: ${error.message}`);
  return storage.getPublicUrl(path).data.publicUrl;
}
