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
import { markRestaurant, switchGoogle } from "./actions";

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

async function PilotZero({ searchParams }: Pick<PageProps<"/onboarding/admin/pilot-zero">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin/pilot-zero");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const overview = await pilotZeroOverview();
  const posted = overview ? await Promise.all(overview.marked.map((r) => wouldHavePosted(r.id))) : [];

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
