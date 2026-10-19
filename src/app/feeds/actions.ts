"use server";
import { redirect } from "next/navigation";
import { logAction } from "@/lib/audit";
import { currentOwner } from "@/lib/auth";
import { londonTime } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { AUTHORITIES } from "@/lib/feeds/calendar-dates";
import { confirmDate, runFeedNow } from "@/lib/feeds/builder";
import { FEED_NAMES, type FeedName } from "@/lib/feeds/config";
import { canonicalTeam, manualMatchProblems, manualMatchRow, type Venue } from "@/lib/feeds/football";
import { schoolCalendar } from "@/lib/feeds/jobs";
import { parseTimetable } from "@/lib/feeds/prayer";
import { parseSchoolDatesCsv, schoolDateProblems, type SchoolDate } from "@/lib/feeds/school-terms";
import { removeFeedRows, upsertCalendar, upsertFixtures } from "@/lib/feeds/store";
import { readTermDates } from "@/lib/feeds/term-reader";
import { markRelevance, setTeams } from "@/lib/ops/outside";
import { getSupabase } from "@/lib/supabase";

// The builder's changes to the outside data (/feeds, /feeds/terms, and the
// builder card on /settings). Builder only; every change is in the audit log.
// Owners only change their own teams (settings).

const get = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;

async function builder(next: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!owner.isBuilder) throw new Error("Only the builder can change the outside data");
  return owner;
}
const back = (path: string, msg: string, error = false): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${error ? "error" : "saved"}=${encodeURIComponent(msg)}`);
const log = (restaurantId: string | null, detail: string, data: Record<string, unknown> = {}) =>
  logAction({ restaurantId, actor: "builder", action: "outside_data", detail, data });
const where = (form: FormData) => {
  const r = get(form, "r");
  const page = get(form, "page") || "/feeds";
  return `${page}${UUID.test(r) ? `?r=${r}` : ""}`;
};

export async function toggleFeed(form: FormData) {
  await builder("/feeds");
  const feed = get(form, "feed");
  if (!(FEED_NAMES as readonly string[]).includes(feed)) back(where(form), "Unknown feed", true);
  const enabled = get(form, "enabled") === "yes";
  check(await getSupabase().from("feed_status").update({ enabled, updated_at: new Date().toISOString() }).eq("feed", feed));
  await log(null, `${enabled ? "Switched on" : "Switched off"} the ${feed} feed`, { feed, enabled });
  back(where(form), `The ${feed} feed is ${enabled ? "on" : "off"}.`);
}

export async function runFeedAction(form: FormData) {
  await builder("/feeds");
  const feed = get(form, "feed");
  if (feed !== "all" && !(FEED_NAMES as readonly string[]).includes(feed)) back(where(form), "Unknown feed", true);
  const n = await runFeedNow(feed as FeedName | "all");
  await log(null, `Ran the ${feed} feed now`, { queued: n });
  back(where(form), n ? `Queued ${n} job(s). Refresh in a minute.` : "Nothing to run (switched off, or no active restaurant).");
}

// Confirm an uncertain date: the expected day, the alternative, or a day typed in.
export async function confirmDateAction(form: FormData) {
  const owner = await builder("/feeds");
  const id = get(form, "id");
  const day = get(form, "day");
  if (!UUID.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) back(where(form), "Pick a date to confirm.", true);
  const changes = await confirmDate(id, day, `builder (${owner.email})`);
  back(where(form), `Confirmed: ${changes.map((c) => `${c.name} ${c.after}`).join(", ")}.`);
}

export async function setAuthority(form: FormData) {
  await builder("/settings");
  const r = get(form, "r");
  const authority = get(form, "authority");
  if (!UUID.test(r) || !(AUTHORITIES as readonly string[]).includes(authority)) back(where(form), "Pick an authority.", true);
  const { data: before } = await getSupabase().from("restaurants").select("religious_authority").eq("id", r).maybeSingle<{ religious_authority: string }>();
  check(await getSupabase().from("restaurants").update({ religious_authority: authority }).eq("id", r));
  await log(r, `Ramadan and Eid now follow ${authority}`, { field: "religious_authority", before: before?.religious_authority ?? null, after: authority });
  back(where(form), "Saved.");
}

// A mosque's timetable (CSV) for one restaurant: replaces any earlier timetable on the days it covers.
export async function uploadTimetable(form: FormData) {
  await builder("/feeds");
  const r = get(form, "r");
  const mosque = get(form, "mosque").slice(0, 60);
  if (!UUID.test(r) || !mosque) back(where(form), "Name the mosque and pick the restaurant.", true);
  const file = form.get("file");
  const csv = file instanceof File && file.size ? await file.text() : get(form, "csv");
  if (!csv) back(where(form), "Choose the CSV file (or paste it).", true);
  const { rows, problems } = parseTimetable(csv, mosque);
  if (problems.length) back(where(form), `Not saved: ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? ` (${problems.length - 5} more)` : ""}`, true);
  const supabase = getSupabase();
  const days = rows.map((x) => x.day);
  // One timetable at a time: another mosque's rows on these days go.
  check(await supabase.from("prayer_times").delete().eq("restaurant_id", r).like("method", "timetable:%").neq("method", `timetable:${mosque}`).in("day", days));
  const fetched_at = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    check(
      await supabase
        .from("prayer_times")
        .upsert(rows.slice(i, i + 500).map((p) => ({ restaurant_id: r, ...p, source: "builder", fetched_at })), { onConflict: "restaurant_id,day,method" }),
    );
  }
  await log(r, `Uploaded ${mosque}'s timetable: ${rows.length} days, ${days[0]} to ${days.at(-1)}`, { mosque, days: rows.length, from: days[0], to: days.at(-1) });
  back(where(form), `${mosque}'s timetable saved: ${rows.length} days. It's used instead of the calculated times on those days.`);
}

export async function removeTimetable(form: FormData) {
  await builder("/feeds");
  const r = get(form, "r");
  if (!UUID.test(r)) back(where(form), "Pick the restaurant.", true);
  const { data } = await getSupabase().from("prayer_times").delete().eq("restaurant_id", r).like("method", "timetable:%").select("day");
  await log(r, `Removed the mosque timetable (${data?.length ?? 0} days); the calculated times are used again`);
  back(where(form), "Timetable removed.");
}

async function venueList(): Promise<Venue[]> {
  const rows = check(await getSupabase().from("venues").select("id, name, latitude, longitude, capacity, typical_crowd, teams").returns<Venue[]>()) ?? [];
  return rows.map((v) => ({ ...v, latitude: Number(v.latitude), longitude: Number(v.longitude) }));
}

// A match the free feeds don't have: cricket internationals, England friendlies, qualifiers, Nations League.
export async function addMatch(form: FormData) {
  await builder("/feeds");
  const local = get(form, "kickoff"); // London time from the form
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  const kickoff = m ? londonTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).toISOString() : "";
  const match = { sport: get(form, "sport") === "football" ? ("football" as const) : ("cricket" as const), competition: get(form, "competition"), home: get(form, "home"), away: get(form, "away"), kickoff, venueId: get(form, "venue") || null };
  const problem = manualMatchProblems(match);
  if (problem) back(where(form), `Not saved: ${problem}.`, true);
  const row = manualMatchRow(match, await venueList(), new Date().toISOString());
  await upsertFixtures([row]);
  await log(null, `Added ${row.name} (${row.competition}, ${row.sport}) at ${local} UK time`, { match: row.external_id });
  back(where(form), `Added ${row.name}.`);
}

export async function removeMatch(form: FormData) {
  await builder("/feeds");
  const id = get(form, "external_id");
  const n = await removeFeedRows("builder", [id]);
  await log(null, `Removed the match ${id}`, { match: id });
  back(where(form), n ? "Removed." : "Nothing removed.");
}

// A disruption day the free feeds don't have (National Rail strikes and the like).
export async function addDisruption(form: FormData) {
  await builder("/feeds");
  const name = get(form, "name").slice(0, 120);
  const day = get(form, "day");
  const end = get(form, "end_day") || null;
  const region = get(form, "region") === "england" ? "england" : "london";
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(day) || (end && end < day)) back(where(form), "Name it and give its first (and last) day.", true);
  const id = `disruption:${day}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  await upsertCalendar([{ external_source: "builder", external_id: id, day, end_day: end, name, type: "disruption", scope: "regional", region, source: "builder" }]);
  await log(null, `Added the disruption "${name}" (${day}${end ? ` to ${end}` : ""}, ${region})`, { id });
  back(where(form), `Added ${name}.`);
}

export async function removeBuilderRow(form: FormData) {
  await builder("/feeds");
  const id = get(form, "external_id");
  const n = await removeFeedRows("builder", [id]);
  await log(null, `Removed ${id}`, { id });
  back(where(form), n ? "Removed." : "Nothing removed.");
}

export async function saveVenue(form: FormData) {
  await builder("/feeds");
  const id = get(form, "id");
  const num = (k: string) => (get(form, k) ? Math.round(Number(get(form, k))) : null);
  const patch = { typical_crowd: num("typical_crowd"), capacity: num("capacity") };
  if ((patch.typical_crowd !== null && !(patch.typical_crowd > 0)) || (patch.capacity !== null && !(patch.capacity > 0))) back(where(form), "Crowds must be whole numbers above 0.", true);
  const supabase = getSupabase();
  if (UUID.test(id)) {
    check(await supabase.from("venues").update(patch).eq("id", id));
    await log(null, `Venue crowd changed`, { venue: id, ...patch });
  } else {
    const name = get(form, "name").slice(0, 80);
    const lat = Number(get(form, "latitude"));
    const lon = Number(get(form, "longitude"));
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) back(where(form), "A new venue needs a name, latitude and longitude.", true);
    const { error } = await supabase.from("venues").insert({ name, kind: "other", latitude: lat, longitude: lon, ...patch, source: "builder" });
    if (error) back(where(form), error.code === "23505" ? "There's already a venue with that name." : error.message, true);
    await log(null, `Added the venue ${name}`, { name, lat, lon, ...patch });
  }
  back(where(form), "Venue saved. The next events run uses it.");
}

// Whether a nearby event matters to this restaurant (empty = not decided, counts as yes).
export async function setRelevance(form: FormData) {
  await builder("/feeds");
  const r = get(form, "r");
  const event = get(form, "event");
  const v = get(form, "relevant");
  if (!UUID.test(r) || !UUID.test(event)) back(where(form), "Pick an event.", true);
  const relevant = v === "yes" ? true : v === "no" ? false : null;
  await markRelevance(r, event, relevant, "builder");
  await log(r, `Marked an event ${relevant === null ? "undecided" : relevant ? "relevant" : "not relevant"}`, { event, relevant });
  back(where(form), "Saved.");
}

// ---------- School dates (/feeds/terms) ----------

const termsPage = (code: string) => `/feeds/terms${code ? `?council=${encodeURIComponent(code)}` : ""}`;

async function saveSchoolDates(rows: SchoolDate[], by: string) {
  const now = new Date().toISOString();
  check(
    await getSupabase()
      .from("school_dates")
      .upsert(rows.map((r) => ({ ...r, source: "builder", confirmed_by: by, confirmed_at: now })), { onConflict: "council_code,kind,start_day" }),
  );
  return schoolCalendar();
}

export async function addCouncil(form: FormData) {
  await builder("/feeds/terms");
  const code = get(form, "code").toUpperCase();
  const name = get(form, "name").slice(0, 60);
  if (!/^[EWSN]\d{8}$/.test(code) || !name) back(termsPage(""), "A council needs its ONS code (e.g. E09000025) and name.", true);
  check(await getSupabase().from("councils").upsert({ code, name, term_dates_url: get(form, "url") || null }, { onConflict: "code" }));
  await log(null, `Added the council ${name} (${code})`, { code });
  back(termsPage(code), `${name} added.`);
}

export async function importSchoolDates(form: FormData) {
  const owner = await builder("/feeds/terms");
  const code = get(form, "council");
  const { rows, problems } = parseSchoolDatesCsv(get(form, "csv"), code);
  if (problems.length || !rows.length) back(termsPage(code), problems.length ? `Not saved: ${problems.slice(0, 4).join(" ")}` : "Nothing to save.", true);
  const out = await saveSchoolDates(rows, `builder (${owner.email})`);
  await log(null, `Saved ${rows.length} school date row(s) for ${code}`, { council: code, rows: rows.length });
  back(termsPage(code), `Saved ${rows.length} row(s); ${out.school_rows} holiday rows made.`);
}

export async function deleteSchoolDate(form: FormData) {
  await builder("/feeds/terms");
  const code = get(form, "council");
  const id = get(form, "id");
  if (!UUID.test(id)) back(termsPage(code), "Pick a row.", true);
  check(await getSupabase().from("school_dates").delete().eq("id", id).eq("council_code", code));
  await schoolCalendar();
  await log(null, `Deleted a school date row for ${code}`, { council: code, id });
  back(termsPage(code), "Deleted.");
}

// Claude reads a council page or PDF; the rows wait for the builder to tick them.
export async function readCouncilPage(form: FormData) {
  await builder("/feeds/terms");
  const code = get(form, "council");
  const url = get(form, "url");
  const { data: council } = await getSupabase().from("councils").select("name").eq("code", code).maybeSingle<{ name: string }>();
  if (!council || !/^https?:\/\//.test(url)) back(termsPage(code), "Pick the council and paste the page's address (https://...).", true);
  let read: Awaited<ReturnType<typeof readTermDates>>;
  try {
    read = await readTermDates(url, council!.name, code);
  } catch (err) {
    back(termsPage(code), `Couldn't read it: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  check(await getSupabase().from("school_date_drafts").insert({ council_code: code, url, rows: read!.rows, notes: read!.notes }));
  await log(null, `Claude read ${read!.rows.length} school date row(s) for ${council!.name} from ${url} (waiting for the builder)`, { council: code, url });
  back(termsPage(code), `Claude found ${read!.rows.length} row(s). Tick the ones that are right and save.`);
}

export async function confirmDraftRows(form: FormData) {
  const owner = await builder("/feeds/terms");
  const code = get(form, "council");
  const draftId = get(form, "draft");
  const { data: draft } = await getSupabase().from("school_date_drafts").select("rows").eq("id", draftId).eq("council_code", code).maybeSingle<{ rows: (SchoolDate & { problem: string | null })[] }>();
  if (!draft) back(termsPage(code), "That reading isn't there any more.", true);
  const chosen: SchoolDate[] = draft!.rows
    .filter((_, i) => form.get(`row_${i}`) === "yes")
    .map((r) => ({ council_code: code, kind: r.kind, start_day: r.start_day, end_day: r.end_day, half_term_start: r.half_term_start ?? null, half_term_end: r.half_term_end ?? null, academic_year: r.academic_year, notes: r.notes ?? null }));
  const bad = chosen.map(schoolDateProblems).filter(Boolean);
  if (bad.length) back(termsPage(code), `A ticked row has a problem: ${bad[0]} Untick it or fix it by CSV.`, true);
  if (chosen.length) await saveSchoolDates(chosen, `builder (${owner.email}), read by Claude`);
  check(await getSupabase().from("school_date_drafts").delete().eq("id", draftId));
  await log(null, `Confirmed ${chosen.length} of ${draft!.rows.length} school date row(s) Claude read for ${code}`, { council: code, confirmed: chosen.length });
  back(termsPage(code), `Saved ${chosen.length} row(s).`);
}

// ---------- The owner's teams (settings) ----------

export async function saveTeams(form: FormData) {
  const owner = await currentOwner();
  const r = get(form, "r");
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/settings?r=${r}`)}`);
  if (!owner.restaurantIds.includes(r)) throw new Error("Not your restaurant");
  const { data: known } = await getSupabase().from("football_fixtures").select("home_team").limit(1000).returns<{ home_team: string }[]>();
  const names = [...new Set((known ?? []).map((k) => k.home_team))];
  const teams = [...new Set(get(form, "teams").split(/[,\n]/).map((t) => canonicalTeam(t, names)).filter(Boolean))].slice(0, 12);
  const { data: before } = await getSupabase().from("restaurant_teams").select("team").eq("restaurant_id", r).returns<{ team: string }[]>();
  await setTeams(r, teams, owner.isBuilder ? "builder" : "manual");
  await logAction({ restaurantId: r, actor: owner.isBuilder ? "builder" : "owner", action: "outside_data", detail: `Teams set to ${teams.join(", ") || "none"}`, data: { field: "restaurant_teams", before: (before ?? []).map((b) => b.team), after: teams } });
  redirect(`/settings?r=${r}&saved=teams`);
}
