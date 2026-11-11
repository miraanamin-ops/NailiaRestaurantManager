import type { NextRequest } from "next/server";
import { z } from "zod";
import { appError, appJson, withOwner } from "@/lib/app-api";
import { uploadTargets, UploadFiles } from "@/lib/onboarding/dina/upload-targets";

// One-time upload links for files in the app's setup chat (menu photos from the
// camera, a PDF, a till export), as on the website; then POST /api/app/setup with
// action "files" and the paths.
const Body = z.object({ r: z.string().uuid(), files: UploadFiles });

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return appError(400, "bad_files");
    const { r, files } = parsed.data;
    if (!owner.restaurantIds.includes(r)) return appError(403, "not_yours");
    const out = await uploadTargets(r, files);
    return "error" in out ? appJson({ refused: out.error }) : appJson(out);
  });
}
