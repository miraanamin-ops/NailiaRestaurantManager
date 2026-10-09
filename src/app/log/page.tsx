import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { logOut } from "@/app/login/actions";
import { recentLog, type AuditEntry } from "@/lib/audit";
import { requireOwner } from "@/lib/auth";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

export const metadata: Metadata = { title: "Activity log", robots: { index: false, follow: false } };

// Every action, newest first: who did what and when. Owner-only (see src/proxy.ts).
export default function LogPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Log />
    </Suspense>
  );
}

const ACTION_STYLE: Record<string, { icon: string; label: string }> = {
  created: { icon: "📝", label: "Drafted" },
  edited: { icon: "✏️", label: "Edited" },
  approved: { icon: "👍", label: "Approved" },
  skipped: { icon: "⏭️", label: "Skipped" },
  blocked: { icon: "⛔", label: "Blocked" },
  queued: { icon: "🕘", label: "Held" },
  sent: { icon: "✅", label: "Sent" },
  setting: { icon: "⚙️", label: "Setting" },
  undone: { icon: "↩️", label: "Undo" },
};

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

type JobRun = { id: string; job: string; status: string; started_at: string; finished_at: string | null; error: string | null };
type Alert = { id: string; message: string; channels: string | null; created_at: string };

async function Log() {
  await connection(); // always fresh, never prerendered
  const owner = await requireOwner("/log");
  const supabase = getSupabase();
  const restaurant = owner.restaurantIds.length
    ? check(await supabase.from("restaurants").select("*").eq("id", owner.restaurantIds[0]).maybeSingle<Restaurant>())
    : null;
  if (!restaurant) return <p className="p-6">No restaurant for {owner.email} yet.</p>;
  const entries = await recentLog(restaurant.id, 300);
  // Scheduled jobs and builder alerts: for the builder only.
  const [runs, alerts] = owner.isBuilder
    ? await Promise.all([
        supabase.from("job_runs").select("id, job, status, started_at, finished_at, error").order("started_at", { ascending: false }).limit(24).returns<JobRun[]>(),
        supabase.from("builder_alerts").select("id, message, channels, created_at").order("created_at", { ascending: false }).limit(10).returns<Alert[]>(),
      ])
    : [null, null];

  const days = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const d = dayOf(e.created_at);
    days.set(d, [...(days.get(d) ?? []), e]);
  }

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-4 pb-6 pt-8 text-white" style={{ background: restaurant.brand_dark }}>
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-stone-300">{restaurant.name}</p>
          <h1 className="text-2xl font-bold tracking-tight">Activity log</h1>
          <p className="mt-1 text-xs text-stone-400">Every draft, decision, send and setting change, newest first. Text UNDO to reverse your last one.</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5">
        {!entries.length && <p className="text-sm text-stone-600">Nothing has happened yet.</p>}
        {[...days].map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">{day}</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70">
              {list.map((e) => {
                const style = ACTION_STYLE[e.action] ?? { icon: "•", label: e.action };
                return (
                  <li key={e.id} className={`flex gap-3 px-4 py-3 ${e.undone_at ? "opacity-50" : ""}`}>
                    <span className="mt-0.5 text-lg" aria-hidden>
                      {style.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-stone-900">
                        {e.detail ?? style.label}
                        {e.undone_at && <span className="ml-1 text-xs text-stone-500">(undone)</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {timeOf(e.created_at)} · {style.label} · by {e.actor}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {runs?.data && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Scheduled jobs (builder only)</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {runs.data.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <span aria-hidden>{r.status === "ok" ? "✅" : r.status === "failed" ? "❌" : "⏳"} </span>
                  {r.job} · {dayOf(r.started_at).split(" ").slice(0, 3).join(" ")} {timeOf(r.started_at)} · {r.status}
                  {r.error && <span className="block text-xs text-red-700">{r.error}</span>}
                </li>
              ))}
              {!runs.data.length && <li className="px-4 py-2.5 text-stone-500">No runs recorded yet.</li>}
            </ul>
          </section>
        )}
        {alerts?.data && alerts.data.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Builder alerts</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {alerts.data.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <p className="whitespace-pre-line">{a.message}</p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {timeOf(a.created_at)} · {a.channels}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form action={logOut} className="pt-2 text-center">
          <button type="submit" className="text-sm text-stone-600 underline">
            Log out ({owner.email})
          </button>
        </form>
      </main>
    </div>
  );
}
