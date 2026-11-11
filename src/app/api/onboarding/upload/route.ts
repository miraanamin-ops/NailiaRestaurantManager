import { z } from "zod";
import { currentOwner } from "@/lib/auth";
import { uploadTargets, UploadFiles } from "@/lib/onboarding/dina/upload-targets";

// One-time upload links for files in the web chat with Dina (lib/onboarding/dina/upload-targets.ts).
// Only the restaurant's owner (or the builder).

const Body = z.object({ r: z.string().uuid(), files: UploadFiles });

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Please log in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't look right." }, { status: 400 });
  const { r, files } = parsed.data;
  if (!owner.restaurantIds.includes(r)) return Response.json({ error: "Not your restaurant." }, { status: 403 });
  const out = await uploadTargets(r, files);
  return "error" in out ? Response.json({ error: out.error }, { status: out.status }) : Response.json(out);
}
