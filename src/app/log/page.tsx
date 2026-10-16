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
import { AgentCompare, type CompareAgent } from "./agent-compare";

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
