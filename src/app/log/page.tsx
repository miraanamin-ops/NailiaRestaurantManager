import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { logOut } from "@/app/login/actions";
import { recentLog, type AuditEntry } from "@/lib/audit";
import { pickRestaurantId, requireOwner, restaurantChoices } from "@/lib/auth";
import { check } from "@/lib/drafts";
import { recentRuns } from "@/lib/job-runs";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { allSwitches, describeSwitches, switchChanges } from "@/lib/switches";
import { deadJobs, queueStats, type QueueJob, type QueueStat } from "@/lib/queue/store";
import { FEEDS, feedProblem, type FeedName } from "@/lib/feeds/config";
import { feedStatuses, type FeedStatus } from "@/lib/feeds/status";
import { AgentCompare, type CompareAgent } from "./agent-compare";
import { retryJob } from "./actions";

export const metadata: Metadata = { title: "Activity log", robots: { index: false, follow: false } };

// Every action, newest first: who did what and when. Owner-only (see src/proxy.ts).
export default function LogPage({ searchParams }: PageProps<"/log">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Log searchParams={searchParams} />
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
  data_deleted: { icon: "🗑️", label: "Data deleted" },
  exported: { icon: "📄", label: "Exported" },
  staff_added: { icon: "👥", label: "Staff added" },
  staff_removed: { icon: "👥", label: "Staff removed" },
  sales_saved: { icon: "🧾", label: "Till report saved" },
  sales_imported: { icon: "📊", label: "Sales file imported" },
  checked: { icon: "🔎", label: "Checked by an agent" },
  agent_drafted: { icon: "🤖", label: "Agent draft (shadow)" },
  answered: { icon: "💬", label: "Answered a question" },
  agent_failed: { icon: "⚠️", label: "Agent job failed" },
  profile_changed: { icon: "🗂️", label: "Profile changed" },
  profile_reverted: { icon: "↩️", label: "Profile change reverted" },
  job_retried: { icon: "🔁", label: "Job retried" },
  builder_command: { icon: "🛠️", label: "Builder command" },
  outside_data: { icon: "🛰️", label: "Outside data" },
  billing: { icon: "💳", label: "Billing" },
};

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

type Alert = { id: string; message: string; channels: string | null; created_at: string };

async function Log({ searchParams }: Pick<PageProps<"/log">, "searchParams">) {
  await connection(); // always fresh, never prerendered
  const owner = await requireOwner("/log");
  const supabase = getSupabase();
  // Only ever a restaurant this person may see.
  const sp = await searchParams;
  const rid = pickRestaurantId(owner, sp.r);
  // The builder can switch to the Reputation shadow comparison.
  // The builder can switch to an agent's shadow comparison.
  const compare: CompareAgent | null = owner.isBuilder && (sp.view === "reputation" || sp.view === "visibility" || sp.view === "insights" || sp.view === "growth" || sp.view === "gm") ? sp.view : null;
  const viewParam = compare ? `&view=${compare}` : "";
  const restaurant = rid ? check(await supabase.from("restaurants").select("*").eq("id", rid).maybeSingle<Restaurant>()) : null;
  if (!restaurant) return <p className="p-6">No restaurant for {owner.email} yet.</p>;
  const choices = await restaurantChoices(owner);
  const entries = await recentLog(restaurant.id, 300);
  // Scheduled jobs and builder alerts: for the builder only.
  const [runs, alerts] = owner.isBuilder
    ? await Promise.all([
        recentRuns(24).then((data) => ({ data })),
        supabase.from("builder_alerts").select("id, message, channels, created_at").order("created_at", { ascending: false }).limit(10).returns<Alert[]>(),
      ])
    : [null, null];
  // The job queue, every restaurant (builder only). Before supabase/027_job_queue.sql
  // has been run there's no queue: the section says so.
  const queue = owner.isBuilder ? await queueSummary() : null;
  // The outside data feeds (builder only). Before supabase/041_outside_feeds.sql there are none.
  const feeds: FeedStatus[] | null = owner.isBuilder ? await feedStatuses().catch(() => null) : null;

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
          {choices.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {choices.map((c) => (
                <a
                  key={c.id}
                  href={`/log?r=${c.id}${viewParam}`}
                  className={`rounded-full px-3 py-1 ${c.id === restaurant.id ? "bg-white text-stone-900" : "bg-white/15 text-white underline"}`}
                >
                  {c.name}
                </a>
              ))}
            </div>
          )}
          {owner.isBuilder && (
            <div className="mt-3 flex gap-2 text-xs">
              <a href={`/log?r=${restaurant.id}`} className={`rounded-full px-3 py-1 ${compare ? "bg-white/15 text-white underline" : "bg-white text-stone-900"}`}>
                Everything
              </a>
              {(["reputation", "visibility", "insights", "growth", "gm"] as const).map((a) => (
                <a key={a} href={`/log?r=${restaurant.id}&view=${a}`} className={`rounded-full px-3 py-1 ${compare === a ? "bg-white text-stone-900" : "bg-white/15 text-white underline"}`}>
                  {a === "reputation" ? "Reputation" : a === "visibility" ? "Visibility" : a === "insights" ? "Insights" : a === "growth" ? "Growth" : "GM"} comparison
                </a>
              ))}
            </div>
          )}
        </div>
      </header>
      {compare ? (
        <main className="mx-auto w-full max-w-4xl px-4 py-5">
          <AgentCompare restaurantId={restaurant.id} agent={compare} />
        </main>
      ) : (
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

        {owner.isBuilder && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Switches now (builder only)</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {describeSwitches(allSwitches(process.env)).map((s) => (
                <li key={s.name} className="px-4 py-2.5">
                  <span className="font-mono text-xs">{s.name}</span> · {s.value}
                  {s.note && <span className="block text-xs text-amber-800">{s.note}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-stone-500">Set in Vercel (Settings, Environment Variables). TEST_MODE is deprecated: it only fills in a switch that isn&apos;t set.</p>
          </section>
        )}

        {queue && <QueueSection queue={queue} r={restaurant.id} retried={typeof sp.retried === "string" ? sp.retried : null} />}

        {feeds && (
          <section id="feeds">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Outside data (builder only)</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {feeds.map((f) => {
                const problem = feedProblem(f, new Date());
                return (
                  <li key={f.feed} className="px-4 py-2.5">
                    <span aria-hidden>{!f.enabled ? "⏸️" : problem ? "⚠️" : f.last_outcome === "skipped" ? "⏭️" : f.last_outcome === "ok" ? "✅" : "⏳"} </span>
                    <b>{FEEDS[f.feed as FeedName]?.label ?? f.feed}</b> · last success {f.last_success_at ? `${dayOf(f.last_success_at).split(" ").slice(0, 3).join(" ")} ${timeOf(f.last_success_at)}` : "never"}
                    {f.next_run_at && <> · next {dayOf(f.next_run_at).split(" ").slice(0, 3).join(" ")} {timeOf(f.next_run_at)}</>}
                    {f.last_rows && <span className="block text-xs text-stone-500">Rows: {Object.entries(f.last_rows).map(([k, v]) => `${k} ${v}`).join(", ")}</span>}
                    {problem && <span className="block text-xs text-red-700">{problem}</span>}
                    {!problem && f.last_outcome === "skipped" && <span className="block text-xs text-stone-500">Skipped: {String(f.last_detail?.skipped ?? "")}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs text-stone-500">
              Switches, coverage, dates to confirm and what you add by hand: <a href={`/feeds?r=${restaurant.id}`} className="underline">Outside data</a>.
            </p>
          </section>
        )}

        {runs?.data && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Scheduled jobs (builder only)</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {runs.data.map((r, i) => {
                // Runs are newest first: compare with the run before this one.
                const changed = switchChanges(runs.data[i + 1]?.switches, r.switches);
                return (
                  <li key={r.id} className="px-4 py-2.5">
                    <span aria-hidden>{r.status === "ok" ? "✅" : r.status === "failed" ? "❌" : "⏳"} </span>
                    {r.job} · {dayOf(r.started_at).split(" ").slice(0, 3).join(" ")} {timeOf(r.started_at)} · {r.status}
                    {r.error && <span className="block text-xs text-red-700">{r.error}</span>}
                    {r.switches && (
                      <span className="block text-xs text-stone-500">
                        Switches: email redirect {r.switches.email_redirect ? "on" : "off"}, test tools {r.switches.test_tools ? "on" : "off"}, Google {String(r.switches.google)}, agents live {String(r.switches.agents_live)}
                      </span>
                    )}
                    {changed.length > 0 && <span className="block text-xs font-medium text-amber-800">Switches changed: {changed.join("; ")}</span>}
                  </li>
                );
              })}
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
      )}
    </div>
  );
}

type QueueSummary = { rows: (QueueStat & { name: string })[]; dead: (QueueJob & { name: string })[] } | { error: string };

async function queueSummary(): Promise<QueueSummary> {
  try {
    const [stats, dead, names] = await Promise.all([
      queueStats(),
      deadJobs(30),
      getSupabase().from("restaurants").select("id, name").returns<{ id: string; name: string }[]>(),
    ]);
    const nameOf = (id: string | null) => (id ? (names.data ?? []).find((n) => n.id === id)?.name ?? id.slice(0, 8) : "System");
    // One line per restaurant: its jobs of every type added up.
    const byRestaurant = new Map<string, QueueStat & { name: string }>();
    for (const s of stats) {
      const key = s.restaurant_id ?? "system";
      const row = byRestaurant.get(key) ?? { restaurant_id: s.restaurant_id, type: "all", queued: 0, due: 0, retrying: 0, running: 0, dead: 0, oldest_due: null, name: nameOf(s.restaurant_id) };
      row.queued += s.queued;
      row.due += s.due;
      row.retrying += s.retrying;
      row.running += s.running;
      row.dead += s.dead;
      if (s.oldest_due && (!row.oldest_due || s.oldest_due < row.oldest_due)) row.oldest_due = s.oldest_due;
      byRestaurant.set(key, row);
    }
    return { rows: [...byRestaurant.values()].sort((a, b) => a.name.localeCompare(b.name)), dead: dead.map((d) => ({ ...d, name: nameOf(d.restaurant_id) })) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function QueueSection({ queue, r, retried }: { queue: QueueSummary; r: string; retried: string | null }) {
  return (
    <section id="queue">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Job queue (builder only)</h2>
      {retried === "1" && <p className="mb-2 text-xs text-green-800">Retried: it&apos;s back in the queue and a worker has been started.</p>}
      {retried === "0" && <p className="mb-2 text-xs text-amber-800">That job wasn&apos;t dead any more (already retried or cleaned up).</p>}
      {"error" in queue ? (
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-stone-600 shadow-sm ring-1 ring-stone-200/70">The queue isn&apos;t set up yet ({queue.error}). Run supabase/027_job_queue.sql.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Restaurant</th>
                  <th className="px-2 py-2 text-right font-medium">Waiting</th>
                  <th className="px-2 py-2 text-right font-medium">Running</th>
                  <th className="px-2 py-2 text-right font-medium">Retrying</th>
                  <th className="px-4 py-2 text-right font-medium">Dead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {queue.rows.map((q) => (
                  <tr key={q.restaurant_id ?? "system"}>
                    <td className="px-4 py-2">{q.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {q.queued}
                      {q.due > 0 && <span className="block text-xs text-stone-500">{q.due} due{q.oldest_due ? `, since ${timeOf(q.oldest_due)}` : ""}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{q.running}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{q.retrying}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${q.dead ? "font-semibold text-red-700" : ""}`}>{q.dead}</td>
                  </tr>
                ))}
                {!queue.rows.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2.5 text-stone-500">
                      Nothing waiting, running or dead.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {queue.dead.length > 0 && (
            <ul className="mt-3 divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
              {queue.dead.map((j) => (
                <li key={j.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p>
                      {j.name} · {j.type.replaceAll("_", " ")}
                      {typeof j.payload?.step === "string" ? ` (${j.payload.step})` : ""}
                    </p>
                    <p className="break-words text-xs text-red-700">{j.last_error ?? "No error recorded"}</p>
                    <p className="text-xs text-stone-500">
                      {j.finished_at ? `${dayOf(j.finished_at).split(" ").slice(0, 3).join(" ")} ${timeOf(j.finished_at)}` : ""} · {j.attempts} {j.attempts === 1 ? "try" : "tries"}
                    </p>
                  </div>
                  <form action={retryJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <input type="hidden" name="r" value={r} />
                    <button type="submit" className="rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white">
                      Retry
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
