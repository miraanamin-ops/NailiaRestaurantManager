import { Suspense } from "react";
import type { Metadata } from "next";
import { recentLog, type AuditEntry } from "@/lib/audit";
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

async function Log() {
  const restaurant = check(await getSupabase().from("restaurants").select("*").limit(1).maybeSingle<Restaurant>());
  if (!restaurant) return <p className="p-6">No restaurant yet.</p>;
  const entries = await recentLog(restaurant.id, 300);

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
      </main>
    </div>
  );
}
