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
    // "Try another look" on an email (lib/email/designs.ts): the next design in its family.
    if (action === "look") {
      const { tryAnotherLook } = await import("@/lib/email/design-store");
      const { LOOK_NAMES } = await import("@/lib/email/designs");
      const next = await tryAnotherLook(row.restaurant_id, id).catch(() => null);
      if (!next) return appError(409, "no_look");
      const { inboxCards } = await import("@/lib/app/inbox");
      const card = (await inboxCards(row.restaurant_id)).find((c) => c.id === id) ?? null;
      return appJson({ ok: true, replies: [`Now showing: ${LOOK_NAMES[next.look]}`], card });
    }
    let decision: Decision;
    if (action === "approve" || action === "skip") decision = { action };
    else if (action === "edit" && String(body?.instructions ?? "").trim()) decision = { action, instructions: String(body!.instructions).trim() };
    else if (action === "reason" && String(body?.reason ?? "").trim()) decision = { action, reason: String(body!.reason).trim() };
    else if (action === "photo" && typeof (body as { path?: unknown } | null)?.path === "string") decision = { action, path: String((body as { path: string }).path) };
    else if (action === "nophoto") decision = { action };
    else return appError(400, "bad_action");

    const out = await decideFromApp(row.restaurant_id, id, decision);
    if (!out.ok) return appError(out.error === "not_found" ? 404 : 409, out.error);
    return appJson(out);
  });
}
