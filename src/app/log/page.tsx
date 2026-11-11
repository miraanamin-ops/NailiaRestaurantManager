import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Icon, type IconName } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { Eyebrow, Page, PageHeader } from "@/components/ui";
import { ago } from "@/lib/dashboard/rules";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { whatsAppLink } from "@/lib/onboarding/steps";
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
import { retryJob, saveForecastErrorLimit, toggleForecastOverride } from "./actions";
import { londonYmd } from "@/lib/clock";
import { forecastBriefsOn, type ForecastBriefRow } from "@/lib/forecast";
import { BASELINE } from "@/lib/forecast/baseline";
import { testToolsEnabled } from "@/lib/test-mode";

export const metadata: Metadata = { title: "Activity · DinerAI", robots: { index: false, follow: false } };

// Every action, newest first: who did what and when. Owner-only (see src/proxy.ts).
export default function LogPage({ searchParams }: PageProps<"/log">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
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

// What the owner never needs to see: agents' and the builder's own working entries.
const BUILDER_ONLY = new Set(["checked", "agent_drafted", "agent_failed", "job_retried", "builder_command", "outside_data"]);
// What UNDO can take back (lib/undo-plan.ts decides; this only picks the card to show).
const UNDOABLE = new Set(["setting", "profile_changed", "approved", "skipped", "staff_added", "staff_removed"]);

const FILTERS: Record<string, { label: string; actions: string[] }> = {
  all: { label: "All", actions: [] },
  sent: { label: "Sent", actions: ["sent", "queued", "blocked"] },
  decisions: { label: "Your decisions", actions: ["approved", "skipped", "edited", "answered", "undone"] },
  changes: { label: "Changes", actions: ["setting", "profile_changed", "profile_reverted", "staff_added", "staff_removed", "billing"] },
  customers: { label: "Customers", actions: ["data_deleted", "exported"] },
  sales: { label: "Sales", actions: ["sales_saved", "sales_imported"] },
};

type Tone = "signal" | "amber" | "ember" | "grey";
const TONE: Record<string, Tone> = { sent: "signal", approved: "signal", answered: "signal", queued: "amber", skipped: "amber", blocked: "ember", agent_failed: "ember" };
const TONE_CLASS: Record<Tone, string> = {
  signal: "bg-[#c8f03c]/15 text-[#c8f03c]",
  amber: "bg-[#ffb23d]/15 text-[#ffb23d]",
  ember: "bg-[#ff7a3d]/15 text-[#ff7a3d]",
  grey: "bg-[#1e221b] text-[#a3a99d]",
};
const TONE_ICON: Record<Tone, IconName> = { signal: "check", amber: "pause", ember: "shield", grey: "edit" };

function who(actor: string) {
  if (actor === "owner") return "You";
  if (actor === "customer") return "Customer";
  if (actor === "staff") return "Staff";
  if (actor === "safety rules" || actor === "checker") return "Safety rules";
  if (actor === "hourly job" || actor === "scheduled job" || actor === "system" || actor === "stripe" || actor === "app store") return "Automatic";
  if (actor === "builder") return "DinerAI";
  return "Dina";
}

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
  // The forecast in today's brief, every restaurant (builder only). Before supabase/042 there's none.
  const forecast = owner.isBuilder ? await forecastSummary(owner.restaurantIds).catch(() => null) : null;

  // Agents' and the builder's own working entries stay out of the owner's view.
  const visible = owner.isBuilder ? entries : entries.filter((e) => !BUILDER_ONLY.has(e.action));
  const show = typeof sp.show === "string" && sp.show in FILTERS ? sp.show : "all";
  const shown = visible.filter((e) => show === "all" || FILTERS[show].actions.includes(e.action));
  const days = new Map<string, AuditEntry[]>();
  for (const e of shown) {
    const d = dayOf(e.created_at);
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  const lastChange = visible.find((e) => e.actor === "owner" && !e.undone_at && UNDOABLE.has(e.action));
  const now = new Date();

  return (
    <Page narrow={!compare}>
      <RestaurantSwitcher choices={choices} current={restaurant.id} path="/log" />
      <PageHeader
        eyebrow="Activity"
        title="What's happened"
        sub="Every draft, decision, send and change, newest first. Nothing happens behind your back."
      />
      {owner.isBuilder && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
          <a href={`/log?r=${restaurant.id}`} className={`rounded-full px-3 py-1 ${compare ? "bg-[#1e221b] text-[#a3a99d]" : "bg-[#edefe8] text-[#0b0c0a]"}`}>
            Everything
          </a>
          {(["reputation", "visibility", "insights", "growth", "gm"] as const).map((x) => (
            <a key={x} href={`/log?r=${restaurant.id}&view=${x}`} className={`rounded-full px-3 py-1 ${compare === x ? "bg-[#edefe8] text-[#0b0c0a]" : "bg-[#1e221b] text-[#a3a99d]"}`}>
              {x === "gm" ? "GM" : x[0].toUpperCase() + x.slice(1)} comparison
            </a>
          ))}
        </div>
      )}
      {compare ? (
        <AgentCompare restaurantId={restaurant.id} agent={compare} />
      ) : (
      <div className="space-y-6">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {Object.entries(FILTERS).map(([key, f]) => (
            <a
              key={key}
              href={`/log?r=${restaurant.id}${key === "all" ? "" : `&show=${key}`}`}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] ${show === key ? "bg-[#c8f03c] font-semibold text-[#0b0c0a]" : "bg-[#1e221b] text-[#a3a99d] hover:text-[#edefe8]"}`}
            >
              {f.label}
            </a>
          ))}
        </div>

        {lastChange && show === "all" && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#1e221b] p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#171a14] text-[#a3a99d]">
                <Icon name="activity" className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <Eyebrow>Your last change · {ago(lastChange.created_at, now)}</Eyebrow>
                <p className="mt-0.5 text-[14px] text-[#edefe8]">{lastChange.detail ?? ACTION_STYLE[lastChange.action]?.label}</p>
              </div>
            </div>
            <a href={whatsAppLink(ourWhatsAppNumber(), "UNDO")} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-[#171a14] px-4 py-1.5 text-[13px] font-medium text-[#c8f03c] ring-1 ring-[#2c3127]">
              Undo
            </a>
          </div>
        )}

        {!shown.length && <p className="text-[14px] text-[#a3a99d]">Nothing here yet.</p>}
        {[...days].map(([day, list]) => (
          <section key={day} className="space-y-2">
            <div className="sticky top-14 z-10 flex items-center justify-between bg-[#0b0c0a]/90 py-1.5 backdrop-blur-md">
              <Eyebrow>{day}</Eyebrow>
              <span className="font-mono text-[11px] text-[#6e7468]">{list.length}</span>
            </div>
            <ul className="space-y-1.5">
              {list.map((e) => {
                const style = ACTION_STYLE[e.action] ?? { icon: "•", label: e.action };
                const tone = TONE[e.action] ?? "grey";
                return (
                  <li key={e.id} className={`flex items-start gap-3 rounded-xl bg-[#171a14] p-3.5 ${e.undone_at ? "opacity-50" : ""}`}>
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}>
                      <Icon name={TONE_ICON[tone]} className="h-[15px] w-[15px]" strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[14px] text-[#edefe8]">
                          {e.detail ?? style.label}
                          {e.undone_at && <span className="ml-1 text-[12px] text-[#a3a99d]">(undone)</span>}
                        </p>
                        <time className="shrink-0 font-mono text-[11px] text-[#a3a99d]">{timeOf(e.created_at)}</time>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full bg-[#1e221b] px-2 py-0.5 text-[11px] ${tone === "ember" ? "text-[#ff7a3d]" : "text-[#a3a99d]"}`}>{who(e.actor)}</span>
                        <span className="text-[12px] text-[#6e7468]">{style.label}</span>
                      </div>
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

        {forecast && <ForecastSection forecast={forecast} restaurant={restaurant} changed={typeof sp.forecast === "string" ? sp.forecast : null} />}

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
      </div>
      )}
    </Page>
  );
}

type ForecastSummary = { today: string; rows: { id: string; name: string; isDemo: boolean; row: ForecastBriefRow | null }[] };

async function forecastSummary(restaurantIds: string[]): Promise<ForecastSummary> {
  const today = londonYmd(new Date());
  const restaurants =
    check(await getSupabase().from("restaurants").select("id, name, is_demo, active").in("id", restaurantIds).order("created_at").returns<{ id: string; name: string; is_demo: boolean; active: boolean }[]>()) ?? [];
  const rows = await forecastBriefsOn(today, restaurants.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.restaurant_id, r]));
  return { today, rows: restaurants.filter((r) => r.active || byId.has(r.id)).map((r) => ({ id: r.id, name: r.name, isDemo: r.is_demo, row: byId.get(r.id) ?? null })) };
}

const OFFER_WORDS: Record<string, string> = { offered: "offered (waiting)", blocked: "not offered: the 7-day gap", drafted: "drafted", declined: "declined (Not now)" };

function ForecastSection({ forecast, restaurant, changed }: { forecast: ForecastSummary; restaurant: Restaurant; changed: string | null }) {
  const canOverride = restaurant.is_demo && testToolsEnabled();
  return (
    <section id="forecast">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Forecast in today&apos;s brief (builder only)</h2>
      <ul className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-stone-200/70">
        {forecast.rows.map(({ id, name, row }) => (
          <li key={id} className="px-4 py-2.5">
            <span aria-hidden>{!row ? "⏳" : row.status === "shown" ? (row.unvalidated ? "🧪" : "📈") : row.status === "no_forecast" ? "⚠️" : "➖"} </span>
            <b>{name}</b> ·{" "}
            {!row
              ? "no brief yet today"
              : row.status === "shown"
                ? `shown${row.unvalidated ? " (TEST: unvalidated)" : ""}`
                : row.status === "no_forecast"
                  ? "\"No forecast today\""
                  : "nothing shown (never had a passed forecast)"}
            {row?.run_id && (
              <span className="block text-xs text-stone-500">
                Run {row.run_id.slice(0, 8)} · {row.run_name === "forecast_refresh" ? "07:00 refresh" : "05:35 run"}
                {row.orders_likely !== null && ` · likely ${row.orders_likely} orders (${row.orders_low} to ${row.orders_high})`}
              </span>
            )}
            {row?.reason && <span className="block text-xs text-amber-800">{row.reason}</span>}
            {row && row.flags.length > 0 && (
              <span className="block text-xs text-stone-500">Flags: {row.flags.map((f) => `${f.day} ${f.kind} ${f.pct > 0 ? "+" : ""}${f.pct}%${f.reason ? ` (${f.reason})` : ""}`).join("; ")}</span>
            )}
            {row?.offer && (
              <span className="block text-xs text-stone-500">
                Offer for {row.offer.day}: {OFFER_WORDS[row.offer.status] ?? row.offer.status}
                {row.offer.draft_id && ` · draft ${row.offer.draft_id.slice(0, 8)}`}
              </span>
            )}
          </li>
        ))}
        {!forecast.rows.length && <li className="px-4 py-2.5 text-stone-500">No restaurants.</li>}
      </ul>
      {canOverride && (
        <form action={toggleForecastOverride} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <input type="hidden" name="r" value={restaurant.id} />
          <input type="hidden" name="on" value={restaurant.forecast_unvalidated ? "0" : "1"} />
          <span>
            {restaurant.name}: unvalidated (TEST) forecasts are <b>{restaurant.forecast_unvalidated ? "shown" : "hidden"}</b>.
          </span>
          <button type="submit" className="rounded-full bg-stone-900 px-3 py-1 text-white">
            {restaurant.forecast_unvalidated ? "Hide them" : "Show them (demo only)"}
          </button>
          {changed === "0" && <span className="text-red-700">That couldn&apos;t be changed.</span>}
        </form>
      )}
      <form action={saveForecastErrorLimit} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
        <input type="hidden" name="r" value={restaurant.id} />
        <label htmlFor="forecast-limit">
          {restaurant.name}: show the week&apos;s forecast ranges only when the back-test&apos;s error is at or under
        </label>
        <input
          id="forecast-limit"
          name="limit"
          inputMode="decimal"
          defaultValue={restaurant.forecast_error_limit_pct == null ? "" : String(Number(restaurant.forecast_error_limit_pct))}
          placeholder={String(BASELINE.defaultErrorLimitPct)}
          className="w-16 rounded border border-stone-300 px-2 py-1"
        />
        <span>% (empty = {BASELINE.defaultErrorLimitPct}%)</span>
        <button type="submit" className="rounded-full bg-stone-900 px-3 py-1 text-white">
          Save
        </button>
      </form>
      <p className="mt-1 text-xs text-stone-500">Made at the 9am brief from the latest passed run (07:00 refresh, else 05:35). Owners see a forecast only from runs that passed.</p>
    </section>
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
