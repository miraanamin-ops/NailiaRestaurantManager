import type { NextRequest } from "next/server";
import { appError, appJson, withOwner } from "@/lib/app-api";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// The phone's push token (phase 2). POST: register it (or say "still here": each app
// open updates last_seen_at); a token moving to another login moves with it.
// DELETE: log out, so this phone stops getting this login's notifications.
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

async function readToken(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null;
  const token = String(body?.token ?? "");
  const platform = String(body?.platform ?? "");
  return { token: TOKEN.test(token) ? token : null, platform: platform === "ios" || platform === "android" ? platform : null };
}

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const { token, platform } = await readToken(req);
    if (!token || !platform) return appError(400, "bad_token");
    const now = new Date().toISOString();
    check(
      await getSupabase()
        .from("app_devices")
        .upsert({ push_token: token, owner_email: owner.email, platform, last_seen_at: now, disabled_at: null }, { onConflict: "push_token" })
        .select("id"),
    );
    return appJson({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const { token } = await readToken(req);
    if (!token) return appError(400, "bad_token");
    check(
      await getSupabase().from("app_devices").update({ disabled_at: new Date().toISOString() }).eq("push_token", token).eq("owner_email", owner.email).select("id"),
    );
    return appJson({ ok: true });
  });
}
