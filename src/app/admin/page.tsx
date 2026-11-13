import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/app-shell";
import { requireFounder } from "@/lib/founder/access";
import { loadOverview } from "@/lib/founder/data";
import { delta, pct, pounds, STANDING_LABEL } from "@/lib/founder/metrics";
import { AdminPage, Card, day, H1, H2, Light, MonthBars, Stat, usd } from "./_ui";

// The founder dashboard's overview: clients, money, churn, costs, who needs a call.
export default function Overview({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewBody searchParams={searchParams} />
    </Suspense>
  );
}

async function OverviewBody({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  await connection();
  await requireFounder("/admin");
  const q = await searchParams;
  const includeTest = q.test === "1";
  const o = await loadOverview({ includeTest });
  const m = o.months;
  const cur = m[m.length - 1], prev = m[m.length - 2];
  const curCost = o.costMonths[o.costMonths.length - 1];
  const mrrPerClient = o.counts.paying ? o.mrr.afterFeesPence / o.counts.paying : null;
  const costPerPaying = o.counts.paying ? curCost.totalPence / o.counts.paying : null;
  const margin = o.mrr.afterFeesPence ? 1 - curCost.totalPence / (o.mrr.afterFeesPence - o.mrr.vatPence) : null;

  return (
    <AdminPage>
      <H1
        sub={<>Updated {day(o.now.toISOString())}. {includeTest ? "Including demo, test and Pilot Zero sites." : "Real clients only."}</>}
        aside={
          <Link href={includeTest ? "/admin" : "/admin?test=1"} className="rounded-full px-3 py-1.5 text-[13px] text-[#a3a99d] ring-1 ring-[#2c3127] hover:text-[#edefe8]">
            {includeTest ? "Hide test sites" : "Show test sites"}
          </Link>
        }
      >
        DinerAI at a glance
      </H1>

      {o.attention.length > 0 && (
        <section>
          <H2 aside={<span className="text-[12px] text-[#6e7468]">{o.attention.length} client{o.attention.length === 1 ? "" : "s"}</span>}>Needs attention</H2>
          <div className="divide-y divide-[#2c3127] overflow-hidden rounded-2xl bg-[#171a14]">
            {o.attention.slice(0, 12).map((c) => (
              <Link key={c.r.id} href={`/admin/clients/${c.r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[#1e221b]">
                <div className="min-w-0">
                  <div className="text-[15px] text-[#edefe8]">{c.r.name}</div>
                  <div className="text-[12px] text-[#a3a99d]">{c.health.reasons.map((r) => r.text).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-[#a3a99d]">
                  {STANDING_LABEL[c.standing]}
                  <Light light={c.health.light} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active clients" value={o.counts.active} info="Restaurants that finished setup and can use DinerAI today (trial, paying, pilot or exempt), not closing." href="/admin/clients?status=active" />
        <Stat label="Free trial" value={o.counts.trialing} info="Active, on the free month (Stripe or the app store)." href="/admin/clients?status=trialing" />
        <Stat label="Paying" value={o.counts.paying} change={delta(cur.payingAtEnd, prev.payingAtEnd)} info="On a paid subscription (Stripe active or past due, or the app store's). Change: against the end of last month." foot={o.counts.pastDue ? `${o.counts.pastDue} payment failed` : undefined} href="/admin/clients?status=paying" />
        <Stat label="Pilot / free" value={o.counts.pilot} good="none" info="Active by invite code or billing exempt: never billed, so not in paying, churn or MRR." href="/admin/clients?status=pilot" />
        <Stat label="In setup" value={o.counts.inSetup} good="none" info="Signed up, setup not finished." href="/admin/clients?status=setup" />
        <Stat label="New this month" value={cur.newClients} change={delta(cur.newClients, prev.newClients)} info="Restaurants whose free trial, first paid month or pilot started this month." />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="MRR"
          value={pounds(o.mrr.afterFeesPence)}
          info="Monthly recurring revenue after Apple and Google's 15%: each paying client's last payment in the last 40 days (FOUNDER £50, full £99), or £99 if none recorded yet. VAT included."
          foot={<>{pounds(o.mrr.pence)} before store fees · {pounds(o.mrr.vatPence)} is VAT{o.mrr.estimated ? ` · ${o.mrr.estimated} estimated` : ""}</>}
        />
        <Stat label="Paid churn" value={pct(prev.churnRate)} good="down" change={prev.churnRate !== null && m[m.length - 3].churnRate !== null ? delta(prev.churnRate, m[m.length - 3].churnRate!, "rate") : null} info="Last full month: paying clients at its start who had cancelled or stopped paying by its end, divided by paying clients at its start." foot={`${prev.churned} of ${prev.payingAtStart} in ${prev.label}`} />
        <Stat label="Trial to paid" value={pct(prev.conversionRate)} change={prev.conversionRate !== null && m[m.length - 3].conversionRate !== null ? delta(prev.conversionRate, m[m.length - 3].conversionRate!, "rate") : null} info="Last full month: of the free trials that ended, the share that went on to a paid month. The rest is free-to-paid churn." foot={`${prev.converted} of ${prev.trialsEnded} trials in ${prev.label}`} />
        <Stat label="Avg months paid" value={o.retention.avgMonths === null ? "–" : o.retention.avgMonths.toFixed(1)} info="Average paid months per client who has ever paid, counting those still paying up to today." foot={o.retention.still.map((s) => `${s.months}mo: ${pct(s.rate)}`).join(" · ") + " still paying"} />
        <Stat label="Claude this month" value={usd(o.aiThisMonthUsd)} good="down" change={null} info="Every Claude call this month, all restaurants plus calls not tied to one. Before the cost log started, agent and setup costs only." foot={`≈ ${pounds(o.aiThisMonthUsd * o.settings.usdToGbp * 100, { exact: true })}`} />
        <Stat label="Gross margin" value={pct(margin)} info="This month: 1 minus all running costs (Claude, WhatsApp, email, fixed bills on the Costs page) over MRR after store fees and VAT." foot={mrrPerClient !== null ? `${pounds(mrrPerClient)} in, ${pounds(costPerPaying ?? 0)} cost per paying client` : "No paying clients yet"} href="/admin/costs" />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MonthBars title="Paying clients" info="At the end of each month" months={m.map((x) => ({ label: x.label, value: x.payingAtEnd }))} format={(v) => String(v)} />
        <MonthBars title="New clients" info="Trials, paid starts and pilots" months={m.map((x) => ({ label: x.label, value: x.newClients }))} format={(v) => String(v)} />
        <MonthBars title="Revenue received" info="What clients paid, after store fees, VAT included" months={m.map((x) => ({ label: x.label, value: x.revenueAfterFeesPence }))} format={(v) => pounds(v)} />
        <MonthBars title="Paid churn" info="Share of paying clients lost in the month" tone="ember" months={m.map((x) => ({ label: x.label, value: x.churnRate === null ? null : x.churnRate * 100 }))} format={(v) => `${v.toFixed(0)}%`} />
        <MonthBars title="Trial to paid" info="Share of trials ending that month that paid" tone="sky" months={m.map((x) => ({ label: x.label, value: x.conversionRate === null ? null : x.conversionRate * 100 }))} format={(v) => `${v.toFixed(0)}%`} />
        <MonthBars title="Claude cost" info="US dollars, all calls" tone="ember" months={m.map((x, i) => ({ label: x.label, value: o.aiByMonthUsd[i] }))} format={(v) => usd(v)} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2>Setup funnel</H2>
          <div className="space-y-2">
            {o.funnel.map((f, i) => {
              const top = o.funnel[0].count || 1;
              const prevCount = i ? o.funnel[i - 1].count : null;
              return (
                <div key={f.label}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#edefe8]">{f.label}</span>
                    <span className="font-mono text-[#a3a99d]">
                      {f.count}
                      {prevCount ? <span className="text-[#6e7468]"> · {pct(f.count / prevCount)} of the step before</span> : null}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-[#1e221b]">
                    <div className="h-2 rounded-full bg-[#c8f03c]" style={{ width: `${(f.count / top) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-[#6e7468]">Every real sign-up ever. Time to value (sign-up to first approval, median): {o.timeToValueDays === null ? "nobody yet" : `${o.timeToValueDays.toFixed(1)} days`}.</p>
        </Card>

        <Card>
          <H2>Trials ending in the next 14 days</H2>
          {o.trialsEnding.length ? (
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[#6e7468]">
                <tr>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">Ends</th>
                  <th className="pb-2 text-right">Approvals (7 days)</th>
                </tr>
              </thead>
              <tbody>
                {o.trialsEnding.map((c) => (
                  <tr key={c.r.id} className="border-t border-[#1e221b]">
                    <td className="py-1.5">
                      <Link href={`/admin/clients/${c.r.id}`} className="text-[#edefe8] hover:underline">
                        {c.r.name}
                      </Link>
                    </td>
                    <td className="py-1.5 text-[#a3a99d]">{day(c.trialEndsAt)}</td>
                    <td className={`py-1.5 text-right font-mono ${c.approvals7d < 3 ? "text-[#ffb23d]" : "text-[#edefe8]"}`}>{c.approvals7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-[#a3a99d]">None.</p>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Engaged this week" value={`${o.engagement.engaged} of ${o.engagement.active}`} info="Active clients who approved at least one thing in the last 7 days." />
        <Stat label="Approvals" value={o.engagement.approvalsThisMonth} change={delta(o.engagement.approvalsThisMonth, o.engagement.approvalsLastMonth)} info="Drafts approved this month by real clients (change: against all of last month)." />
        <Stat label="Failed payments" value={pounds(o.pastDuePence)} good="down" info="Clients whose last payment failed x £99: money at risk. Stripe and the stores keep retrying." />
        <Stat label="Referrals" value={o.referrals.used} info="Clients who signed up with another restaurant's code." foot={`${o.referrals.stillPaying} paying · ${o.referrals.credited} free months given`} />
        <Stat label="FOUNDER code" value={`${o.founderCode.used} / ${o.founderCode.max}`} good="none" info="App store FOUNDER offers claimed (Stripe's own count of the coupon is in the Stripe dashboard)." />
        <Stat label="System" value={o.system.dead7d} good="down" info="Jobs that gave up in the last 7 days (real clients and system jobs). Alerts: builder alerts sent in 7 days." foot={`${o.system.alerts7d} alerts in 7 days`} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2 aside={<Link href="/admin/costs" className="text-[13px] text-[#a3a99d] hover:text-[#edefe8]">Costs page</Link>}>Claude this month by use</H2>
          {o.byPurpose.length ? (
            <table className="w-full text-[13px]">
              <tbody>
                {o.byPurpose.map((p) => (
                  <tr key={p.purpose} className="border-t border-[#1e221b]">
                    <td className="py-1.5 text-[#edefe8]">{p.purpose}</td>
                    <td className="py-1.5 text-right text-[#6e7468]">{p.calls} calls</td>
                    <td className="py-1.5 text-right font-mono text-[#edefe8]">{usd(p.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-[#a3a99d]">Nothing recorded this month yet.</p>
          )}
          {o.unattributedUsd > 0 && <p className="mt-2 text-[12px] text-[#6e7468]">{usd(o.unattributedUsd)} wasn&apos;t tied to one restaurant (sign-ups, the builder, system jobs).</p>}
        </Card>
        <Card>
          <H2>What clients got this month</H2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[24px] font-semibold text-[#edefe8]">{o.value.approvals}</div>
              <div className="text-[12px] text-[#a3a99d]">drafts approved</div>
            </div>
            <div>
              <div className="text-[24px] font-semibold text-[#edefe8]">{o.value.emails}</div>
              <div className="text-[12px] text-[#a3a99d]">customer emails sent</div>
            </div>
            <div>
              <div className="text-[24px] font-semibold text-[#edefe8]">{(o.value.minutesSaved / 60).toFixed(1)}h</div>
              <div className="text-[12px] text-[#a3a99d]">time saved</div>
            </div>
          </div>
        </Card>
      </section>
    </AdminPage>
  );
}
