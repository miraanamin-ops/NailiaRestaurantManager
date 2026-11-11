import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { prepareUpload, UploadRefused } from "@/lib/app/chat";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// A photo or file for the chat, step 1: checks its kind and size, and hands back a
// one-time link to put it straight into the private bucket. Step 2 is the chat
// message that carries it (POST /api/app/chat with `file`).
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const body = (await req.json().catch(() => null)) as { name?: unknown; contentType?: unknown; size?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
    const size = Number(body?.size);
    if (!name || !Number.isFinite(size)) return appError(400, "bad_file");
    const r = checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
    try {
      return appJson(await prepareUpload(r, { name, contentType: typeof body?.contentType === "string" ? body.contentType : null, size }));
    } catch (err) {
      if (err instanceof UploadRefused) return appJson({ refused: err.message });
      throw err;
    }
  });
}
