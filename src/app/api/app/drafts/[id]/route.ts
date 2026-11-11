import type { NextRequest } from "next/server";
import { appError, appJson, withOwner } from "@/lib/app-api";
import { decideFromApp, type Decision } from "@/lib/app/inbox";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Approve, Edit or Skip one draft from the app (and a skip's reason). Only a draft
// of a restaurant this owner may see; the decision runs through the bot's own code.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withOwner(req, async (owner) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return appError(404, "not_found");
    const row = check(await getSupabase().from("drafts").select("restaurant_id").eq("id", id).maybeSingle<{ restaurant_id: string }>());
    if (!row || !owner.restaurantIds.includes(row.restaurant_id)) return appError(404, "not_found");

    const body = (await req.json().catch(() => null)) as { action?: unknown; instructions?: unknown; reason?: unknown } | null;
    const action = String(body?.action ?? "");
    let decision: Decision;
    if (action === "approve" || action === "skip") decision = { action };
    else if (action === "edit" && String(body?.instructions ?? "").trim()) decision = { action, instructions: String(body!.instructions).trim() };
    else if (action === "reason" && String(body?.reason ?? "").trim()) decision = { action, reason: String(body!.reason).trim() };
    else return appError(400, "bad_action");

    const out = await decideFromApp(row.restaurant_id, id, decision);
    if (!out.ok) return appError(out.error === "not_found" ? 404 : 409, out.error);
    return appJson(out);
  });
}
