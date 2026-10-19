import Link from "next/link";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { addDays, AUTHORITIES, AUTHORITY_LABEL, type Authority } from "@/lib/feeds/calendar-dates";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { button, Card, input } from "../onboarding/ui";
import { confirmDateAction, saveTeams, setAuthority } from "../feeds/actions";

// Settings cards for the outside data the forecast uses: the owner's teams, and
// (builder only) whose Ramadan and Eid dates the restaurant follows, with the
// dates waiting to be confirmed. The rest is on /feeds.

export async function TeamsCard({ restaurantId }: { restaurantId: string }) {
  const supabase = getSupabase();
  const [teams, known] = await Promise.all([
    supabase.from("restaurant_teams").select("team").eq("restaurant_id", restaurantId).returns<{ team: string }[]>(),
    supabase.from("football_fixtures").select("home_team").limit(1000).returns<{ home_team: string }[]>(),
  ]);
  const names = [...new Set((check(known) ?? []).map((k) => k.home_team))].sort();
  return (
    <Card>
      <h2 className="text-lg font-bold">Teams your customers follow</h2>
      <p className="text-sm text-stone-600">Their matches help predict busy and quiet times. England is always counted. Separate teams with commas.</p>
      <form action={saveTeams} className="space-y-3">
        <input type="hidden" name="r" value={restaurantId} />
        <input name="teams" list="team-names" defaultValue={(check(teams) ?? []).map((t) => t.team).join(", ")} placeholder="West Ham, Arsenal" className={input} />
        <datalist id="team-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button className={button}>Save teams</button>
      </form>
    </Card>
  );
}

type Uncertain = { id: string; day: string; name: string; alt_day: string | null };

export async function OutsideDataCard({ r }: { r: Restaurant & { religious_authority?: string | null; council_code?: string | null; council_name?: string | null } }) {
  const today = londonYmd(new Date());
  const authority = (r.religious_authority ?? "east-london-mosque") as Authority;
  const uncertain =
    check(
      await getSupabase()
        .from("local_calendar")
        .select("id, day, name, alt_day")
        .is("restaurant_id", null)
        .eq("type", "religious")
        .eq("authority", authority)
        .eq("date_uncertain", true)
        .is("confirmed_at", null)
        .gte("day", addDays(today, -3))
        .lte("day", addDays(today, 90))
        .order("day")
        .returns<Uncertain[]>(),
    ) ?? [];
  return (
    <Card>
      <h2 className="text-lg font-bold">Outside data (builder only)</h2>
      <form action={setAuthority} className="flex items-end gap-2">
        <input type="hidden" name="r" value={r.id} />
        <input type="hidden" name="page" value="/settings" />
        <label className="block flex-1 text-sm font-medium">
          Ramadan and Eid dates follow
          <select name="authority" defaultValue={authority} className={`mt-1 ${input}`}>
            {AUTHORITIES.map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
          </select>
        </label>
        <button className="rounded-xl px-4 py-3 text-sm font-semibold ring-1 ring-stone-300">Save</button>
      </form>
      {uncertain.length > 0 && (
        <ul className="divide-y divide-stone-100 text-sm">
          {uncertain.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1"><b>{u.name}</b> expected {u.day}{u.alt_day ? `, or ${u.alt_day}` : ""}</span>
              {[u.day, u.alt_day].filter((d): d is string => Boolean(d)).map((d) => (
                <form key={d} action={confirmDateAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="day" value={d} />
                  <input type="hidden" name="r" value={r.id} />
                  <input type="hidden" name="page" value="/settings" />
                  <button className="rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-stone-300">Confirm {d.slice(5)}</button>
                </form>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-stone-600">
        Feeds, mosque timetable, matches, venues and nearby events: <Link href={`/feeds?r=${r.id}`} className="text-emerald-700 underline">Outside data</Link>. School dates:{" "}
        <Link href={`/feeds/terms${r.council_code ? `?council=${r.council_code}` : ""}`} className="text-emerald-700 underline">{r.council_name ?? "by council"}</Link>.
      </p>
    </Card>
  );
}
