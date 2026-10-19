import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { pickRestaurantId, requireOwner, restaurantChoices } from "@/lib/auth";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { FORECAST_ARCHIVE_KEY } from "@/lib/feeds/backfill";
import { addDays, AUTHORITY_LABEL, type Authority } from "@/lib/feeds/calendar-dates";
import { FEEDS, feedProblem, type FeedName } from "@/lib/feeds/config";
import { coverageFor } from "@/lib/feeds/coverage-data";
import { feedStatuses, type FeedStatus } from "@/lib/feeds/status";
import { getSupabase } from "@/lib/supabase";
import { Card } from "../onboarding/ui";
import {
  addDisruption, addMatch, confirmDateAction, removeBuilderRow, removeMatch, removeTimetable, runFeedAction, saveVenue, setRelevance, toggleFeed, uploadTimetable,
} from "./actions";

export const metadata: Metadata = { title: "Outside data", robots: { index: false, follow: false } };

// The outside data feeds, for the builder: each feed's health and switch, what
// the forecast has for a restaurant, and what the builder adds by hand (confirmed
// dates, mosque timetables, matches, disruption, venues, which events matter).
export default function FeedsPage({ searchParams }: PageProps<"/feeds">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Feeds searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-lg px-3 py-1.5 text-sm font-medium text-stone-900 ring-1 ring-stone-300";
const field = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";
const h2 = "text-lg font-bold";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";

type Cal = { id: string; day: string; end_day: string | null; name: string; type: string; authority: string | null; date_uncertain: boolean; alt_day: string | null; confirmed_at: string | null; confirmed_by: string | null; external_id: string | null; region: string | null; notes: string | null; expected_size: number | null };

async function Feeds({ searchParams }: Pick<PageProps<"/feeds">, "searchParams">) {
  await connection();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner("/feeds");
  if (!owner.isBuilder) return <p className="p-6">This page is for the builder.</p>;
  const r = pickRestaurantId(owner, one("r"));
  const supabase = getSupabase();
  const today = londonYmd(new Date());

  let statuses: FeedStatus[] = [];
  try {
    statuses = await feedStatuses();
  } catch {
    return <p className="p-6">Run supabase/041_outside_feeds.sql in Supabase first.</p>;
  }
  const choices = await restaurantChoices(owner);
  const [cov, uncertain, matches, disruption, venues, archive, timetable, events, builderLog] = await Promise.all([
    r ? coverageFor(r).catch(() => null) : null,
    supabase.from("local_calendar").select("id, day, end_day, name, type, authority, date_uncertain, alt_day, confirmed_at, confirmed_by, external_id, region, notes, expected_size")
      .is("restaurant_id", null).in("type", ["religious", "cultural"]).or("date_uncertain.eq.true,confirmed_at.not.is.null").gte("day", addDays(today, -7)).lte("day", addDays(today, 150)).order("day").returns<Cal[]>(),
    supabase.from("local_calendar").select("id, day, name, external_id, notes").is("restaurant_id", null).eq("external_source", "builder").in("type", ["sport", "football"]).gte("day", today).order("day").limit(40).returns<Cal[]>(),
    supabase.from("local_calendar").select("id, day, end_day, name, external_id, region").is("restaurant_id", null).eq("external_source", "builder").eq("type", "disruption").gte("day", addDays(today, -1)).order("day").returns<Cal[]>(),
    supabase.from("venues").select("id, name, capacity, typical_crowd, ticketmaster_id").order("name").returns<{ id: string; name: string; capacity: number | null; typical_crowd: number | null; ticketmaster_id: string | null }[]>(),
    supabase.from("cached_data").select("data").eq("key", FORECAST_ARCHIVE_KEY).maybeSingle<{ data: { day?: string } }>(),
    r ? supabase.from("prayer_times").select("day, method").eq("restaurant_id", r).like("method", "timetable:%").order("day").returns<{ day: string; method: string }[]>() : null,
    r ? supabase.from("calendar_relevance").select("event_id, distance_m, relevant, marked_by").eq("restaurant_id", r).returns<{ event_id: string; distance_m: number | null; relevant: boolean | null; marked_by: string | null }[]>() : null,
    supabase.from("audit_log").select("id, detail, created_at").is("restaurant_id", null).in("action", ["builder_command", "outside_data"]).order("created_at", { ascending: false }).limit(12).returns<{ id: string; detail: string; created_at: string }[]>(),
  ]);
  const rel = (events && check(events)) ?? [];
  const nearEvents = rel.length
    ? (check(await supabase.from("local_calendar").select("id, day, end_day, name, type, expected_size").is("restaurant_id", null).in("id", rel.map((x) => x.event_id).slice(0, 300)).gte("day", today).lte("day", addDays(today, 60)).order("day").limit(60).returns<Cal[]>()) ?? [])
    : [];
  const tt = (timetable && check(timetable)) ?? [];
  const restaurantName =
    choices.find((c) => c.id === r)?.name ??
    (r ? (check(await supabase.from("restaurants").select("name").eq("id", r).maybeSingle<{ name: string }>())?.name ?? "") : "");

  return (
    <div className="min-h-dvh bg-stone-100 px-4 py-6 text-stone-900">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Outside data</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/feeds/terms" className="text-emerald-700 underline">School dates</Link>
            <Link href={`/log${r ? `?r=${r}` : ""}`} className="text-emerald-700 underline">Activity log</Link>
          </div>
        </div>
        {one("saved") && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">✅ {one("saved")}</p>}
        {one("error") && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

        <Card>
          <h2 className={h2}>Feeds</h2>
          <p className="text-sm text-stone-600">Daily at 04:30 UK (weather again at 06:45). Problems go to you, never to an owner. A feed with no API key is skipped and shown here.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-stone-500">
                <tr><th className="py-1 pr-2">Feed</th><th className="pr-2">Last success</th><th className="pr-2">Now</th><th className="pr-2">Next run</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {statuses.map((s) => {
                  const problem = feedProblem(s, new Date());
                  const def = FEEDS[s.feed as FeedName];
                  return (
                    <tr key={s.feed} className="align-top">
                      <td className="py-2 pr-2"><b>{def?.label ?? s.feed}</b><div className="text-xs text-stone-500">{def?.source}</div></td>
                      <td className="pr-2">{when(s.last_success_at)}<div className="text-xs text-stone-500">{s.last_rows ? Object.entries(s.last_rows).map(([k, v]) => `${k} ${v}`).join(", ") : ""}</div></td>
                      <td className="pr-2">
                        {!s.enabled ? "⏸️ off" : problem ? <span className="text-red-700">⚠️ {problem}</span> : s.last_outcome === "skipped" ? `⏭️ ${String(s.last_detail?.skipped ?? "skipped")}` : s.last_outcome === "ok" ? "✅" : "not run yet"}
                      </td>
                      <td className="pr-2">{when(s.next_run_at)}</td>
                      <td className="flex gap-1 py-2">
                        <form action={toggleFeed}><input type="hidden" name="feed" value={s.feed} /><input type="hidden" name="enabled" value={s.enabled ? "no" : "yes"} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>{s.enabled ? "Off" : "On"}</button></form>
                        {s.feed !== "backfill" && <form action={runFeedAction}><input type="hidden" name="feed" value={s.feed} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>Run</button></form>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">Archived weather forecasts (as issued) start on {check(archive)?.data?.day ?? "(not known until the first backfill)"}; Open-Meteo keeps them from early 2024 only.</p>
        </Card>

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={h2}>What the forecast has: {restaurantName}</h2>
            <form className="flex gap-2"><select name="r" defaultValue={r ?? ""} className={field}>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className={small}>Show</button></form>
          </div>
          {cov ? (
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-stone-100">
                {cov.rows.map((row) => (
                  <tr key={row.group}><td className="py-1.5 pr-2">{row.status === "live" ? "✅" : row.status === "missing" ? "❌" : "✍️"} {row.group}</td><td className="pr-2 text-xs text-stone-500">{row.source}</td><td className="text-xs text-stone-500">{row.through ? `to ${row.through}. ` : ""}{row.note}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-stone-500">Pick a restaurant.</p>}
        </Card>

        <Card>
          <h2 className={h2}>Dates to confirm</h2>
          <p className="text-sm text-stone-600">Ramadan and Eid follow the moon: until confirmed, the forecast blends the expected day and the alternative. Or on WhatsApp: <b>BUILDER EID CONFIRMED FOR TUESDAY</b>.</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {(check(uncertain) ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1"><b>{c.name}</b> {c.day}{c.end_day ? ` to ${c.end_day}` : ""}{c.authority ? ` · ${AUTHORITY_LABEL[c.authority as Authority] ?? c.authority}` : ""}
                  <div className="text-xs text-stone-500">{c.confirmed_at ? `Confirmed by ${c.confirmed_by} ${when(c.confirmed_at)}` : `Uncertain${c.alt_day ? `, or ${c.alt_day}` : ""}`}</div></div>
                {!c.confirmed_at && (
                  <>
                    <form action={confirmDateAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="day" value={c.day} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>Confirm {c.day.slice(5)}</button></form>
                    {c.alt_day && <form action={confirmDateAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="day" value={c.alt_day} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>Confirm {c.alt_day.slice(5)}</button></form>}
                    <form action={confirmDateAction} className="flex gap-1"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="r" value={r ?? ""} /><input type="date" name="day" className={field} /><button className={small}>Confirm</button></form>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {r && (
          <Card>
            <h2 className={h2}>Mosque timetable: {restaurantName}</h2>
            <p className="text-sm text-stone-600">
              {tt.length ? `Using ${tt[0].method.replace("timetable:", "")}'s timetable for ${tt.length} days (${tt[0].day} to ${tt.at(-1)!.day}); the calculated times fill the other days.` : "Using calculated times (Moonsighting Committee, Hanafi asr)."} A CSV with a Date column and each prayer&apos;s start time (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha), London time.
            </p>
            <form action={uploadTimetable} className="grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="r" value={r} />
              <input name="mosque" placeholder="Mosque name" required className={field} />
              <input name="file" type="file" accept=".csv,text/csv" className="text-sm" />
              <button className={small}>Upload timetable</button>
            </form>
            {tt.length > 0 && <form action={removeTimetable}><input type="hidden" name="r" value={r} /><button className={small}>Remove the timetable</button></form>}
          </Card>
        )}

        <Card>
          <h2 className={h2}>Matches the feeds don&apos;t have</h2>
          <p className="text-sm text-stone-600">Cricket internationals (Pakistan, India, Bangladesh, England), and England&apos;s friendlies, qualifiers and Nations League (not on football-data.org&apos;s free plan). Put the stage in the competition (&quot;group stage&quot;, &quot;quarter-final&quot;, &quot;final&quot;, &quot;friendly&quot;): the forecast weighs it by that.</p>
          <form action={addMatch} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="r" value={r ?? ""} />
            <select name="sport" className={field}><option value="cricket">Cricket</option><option value="football">Football</option></select>
            <input name="competition" placeholder="T20 World Cup semi-final" required className={field} />
            <input name="kickoff" type="datetime-local" required className={field} />
            <input name="home" placeholder="India" required className={field} />
            <input name="away" placeholder="Pakistan" required className={field} />
            <select name="venue" className={field}><option value="">Venue (if one of ours)</option>{(check(venues) ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <button className={small}>Add match</button>
          </form>
          <ul className="divide-y divide-stone-100 text-sm">
            {(check(matches) ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1.5"><span className="flex-1">{m.day} · {m.name}</span><form action={removeMatch}><input type="hidden" name="external_id" value={m.external_id ?? ""} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>Remove</button></form></li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className={h2}>Disruption the feeds don&apos;t have</h2>
          <p className="text-sm text-stone-600">TfL strikes and line closures come from TfL. National Rail strikes have no clean free feed: add them here.</p>
          <form action={addDisruption} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="r" value={r ?? ""} />
            <input name="name" placeholder="National Rail strike" required className={field} />
            <input name="day" type="date" required className={field} />
            <input name="end_day" type="date" className={field} />
            <select name="region" className={field}><option value="london">London</option><option value="england">All of England</option></select>
            <button className={small}>Add</button>
          </form>
          <ul className="divide-y divide-stone-100 text-sm">
            {(check(disruption) ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1.5"><span className="flex-1">{d.day}{d.end_day ? ` to ${d.end_day}` : ""} · {d.name} ({d.region})</span><form action={removeBuilderRow}><input type="hidden" name="external_id" value={d.external_id ?? ""} /><input type="hidden" name="r" value={r ?? ""} /><button className={small}>Remove</button></form></li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className={h2}>Venues</h2>
          <p className="text-sm text-stone-600">An event&apos;s size is its venue&apos;s typical crowd (Ticketmaster doesn&apos;t say how many go). Events at a venue that isn&apos;t here have no size, and the forecast leaves them out.</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {(check(venues) ?? []).map((v) => (
              <li key={v.id} className="py-1.5">
                <form action={saveVenue} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={v.id} /><input type="hidden" name="r" value={r ?? ""} />
                  <span className="min-w-40 flex-1">{v.name}{v.ticketmaster_id ? "" : <span className="text-xs text-stone-500"> (not matched on Ticketmaster yet)</span>}</span>
                  <label className="text-xs">Capacity <input name="capacity" type="number" defaultValue={v.capacity ?? ""} className="w-24 rounded border border-stone-300 px-2 py-1" /></label>
                  <label className="text-xs">Typical crowd <input name="typical_crowd" type="number" defaultValue={v.typical_crowd ?? ""} className="w-24 rounded border border-stone-300 px-2 py-1" /></label>
                  <button className={small}>Save</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={saveVenue} className="grid gap-2 sm:grid-cols-5">
            <input type="hidden" name="r" value={r ?? ""} />
            <input name="name" placeholder="New venue" className={field} />
            <input name="latitude" placeholder="Latitude" className={field} />
            <input name="longitude" placeholder="Longitude" className={field} />
            <input name="typical_crowd" type="number" placeholder="Typical crowd" className={field} />
            <button className={small}>Add venue</button>
          </form>
        </Card>

        {r && (
          <Card>
            <h2 className={h2}>Events near {restaurantName} (next 60 days)</h2>
            <p className="text-sm text-stone-600">Within 5 km. Undecided counts as relevant; the effect fades with distance.</p>
            {!nearEvents.length && <p className="text-sm text-stone-500">None found yet.</p>}
            <ul className="divide-y divide-stone-100 text-sm">
              {nearEvents.map((e) => {
                const x = rel.find((y) => y.event_id === e.id);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">{e.day} · {e.name}<span className="text-xs text-stone-500"> · {x?.distance_m != null ? `${(x.distance_m / 1000).toFixed(1)} km` : ""}{e.expected_size ? ` · ${e.expected_size.toLocaleString("en-GB")} people` : " · no size"}</span></span>
                    <form action={setRelevance} className="flex gap-1">
                      <input type="hidden" name="r" value={r} /><input type="hidden" name="event" value={e.id} />
                      <select name="relevant" defaultValue={x?.relevant === true ? "yes" : x?.relevant === false ? "no" : ""} className="rounded border border-stone-300 px-2 py-1 text-xs"><option value="">Undecided</option><option value="yes">Relevant</option><option value="no">Not relevant</option></select>
                      <button className={small}>Save</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className={h2}>Recent builder changes</h2>
          <ul className="text-sm">
            {(check(builderLog) ?? []).map((l) => <li key={l.id} className="py-0.5"><span className="text-xs text-stone-500">{when(l.created_at)}</span> {l.detail}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
