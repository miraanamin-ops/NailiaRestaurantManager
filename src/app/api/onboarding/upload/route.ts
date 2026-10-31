import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentOwner } from "@/lib/auth";
import { MAX_FILES_PER_MESSAGE, MAX_UPLOAD_BYTES } from "@/lib/onboarding/dina/uploads";
import { limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";

// Files from the web chat (a menu's photos or PDF, a till export) can be bigger than
// a request to our server allows (about 4.5 MB on Vercel), so the browser sends each
// one straight to the private onboarding-uploads bucket with a one-time link from
// here, then tells the chat which files arrived (chat route, action "files"), where
// each is checked by its own bytes before anything reads it.
// Only the restaurant's owner (or the builder); at most 10 files, 16 MB each, and
// 30 files a restaurant per 10 minutes.

const Body = z.object({
  r: z.string().uuid(),
  files: z.array(z.object({ name: z.string().max(200), size: z.number().int().min(1), type: z.string().max(120) })).min(1).max(MAX_FILES_PER_MESSAGE),
});

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "text/csv": "csv" };

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Please log in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't look right." }, { status: 400 });
  const { r, files } = parsed.data;
  if (!owner.restaurantIds.includes(r)) return Response.json({ error: "Not your restaurant." }, { status: 403 });
  const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (big) return Response.json({ error: `"${big.name}" is over 16 MB. Could you send a smaller copy, or a photo of each page?` }, { status: 400 });
  if (await overLimit([{ key: limitKey("dina-upload", r), max: 30, windowMs: 10 * MINUTE }])) {
    return Response.json({ error: "That's a lot of files in a short time. Give it a few minutes." }, { status: 429 });
  }
  const storage = getSupabase().storage.from("onboarding-uploads");
  const targets = [];
  for (const f of files) {
    const ext = EXT[f.type] ?? (/\.xlsx$/i.test(f.name) ? "xlsx" : /\.xls$/i.test(f.name) ? "xls" : "bin");
    const path = `${r}/incoming/${randomUUID()}.${ext}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return Response.json({ error: "Couldn't start the upload. Please try again." }, { status: 500 });
    targets.push({ path, url: data.signedUrl });
  }
  return Response.json({ targets });
}
