import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { chatState, focusQuestion } from "@/lib/app/chat";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// "Answer in Chat" from the Inbox: the question goes on screen, in the chat, with its buttons.
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const body = (await req.json().catch(() => null)) as { draftId?: unknown } | null;
    const draftId = typeof body?.draftId === "string" && /^[0-9a-f-]{36}$/i.test(body.draftId) ? body.draftId : null;
    if (!draftId) return appError(400, "bad_draft");
    const r = checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
    const out = await focusQuestion(r, draftId);
    if (!out.ok) return appError(out.error === "not_found" ? 404 : 409, out.error);
    return appJson(await chatState(r));
  });
}
