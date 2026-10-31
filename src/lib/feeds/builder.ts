import "server-only";
import { logAction } from "@/lib/audit";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { kickWorkers } from "@/lib/queue/kick";
import { enqueue } from "@/lib/queue/store";
import { getSupabase } from "@/lib/supabase";
import { addDays, AUTHORITY_LABEL, type Authority } from "./calendar-dates";
import { FEEDS, feedProblem, type FeedName } from "./config";
import { BUILDER_HELP, parseBuilderCommand, resolveDateWord, type ConfirmKind } from "./builder-parse";
import { feedStatuses } from "./status";

// What the builder does to the outside data, from /feeds or by WhatsApp
// (BUILDER ... from BUILDER_WHATSAPP): confirm an uncertain date, run a feed
// now. Every change is in the audit log as the builder.

type CalRow = {
  id: string;
  day: string;
  end_day: string | null;
  name: string;
  type: string;
  authority: string | null;
  date_uncertain: boolean;
  alt_day: string | null;
  external_source: string | null;
  external_id: string | null;
  confirmed_at: string | null;
  notes: string | null;
};
const COLUMNS = "id, day, end_day, name, type, authority, date_uncertain, alt_day, external_source, external_id, confirmed_at, notes";

const KIND_OF: Record<Exclude<ConfirmKind, "eid">, string> = { eid_fitr: "Eid al-Fitr", eid_adha: "Eid al-Adha", ramadan: "Ramadan", diwali: "Diwali" };

// The uncertain date a confirmation is about: the next one of that kind (from a
// week ago to 90 days ahead), for the authority. "Eid" is whichever Eid is next.
export async function findConfirmable(what: ConfirmKind, authority: Authority, today: string) {
  const names = what === "eid" ? ["Eid al-Fitr", "Eid al-Adha"] : [KIND_OF[what]];
  const rows =
    check(
      await getSupabase()
        .from("local_calendar")
        .select(COLUMNS)
        .is("restaurant_id", null)
        .in("name", names)
        .gte("day", addDays(today, -7))
        .lte("day", addDays(today, 90))
        .order("day")
        .returns<CalRow[]>(),
    ) ?? [];
  return rows.find((r) => (r.type === "cultural" || r.authority === authority) && !r.confirmed_at) ?? rows.find((r) => r.type === "cultural" || r.authority === authority) ?? null;
}

// Confirms a date: the row moves to it, is no longer uncertain, and records who
// confirmed it (a feed never changes it back). Eid al-Fitr also moves the
// night before (chand raat) and the end of Ramadan.
export async function confirmDate(rowId: string, day: string, by: string) {
  const supabase = getSupabase();
  const row = check(await supabase.from("local_calendar").select(COLUMNS).eq("id", rowId).is("restaurant_id", null).maybeSingle<CalRow>());
  if (!row) throw new Error("That calendar date isn't there any more.");
  const now = new Date().toISOString();
  const confirmed = { date_uncertain: false, alt_day: null, alt_probability: null, confirmed_at: now, confirmed_by: by, updated_at: now };
  const changes: { name: string; before: string; after: string }[] = [];
  const move = async (r: CalRow, newDay: string) => {
    check(await supabase.from("local_calendar").update({ day: newDay, ...confirmed }).eq("id", r.id).is("restaurant_id", null));
    changes.push({ name: r.name, before: r.day, after: newDay });
  };
  // Ramadan's start moves; its end stays the day before Eid.
  await move(row, day);
  if (row.name === "Eid al-Fitr" && row.external_id) {
    const [authority, , hijriYear] = row.external_id.split(":");
    const related = check(
      await supabase
        .from("local_calendar")
        .select(COLUMNS)
        .is("restaurant_id", null)
        .eq("external_source", "religious")
        .in("external_id", [`${authority}:ramadan:${hijriYear}`, `${authority}:chand_raat:${hijriYear}`])
        .returns<CalRow[]>(),
    ) ?? [];
    for (const r of related) {
      if (r.name === "Chand raat") await move(r, addDays(day, -1));
      else {
        // Ramadan ends the day before Eid; its start stays as it was (confirmed or not).
        check(await supabase.from("local_calendar").update({ end_day: addDays(day, -1), updated_at: now }).eq("id", r.id).is("restaurant_id", null));
        changes.push({ name: "Ramadan (last day)", before: r.end_day ?? r.day, after: addDays(day, -1) });
      }
    }
  }
  await logAction({
    restaurantId: null,
    actor: "builder",
    action: "outside_data",
    detail: `Confirmed ${row.name}${row.authority ? ` (${AUTHORITY_LABEL[row.authority as Authority] ?? row.authority})` : ""} on ${day}`,
    data: { field: "local_calendar", row: row.id, changes, by },
  });
  return changes;
}

// Runs a feed now: its job(s) queued with a fresh key, and workers started.
export async function runFeedNow(feed: FeedName | "all", now = new Date()) {
  const { plannedFeedJobs } = await import("./config");
  const { enabledFeeds } = await import("./status");
  const restaurants =
    check(await getSupabase().from("restaurants").select("id, weather_cell").eq("active", true).returns<{ id: string; weather_cell: string | null }[]>()) ?? [];
  const enabled = await enabledFeeds();
  const stamp = now.toISOString();
  const planned = plannedFeedJobs("daily", now, restaurants.map((r) => ({ id: r.id, weatherCell: r.weather_cell })), enabled).filter(
    (p) => feed === "all" || p.type === FEEDS[feed].jobType,
  );
  let queued = 0;
  for (const p of planned) {
    if (await enqueue({ type: p.type, restaurantId: p.restaurantId, key: `${p.key}:now:${stamp}`, payload: p.payload })) queued++;
  }
  await kickWorkers(Math.min(3, Math.max(1, queued)));
  return queued;
}

// A builder command from WhatsApp: the reply to send back. Logged in the audit log.
export async function handleBuilderCommand(body: string, now = new Date()): Promise<string> {
  const cmd = parseBuilderCommand(body);
  const log = (detail: string, data: Record<string, unknown> = {}) =>
    logAction({ restaurantId: null, actor: "builder", action: "builder_command", detail, data: { command: body.slice(0, 200), ...data } });
  switch (cmd.kind) {
    case "help":
      await log("BUILDER HELP");
      return BUILDER_HELP;
    case "feeds": {
      await log("BUILDER FEEDS");
      const lines = (await feedStatuses()).map((s) => {
        const problem = feedProblem(s, now);
        const last = s.last_success_at ? `ok ${s.last_success_at.slice(0, 16).replace("T", " ")} UTC` : "never ok yet";
        const state = !s.enabled ? "switched off" : problem ? `⚠️ ${problem}` : s.last_outcome === "skipped" ? `skipped: ${String(s.last_detail?.skipped ?? "")}` : last;
        return `${FEEDS[s.feed]?.label ?? s.feed}: ${state}`;
      });
      return ["🛰️ *Outside data feeds*", ...lines].join("\n");
    }
    case "run": {
      const n = await runFeedNow(cmd.feed as FeedName | "all", now);
      await log(`BUILDER RUN ${cmd.feed.toUpperCase()}`, { queued: n });
      return n ? `▶️ Queued ${n} job(s) for ${cmd.feed === "all" ? "every feed" : FEEDS[cmd.feed as FeedName].label}. Results on /log under "Outside data".` : "Nothing to run (the feed is switched off, or there's no active restaurant).";
    }
    case "confirm": {
      const today = londonYmd(now);
      const row = await findConfirmable(cmd.what, cmd.authority, today);
      if (!row) {
        await log(`BUILDER confirm: nothing found (${cmd.what})`);
        return `I can't find an upcoming ${cmd.what === "eid" ? "Eid" : KIND_OF[cmd.what]} for ${AUTHORITY_LABEL[cmd.authority]} in the next 90 days.`;
      }
      const day = resolveDateWord(cmd.date, row.day, today);
      await log(`BUILDER confirm ${row.name}: ${day ?? "day not understood"}`, { row: row.id, day });
      if (!day) return `That day isn't within 3 days of ${row.name}'s expected date (${row.day}). Send the date, e.g. "BUILDER EID CONFIRMED 10 MAR".`;
      const changes = await confirmDate(row.id, day, "builder (WhatsApp)");
      return `✅ ${row.name}${row.authority ? ` (${AUTHORITY_LABEL[row.authority as Authority]})` : ""} confirmed for ${day}.${changes.length > 1 ? ` Also moved: ${changes.slice(1).map((c) => `${c.name} to ${c.after}`).join(", ")}.` : ""} The 07:00 forecast refresh uses it.`;
    }
    case "google_accepted": {
      const { getSupabase } = await import("@/lib/supabase");
      const q = cmd.restaurant;
      const bySlug = await getSupabase().from("restaurants").select("id, name, slug").eq("slug", q.toLowerCase()).returns<{ id: string; name: string; slug: string }[]>();
      const found = bySlug.data?.length ? bySlug.data : ((await getSupabase().from("restaurants").select("id, name, slug").ilike("name", q.replace(/[%_]/g, "")).returns<{ id: string; name: string; slug: string }[]>()).data ?? []);
      if (!found.length) return `I can't find a restaurant called "${q}". Use its link name (e.g. ember-spice) or its exact name.`;
      if (found.length > 1) return `More than one restaurant is called "${q}": use its link name (${found.map((f) => f.slug).join(", ")}).`;
      const { markGoogleAccepted } = await import("@/lib/onboarding/dina/google-step");
      const text = await markGoogleAccepted(found[0].id, { by: "builder" });
      await log(`BUILDER GOOGLE ACCEPTED ${found[0].name}`, { restaurant: found[0].id });
      return `✅ ${found[0].name}: Google step done. Dina told the owner: "${text}"`;
    }
    default:
      await log("BUILDER (not understood)");
      return `I didn't understand that builder command.\n\n${BUILDER_HELP}`;
  }
}
