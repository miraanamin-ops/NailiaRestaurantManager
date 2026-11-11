import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { saveSettings, settingsFor } from "@/lib/app/more";
import type { SettingsInput } from "@/lib/app/settings-rules";

// More > Settings: opening hours, voice, sign-up reward, discount cap, sending hours,
// quiet hours, brief time and notifications. A change is saved through the website's
// own code (UNDO and the activity log work); the answer is the settings as they now are.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    return appJson(settingsFor(r));
  });
}

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    const body = (await req.json().catch(() => null)) as SettingsInput | null;
    if (!body || typeof body !== "object") return appError(400, "bad_settings");
    const out = await saveSettings(r, body);
    if (!out.ok) return appJson({ problem: out.problem });
    return appJson(settingsFor((await ownedRestaurant(owner, r.id))!));
  });
}
