import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { check, type Draft } from "@/lib/drafts";
import { dryRunState, pilotZeroOverview } from "@/lib/pilot-zero";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { Card, Frame } from "@/app/onboarding/ui";
import { simulationView, type DayResult, type SimulationView } from "@/lib/simulation";
import { importsFor, type ImportRow } from "@/lib/pilot-zero-sales";
import { markRestaurant, removeSales, simClear, simNextDay, simReview, simRunDay, simSetDay, simStop, simTillReport, switchGoogle } from "./actions";

export const metadata: Metadata = { title: "Pilot Zero · DinerAI", robots: { index: false, follow: false } };

// The builder's Pilot Zero controls (docs/pilot-zero.md): mark the pilot
// restaurant, and switch its Google writes between dry run and live (going live
// needs the Google profile's name typed). The only place these can change.
// Builder only.
export default function PilotZeroPage({ searchParams }: PageProps<"/onboarding/admin/pilot-zero">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PilotZero searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-stone-300 hover:ring-stone-500";
const input = "rounded-full px-3 py-2 text-sm ring-1 ring-stone-300";

// The latest Google writes that were dry run (or replies to simulated reviews).
async function wouldHavePosted(restaurantId: string) {
  const rows =
    check(
      await getSupabase()
        .from("drafts")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "sent")
        .in("kind", ["review_reply", "google_post", "hours_update", "menu_update"])
        .order("sent_at", { ascending: false })
        .limit(50)
        .returns<Draft[]>(),
    ) ?? [];
  return rows.filter((d) => d.checks?.send?.dry_run).slice(0, 10);
}

function GoogleSwitch({ r, kind, dry }: { r: Restaurant; kind: "replies" | "profile"; dry: boolean }) {
  const label = kind === "replies" ? "Review replies and posts" : "Hours and photo changes";
  const profile = r.google_location_title?.trim();
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3">
      <p className="text-sm">
        {label}: <b className={dry ? "text-emerald-800" : "text-red-700"}>{dry ? "dry run" : "LIVE on Google"}</b>
      </p>
      {dry ? (
        profile ? (
          <form action={switchGoogle} className="flex flex-wrap gap-2">
            <input type="hidden" name="r" value={r.id} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="to" value="live" />
            <input name="confirm" required autoComplete="off" placeholder={`Type "${profile}" to confirm`} aria-label={`Type the profile name, ${profile}, to confirm`} className={`${input} min-w-0 flex-1`} />
            <button className={`${small} text-red-700`}>Switch to live</button>
          </form>
        ) : (
          <p className="text-sm text-stone-500">No Google profile connected, so it can only be dry run.</p>
        )
      ) : (
        <form action={switchGoogle}>
          <input type="hidden" name="r" value={r.id} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="to" value="dry" />
          <button className={small}>Back to dry run</button>
        </form>
      )}
    </div>
  );
}

function Hidden({ r }: { r: Restaurant }) {
  return <input type="hidden" name="r" value={r.id} />;
}

// The simulation (lib/simulation.ts): a simulated date, things to inject, and Run day.
function Simulation({ r, view }: { r: Restaurant; view: SimulationView }) {
  const results = (view.lastRun?.result?.results as DayResult[] | undefined) ?? [];
  const finished = view.lastRun?.result?.finished === true;
  return (
    <div className="space-y-3 rounded-xl bg-amber-50 p-3">
      <h3 className="text-sm font-semibold">Simulation</h3>
      {!view.day ? (
        <>
          <p className="text-sm text-stone-600">Off: the real scheduled jobs run as normal.</p>
          <form action={simSetDay} className="flex flex-wrap gap-2">
            <Hidden r={r} />
            <input type="date" name="day" required aria-label="Simulated date" className={input} />
            <button className={small}>Start simulating</button>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm">
            Simulated clock: <b>{view.label}</b>. Real scheduled jobs skip this restaurant; Run day runs them for this date. Owner messages use this date too.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={simRunDay}>
              <Hidden r={r} />
              <button className={`${small} bg-[#c8f03c]`}>Run day</button>
            </form>
            <form action={simNextDay}>
              <Hidden r={r} />
              <button className={small}>Next day</button>
            </form>
            <form action={simStop}>
              <Hidden r={r} />
              <button className={small}>Stop simulating</button>
            </form>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={simTillReport} className="flex gap-1">
              <Hidden r={r} />
              <input name="net" inputMode="decimal" placeholder="£ net (optional)" aria-label="Net takings, optional" className={`${input} w-36`} />
              <button className={small}>Add till report</button>
            </form>
            <form action={simTillReport}>
              <Hidden r={r} />
              <input type="hidden" name="quiet" value="1" />
              <button className={small}>Quiet day</button>
            </form>
            <form action={simReview} className="flex gap-1">
              <Hidden r={r} />
              <select name="rating" aria-label="Stars" defaultValue="1" className={input}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} star{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <button className={small}>Add review</button>
            </form>
          </div>
        </>
      )}
      <p className="text-sm text-stone-600">
        Simulated so far: {view.reviews} review{view.reviews === 1 ? "" : "s"}, {view.tillReports} till report{view.tillReports === 1 ? "" : "s"}.
      </p>
      {(view.reviews > 0 || view.tillReports > 0) && (
        <form action={simClear}>
          <Hidden r={r} />
          <button className={`${small} text-red-700`}>Clear simulated data</button>
        </form>
      )}
      {view.lastRun && (
        <div className="text-sm">
          <p className="font-semibold">
            Last Run day{typeof view.lastRun.result?.day === "string" ? ` (${view.lastRun.result.day})` : ""}: {finished ? "finished" : view.lastRun.status === "dead" ? "stopped with an error" : "in progress (refresh)"}
          </p>
          <ul className="mt-1 space-y-1 text-stone-700">
            {results.map((x, i) => (
              <li key={i}>
                {x.error ? "❌" : "✓"} {x.at} {x.label}: {x.error ?? x.done}
              </li>
            ))}
          </ul>
          {view.lastRun.last_error && <p className="text-red-700">{view.lastRun.last_error}</p>}
        </div>
      )}
    </div>
  );
}

// Imported sales: remove one upload, or everything imported in a date range (till reports stay).
function ImportedSales({ r, uploads }: { r: Restaurant; uploads: ImportRow[] }) {
  const confirm = <input name="confirm" required autoComplete="off" placeholder={`Type "${r.name}" to confirm`} aria-label={`Type the restaurant name, ${r.name}, to confirm`} className={`${input} min-w-0 flex-1`} />;
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3">
      <h3 className="text-sm font-semibold">Imported sales</h3>
      <p className="text-sm text-stone-600">Removes sales uploaded from a till export (e.g. the made-up year in pilot-zero/). The owner&apos;s till report photos are kept. Can&apos;t be undone.</p>
      {uploads.length ? (
        <ul className="space-y-2 text-sm">
          {uploads.map((u) => (
            <li key={u.id}>
              <form action={removeSales} className="flex flex-wrap items-center gap-2">
                <Hidden r={r} />
                <input type="hidden" name="import" value={u.id} />
                <span>
                  {u.file_name ?? "A file"}: {u.first_day} to {u.last_day}, {u.rows_imported ?? 0} rows
                </span>
                {confirm}
                <button className={`${small} text-red-700`}>Remove</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">No uploads.</p>
      )}
      <form action={removeSales} className="flex flex-wrap items-center gap-2">
        <Hidden r={r} />
        <input type="date" name="from" required aria-label="From" className={input} />
        <input type="date" name="to" required aria-label="To" className={input} />
        {confirm}
        <button className={`${small} text-red-700`}>Remove that range</button>
      </form>
    </div>
  );
}

async function PilotZero({ searchParams }: Pick<PageProps<"/onboarding/admin/pilot-zero">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin/pilot-zero");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const overview = await pilotZeroOverview();
  const posted = overview ? await Promise.all(overview.marked.map((r) => wouldHavePosted(r.id))) : [];
  const sims = overview ? await Promise.all(overview.marked.map((r) => simulationView(r))) : [];
  const uploads = overview ? await Promise.all(overview.marked.map((r) => importsFor(r.id))) : [];

  return (
    <Frame>
      <p className="text-sm">
        <Link href="/onboarding/admin" className="underline">
          Setup test controls
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Pilot Zero</h1>
      {typeof q.done === "string" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">✓ {q.done}</p>}
      {typeof q.error === "string" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{q.error}</p>}
      {!overview ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This database doesn&apos;t have the Pilot Zero columns yet (supabase/056_pilot_zero.sql), so nothing is marked and nothing is dry run.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-stone-600">
            Google writes for a Pilot Zero restaurant are dry run until you switch them here: the owner sees &quot;would have posted&quot; and nothing reaches Google. Replies to simulated reviews never go to Google. With replies live, each one still needs the owner&apos;s Approve on WhatsApp (never Auto) and is in the log. Hours and photos have their own switch. Nothing on WhatsApp can change these.
          </p>

          {overview.marked.map((r, i) => {
            const state = dryRunState(r);
            return (
              <Card key={r.id}>
                <h2 className="text-lg font-semibold">{r.name}</h2>
                <p className="text-sm text-stone-600">Google: {r.google_location_id ? `connected to ${r.google_location_title ?? r.google_location_id}` : "not connected"}</p>
                <GoogleSwitch r={r} kind="replies" dry={state.replies} />
                <GoogleSwitch r={r} kind="profile" dry={state.profile} />
                <Simulation r={r} view={sims[i]} />
                <ImportedSales r={r} uploads={uploads[i]} />
                <h3 className="text-sm font-semibold">Would have posted (latest {posted[i].length})</h3>
                {posted[i].length ? (
                  <ul className="space-y-1 text-sm text-stone-700">
                    {posted[i].map((d) => (
                      <li key={d.id}>{d.checks?.send?.dry_run?.fixes[0] ?? d.content}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-stone-500">Nothing yet.</p>
                )}
              </Card>
            );
          })}

          <h2 className="mt-8 text-xl font-semibold">Mark a restaurant for Pilot Zero</h2>
          <p className="text-sm text-stone-500">Only test restaurants and restaurants on your own number can be marked. Its Google writes are dry run from then on.</p>
          {overview.markable.length ? (
            <form action={markRestaurant} className="mt-2 flex flex-wrap gap-2">
              <select name="r" aria-label="Restaurant to mark" className={input}>
                {overview.markable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.is_test ? " (test)" : ""}
                  </option>
                ))}
              </select>
              <button className={small}>Mark</button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-stone-500">None to mark.</p>
          )}
        </>
      )}
    </Frame>
  );
}
