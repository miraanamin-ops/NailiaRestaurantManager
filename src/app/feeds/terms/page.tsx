import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { HORIZON } from "@/lib/feeds/config";
import { councilsShort, type SchoolDate } from "@/lib/feeds/school-terms";
import { getSupabase } from "@/lib/supabase";
import { Card } from "../../onboarding/ui";
import { addCouncil, confirmDraftRows, deleteSchoolDate, importSchoolDates, readCouncilPage } from "../actions";

export const metadata: Metadata = { title: "School dates", robots: { index: false, follow: false } };

// School term dates per council, for the builder (there's no national feed).
// Typed or pasted as CSV, or read from the council's page by Claude and then
// ticked row by row: nothing Claude reads is used until the builder confirms it.
export default function TermsPage({ searchParams }: PageProps<"/feeds/terms">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Terms searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-lg px-3 py-1.5 text-sm font-medium text-stone-900 ring-1 ring-stone-300";
const field = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

type Council = { code: string; name: string; term_dates_url: string | null; dates_known_until: string | null };
type Row = SchoolDate & { id: string; confirmed_by: string | null };
type Draft = { id: string; url: string; rows: (SchoolDate & { problem: string | null })[]; notes: string | null; created_at: string };

async function Terms({ searchParams }: Pick<PageProps<"/feeds/terms">, "searchParams">) {
  await connection();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner("/feeds/terms");
  if (!owner.isBuilder) return <p className="p-6">This page is for the builder.</p>;
  const supabase = getSupabase();
  const today = londonYmd(new Date());
  const councils = check(await supabase.from("councils").select("code, name, term_dates_url, dates_known_until").order("name").returns<Council[]>()) ?? [];
  const active = check(await supabase.from("restaurants").select("name, council_code").eq("active", true).returns<{ name: string; council_code: string | null }[]>()) ?? [];
  const short = councilsShort(councils, active.map((a) => a.council_code).filter((c): c is string => Boolean(c)), today, HORIZON.termWarningMonths);
  const code = one("council") ?? councils[0]?.code ?? "";
  const council = councils.find((c) => c.code === code);
  const [rows, drafts] = council
    ? await Promise.all([
        supabase.from("school_dates").select("id, council_code, kind, start_day, end_day, half_term_start, half_term_end, academic_year, notes, confirmed_by").eq("council_code", code).order("start_day").returns<Row[]>(),
        supabase.from("school_date_drafts").select("id, url, rows, notes, created_at").eq("council_code", code).order("created_at", { ascending: false }).returns<Draft[]>(),
      ])
    : [null, null];

  return (
    <div className="min-h-dvh bg-stone-100 px-4 py-6 text-stone-900">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight">School dates</h1>
          <Link href="/feeds" className="text-sm text-emerald-700 underline">Outside data</Link>
        </div>
        {one("saved") && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">✅ {one("saved")}</p>}
        {one("error") && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}
        {short.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ⚠️ Needed for the next {HORIZON.termWarningMonths} months: {short.map((s) => `${s.name} (${s.knownUntil ? `dates end ${s.knownUntil}` : "no dates"})`).join(", ")}.
          </p>
        )}

        <Card>
          <h2 className="text-lg font-bold">Councils</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {councils.map((c) => (
              <li key={c.code} className="flex items-center gap-2 py-1.5">
                <Link href={`/feeds/terms?council=${c.code}`} className={c.code === code ? "font-bold" : "text-emerald-700 underline"}>{c.name}</Link>
                <span className="text-xs text-stone-500">{c.code} · dates to {c.dates_known_until ?? "none yet"} · {active.filter((a) => a.council_code === c.code).map((a) => a.name).join(", ") || "no active restaurant"}</span>
              </li>
            ))}
          </ul>
          <form action={addCouncil} className="grid gap-2 sm:grid-cols-4">
            <input name="code" placeholder="ONS code (E09000025)" className={field} />
            <input name="name" placeholder="Name" className={field} />
            <input name="url" placeholder="Term dates page (optional)" className={field} />
            <button className={small}>Add council</button>
          </form>
        </Card>

        {council && (
          <>
            <Card>
              <h2 className="text-lg font-bold">{council.name}: saved dates</h2>
              <p className="text-sm text-stone-600">Holidays are the half terms and the days between terms. Inset days are set by schools: add the ones most local schools share.</p>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-stone-500"><tr><th>Year</th><th>Kind</th><th>From</th><th>To</th><th>Half term</th><th /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {((rows && check(rows)) ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="py-1">{r.academic_year}</td><td>{r.kind}</td><td>{r.start_day}</td><td>{r.end_day}</td><td>{r.half_term_start ? `${r.half_term_start} to ${r.half_term_end}` : ""}</td>
                      <td><form action={deleteSchoolDate}><input type="hidden" name="council" value={code} /><input type="hidden" name="id" value={r.id} /><button className={small}>Delete</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <h2 className="text-lg font-bold">Add dates</h2>
              <p className="text-sm text-stone-600">One row per line: <code>kind,start,end,half term start,half term end,notes</code>, kind <code>term</code> or <code>inset</code>, dates 2026-09-02 or 02/09/2026.</p>
              <form action={importSchoolDates} className="space-y-2">
                <input type="hidden" name="council" value={code} />
                <textarea name="csv" rows={5} placeholder={"term,2027-01-04,2027-03-26,2027-02-15,2027-02-19\ninset,2027-01-04,2027-01-04,,,Most primaries"} className={field} />
                <button className={small}>Save these dates</button>
              </form>
              <form action={readCouncilPage} className="flex gap-2">
                <input type="hidden" name="council" value={code} />
                <input name="url" defaultValue={council.term_dates_url ?? ""} placeholder="https://... council term dates page or PDF" className={field} />
                <button className={small}>Read with Claude</button>
              </form>
              <p className="text-xs text-stone-500">Claude only reads the page: you tick each row before anything is saved. A few pence per page.</p>
            </Card>

            {((drafts && check(drafts)) ?? []).map((d) => (
              <Card key={d.id}>
                <h2 className="text-lg font-bold">Claude read {d.rows.length} row(s)</h2>
                <p className="text-xs text-stone-500">{d.url}</p>
                {d.notes && <p className="text-sm text-amber-800">Not sure about: {d.notes}</p>}
                <form action={confirmDraftRows} className="space-y-2">
                  <input type="hidden" name="council" value={code} />
                  <input type="hidden" name="draft" value={d.id} />
                  {d.rows.map((r, i) => (
                    <label key={i} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name={`row_${i}`} value="yes" disabled={Boolean(r.problem)} className="mt-0.5 h-4 w-4" />
                      <span>{r.kind} {r.start_day} to {r.end_day}{r.half_term_start ? `, half term ${r.half_term_start} to ${r.half_term_end}` : ""}{r.notes ? ` (${r.notes})` : ""}{r.problem && <span className="text-red-700"> ⚠️ {r.problem}</span>}</span>
                    </label>
                  ))}
                  <button className={small}>Save the ticked rows (and discard this reading)</button>
                </form>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
