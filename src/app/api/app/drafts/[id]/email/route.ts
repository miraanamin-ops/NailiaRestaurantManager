import type { NextRequest } from "next/server";
import { appError, appJson, withOwner } from "@/lib/app-api";
import { check } from "@/lib/drafts";
import { LOOK_NAMES, type Look } from "@/lib/email/designs";
import { previewContent } from "@/lib/email/previews";
import { renderEmail } from "@/lib/email/templates";
import { getSupabase } from "@/lib/supabase";

// The app's email page (15 Nov): the real email of a waiting campaign, in its saved look
// or (?look=) another of its family's, so the owner can swipe through them before
// choosing. Nothing is saved here ("Use this look" does that).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withOwner(req, async (owner) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return appError(404, "not_found");
    const row = check(await getSupabase().from("drafts").select("restaurant_id, kind").eq("id", id).maybeSingle<{ restaurant_id: string; kind: string }>());
    if (!row || row.kind !== "email_campaign" || !owner.restaurantIds.includes(row.restaurant_id)) return appError(404, "not_found");
    const content = await previewContent(`draft-${id}`, req.nextUrl.searchParams.get("look"));
    if (!content) return appError(404, "not_found");
    const look = content.design?.look ?? null;
    return appJson({ look, name: look ? LOOK_NAMES[look as Look] : null, html: (await renderEmail(content)).html });
  });
}
