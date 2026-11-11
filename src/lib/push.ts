import "server-only";
import { alertKindOf, alertPrefs } from "@/lib/app/settings-rules";
import { londonMinutes } from "@/lib/clock";
import { check } from "@/lib/drafts";
import type { OpenerRequest } from "@/lib/openers";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { inQuietHours, pushFor, type PushMessage } from "./push-rules";

// Push notifications to the DinerAI app (step 50, phase 2), through Expo's push
// service. An owner with the app gets notifications instead of WhatsApp messages
// (lib/notify.ts messageOwner); owners without it are unchanged. In quiet hours a
// notification arrives silently (no sound or banner, still in the list).
// EXPO_ACCESS_TOKEN: only needed if "enhanced push security" is switched on in Expo.

const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

type Device = { id: string; push_token: string };

export async function devicesFor(ownerEmail: string | null | undefined): Promise<Device[]> {
  if (!ownerEmail) return [];
  const { data, error } = await getSupabase()
    .from("app_devices")
    .select("id, push_token")
    .eq("owner_email", ownerEmail.toLowerCase())
    .is("disabled_at", null)
    .returns<Device[]>();
  if (error) {
    // Before supabase/065: nobody has the app.
    if (error.code === "42P01") return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

async function waitingCount(restaurantId: string) {
  const { count } = await getSupabase().from("drafts").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).eq("status", "pending");
  return count ?? 0;
}

// Sends one notification to every phone of the restaurant's owner. Returns how many phones Expo accepted it for.
export async function pushToOwner(r: Pick<Restaurant, "id" | "owner_email" | "quiet_hours_start" | "quiet_hours_end">, msg: PushMessage, now = new Date()) {
  const devices = await devicesFor(r.owner_email);
  if (!devices.length) return 0;
  const quiet = inQuietHours(londonMinutes(now), r.quiet_hours_start, r.quiet_hours_end);
  const badge = await waitingCount(r.id).catch(() => undefined);
  const messages = devices.map((d) => ({
    to: d.push_token,
    title: msg.title,
    body: msg.body,
    data: { ...msg.data, restaurantId: r.id },
    categoryId: msg.category === "info" ? undefined : msg.category,
    badge,
    sound: quiet ? null : "default",
    priority: msg.urgent && !quiet ? "high" : "normal",
    interruptionLevel: quiet ? "passive" : "active",
    channelId: msg.urgent ? "urgent" : "default",
  }));
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  let accepted = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH, { method: "POST", headers, body: JSON.stringify(batch) });
    const json = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[]; errors?: unknown };
    if (!res.ok || !json.data) throw new Error(`Expo push failed: ${res.status} ${JSON.stringify(json.errors ?? json).slice(0, 200)}`);
    const gone: string[] = [];
    json.data.forEach((ticket, n) => {
      if (ticket.status === "ok") accepted++;
      else if (ticket.details?.error === "DeviceNotRegistered") gone.push(devices[i + n].id);
    });
    // The app was removed from that phone: stop sending to it until it registers again.
    if (gone.length) check(await getSupabase().from("app_devices").update({ disabled_at: now.toISOString() }).in("id", gone).select("id"));
  }
  return accepted;
}

// From messageOwner: a proactive message (it has an opener kind). True = the owner has
// the app and got it as a notification, so WhatsApp is skipped.
export async function pushInsteadOfWhatsApp(restaurantId: string, text: string, request: OpenerRequest) {
  const r = check(
    await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Pick<Restaurant, "id" | "owner_email" | "quiet_hours_start" | "quiet_hours_end"> & { app_alerts?: unknown }>(),
  );
  if (!r || !(await devicesFor(r.owner_email)).length) return false;
  // A redeemed reward or offer doesn't buzz the phone: it's in Today's "done for you".
  if (request === "none") return true;
  // A kind the owner switched off in the app (More > Settings > Notifications): no buzz,
  // and no WhatsApp instead; it waits in the app.
  if (!alertPrefs(r.app_alerts)[alertKindOf(request)]) return true;
  return (await pushToOwner(r, pushFor(request, text))) > 0;
}

// The morning brief for an owner with the app: one notification ("Yesterday £2,340
// (+8% vs last week). 3 things to approve."); the items themselves are in the Inbox.
// True if it went to at least one phone.
export async function pushBrief(r: Restaurant, now: Date) {
  if (!(await devicesFor(r.owner_email)).length) return false;
  // Switched off in the app: the brief's items wait in the Inbox, with no buzz.
  if (!alertPrefs((r as { app_alerts?: unknown }).app_alerts).brief) return true;
  const { waitingDrafts } = await import("@/lib/brief");
  const { londonYmd } = await import("@/lib/clock");
  const { takingsLine } = await import("@/lib/app/cards");
  const { briefPush } = await import("./push-rules");
  const day = (offset: number) => londonYmd(new Date(now.getTime() - offset * 86_400_000));
  const [waiting, sales] = await Promise.all([
    waitingDrafts(r.id),
    getSupabase().from("sales_days").select("day, net_sales").eq("restaurant_id", r.id).in("day", [day(1), day(8)]).returns<{ day: string; net_sales: number }[]>(),
  ]);
  const amount = (d: string) => {
    const row = (sales.data ?? []).find((s) => s.day === d);
    return row ? Number(row.net_sales) : null;
  };
  const t = takingsLine(amount(day(1)), amount(day(8)));
  const firstName = (r.owner_name ?? "").trim().split(/\s+/)[0] || null;
  return (await pushToOwner(r, briefPush({ waiting: waiting.length, takings: t ? `${t.amount}${t.change ? ` (${t.change})` : ""}` : null, firstName }), now)) > 0;
}

// The hourly job, 10am to 7pm: owners whose app hasn't been opened in 3 days get one
// friendly nudge (at most once a week), with an idea if one is waiting.
export async function sendNudges(now = new Date()) {
  const minutes = londonMinutes(now);
  if (minutes < 10 * 60 || minutes >= 19 * 60) return 0;
  const { nudgeDue, nudgePush } = await import("./push-rules");
  const { data: devices, error } = await getSupabase()
    .from("app_devices")
    .select("owner_email, last_seen_at, last_nudge_at")
    .is("disabled_at", null)
    .lt("last_seen_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .returns<{ owner_email: string; last_seen_at: string; last_nudge_at: string | null }[]>();
  if (error) return 0; // before supabase/065
  const owners = new Map<string, { seen: Date; nudged: Date | null }>();
  for (const d of devices ?? []) {
    const o = owners.get(d.owner_email) ?? { seen: new Date(0), nudged: null };
    if (new Date(d.last_seen_at) > o.seen) o.seen = new Date(d.last_seen_at);
    if (d.last_nudge_at && (!o.nudged || new Date(d.last_nudge_at) > o.nudged)) o.nudged = new Date(d.last_nudge_at);
    owners.set(d.owner_email, o);
  }
  let sent = 0;
  for (const [email, o] of owners) {
    if (!nudgeDue(now, o.seen, o.nudged)) continue;
    try {
      const rs = check(await getSupabase().from("restaurants").select("*").eq("owner_email", email).eq("active", true).returns<Restaurant[]>()) ?? [];
      const r = rs[0];
      if (!r) continue;
      // Reminders switched off in the app.
      if (!alertPrefs((r as { app_alerts?: unknown }).app_alerts).nudge) continue;
      const pending = check(
        await getSupabase().from("drafts").select("kind, content").eq("restaurant_id", r.id).eq("status", "pending").returns<{ kind: string; content: string }[]>(),
      ) ?? [];
      const idea = pending.find((d) => d.kind === "special_idea")?.content ?? null;
      if ((await pushToOwner(r, nudgePush(pending.length, idea), now)) > 0) sent++;
      check(await getSupabase().from("app_devices").update({ last_nudge_at: now.toISOString() }).eq("owner_email", email).is("disabled_at", null).select("id"));
    } catch (err) {
      console.error("App nudge failed for one owner", err);
    }
  }
  return sent;
}
