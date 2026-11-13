import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/app-shell";
import { requireFounder } from "@/lib/founder/access";
import { loadFixedCosts, loadOverview } from "@/lib/founder/data";
import { pounds } from "@/lib/founder/metrics";
import { addCost, deleteCost, endCost, saveSettings } from "../actions";
import { AdminPage, Card, day, H1, H2, MonthBars } from "../_ui";

// Running costs: Claude (recorded per call), WhatsApp and email (counted x the
// prices below) and fixed monthly bills typed in here.
export default function CostsPage({ searchParams }: PageProps<"/admin/costs">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Costs searchParams={searchParams} />
    </Suspense>
  );
}

const input = "h-9 rounded-full bg-[#0b0c0a] px-3 text-[13px] text-[#edefe8] ring-1 ring-[#2c3127]";
const btn = "inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium ring-1 ring-[#2c3127] text-[#edefe8] hover:ring-[#3a4034]";

async function Costs({ searchParams }: Pick<PageProps<"/admin/costs">, "searchParams">) {
  await connection();
  await requireFounder("/admin/costs");
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const [o, fixed] = await Promise.all([loadOverview(), loadFixedCosts()]);
  const m = o.costMonths;
  const labels = o.months.map((x) => x.label);
  const cur = m[m.length - 1];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AdminPage>
      <H1 sub="What it costs to run DinerAI. Claude is recorded on every call; WhatsApp and email are counts x the prices below; fixed bills are what you type in.">Costs</H1>
      {one("done") && <div className="rounded-2xl bg-[#c8f03c]/10 px-4 py-3 text-[14px] text-[#e4f9a8] ring-1 ring-[#c8f03c]/25">{one("done")}</div>}
      {one("error") && <div className="rounded-2xl bg-[#ff8a6e]/10 px-4 py-3 text-[14px] text-[#ffc9ba] ring-1 ring-[#ff8a6e]/30">{one("error")}</div>}

      <section className="grid gap-3 md:grid-cols-2">
        <MonthBars title="All running costs" info="Claude, WhatsApp, email and fixed bills, in pounds" tone="ember" months={m.map((x, i) => ({ label: labels[i], value: x.totalPence }))} format={(v) => pounds(v)} />
        <Card>
          <H2>This month so far</H2>
          <table className="w-full text-[14px]">
            <tbody>
              {[
                ["Claude", cur.aiPence],
                ["WhatsApp messages", cur.whatsappPence],
                ["Customer emails", cur.emailPence],
                ["Fixed bills", cur.fixedPence],
              ].map(([label, v]) => (
                <tr key={label as string} className="border-t border-[#1e221b]">
                  <td className="py-2 text-[#edefe8]">{label}</td>
                  <td className="py-2 text-right font-mono text-[#edefe8]">{pounds(v as number, { exact: true })}</td>
                </tr>
              ))}
              <tr className="border-t border-[#2c3127]">
                <td className="py-2 font-semibold text-[#edefe8]">Total</td>
                <td className="py-2 text-right font-mono font-semibold text-[#edefe8]">{pounds(cur.totalPence, { exact: true })}</td>
              </tr>
              <tr>
                <td className="py-2 text-[#a3a99d]">MRR after store fees, without VAT</td>
                <td className="py-2 text-right font-mono text-[#a3a99d]">{pounds(o.mrr.afterFeesPence - o.mrr.vatPence, { exact: true })}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-[#6e7468]">Google Places calls, Stripe&apos;s fees and the analytics server&apos;s usage aren&apos;t counted per call: add them as fixed bills.</p>
        </Card>
      </section>

      <section>
        <H2>Fixed monthly bills</H2>
        <Card>
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-wider text-[#6e7468]">
              <tr>
                <th className="pb-2 font-medium">Bill</th>
                <th className="pb-2 font-medium">A month</th>
                <th className="pb-2 font-medium">From</th>
                <th className="pb-2 font-medium">Until</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {fixed.map((f) => (
                <tr key={f.id} className="border-t border-[#1e221b]">
                  <td className="py-2 text-[#edefe8]">
                    {f.name}
                    {f.note && <div className="text-[11px] text-[#6e7468]">{f.note}</div>}
                  </td>
                  <td className="py-2 font-mono text-[#edefe8]">{pounds(f.monthly_pence, { exact: true })}</td>
                  <td className="py-2 text-[#a3a99d]">{day(f.starts_on)}</td>
                  <td className="py-2 text-[#a3a99d]">{f.ends_on ? day(f.ends_on) : "Still running"}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {!f.ends_on && (
                        <form action={endCost}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className={btn}>Stop from today</button>
                        </form>
                      )}
                      <form action={deleteCost}>
                        <input type="hidden" name="id" value={f.id} />
                        <button className={`${btn} text-[#ff8a6e]`}>Remove</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {!fixed.length && (
                <tr>
                  <td colSpan={5} className="py-3 text-[#a3a99d]">
                    None yet. Add Vercel, Supabase, Railway, the Apple developer account, domains, Resend and Twilio&apos;s monthly fees.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form action={addCost} className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1e221b] pt-4">
            <input name="name" required placeholder="e.g. Vercel Pro" className={`${input} min-w-[180px] flex-1`} />
            <input name="monthly" required inputMode="decimal" placeholder="£ a month" className={`${input} w-28`} />
            <label className="flex items-center gap-1 text-[12px] text-[#a3a99d]">
              from <input type="date" name="starts" defaultValue={today} className={input} />
            </label>
            <input name="note" placeholder="Note (optional)" className={`${input} min-w-[160px] flex-1`} />
            <button className="inline-flex h-9 items-center rounded-full bg-[#c8f03c] px-4 text-[13px] font-semibold text-[#0b0c0a]">Add</button>
          </form>
          <p className="mt-2 text-[12px] text-[#6e7468]">A yearly bill: enter it divided by 12.</p>
        </Card>
      </section>

      <section>
        <H2>Prices used for estimates</H2>
        <Card>
          <form action={saveSettings} className="flex flex-wrap items-end gap-4">
            <label className="text-[12px] text-[#a3a99d]">
              Pounds per US dollar
              <input name="usdToGbp" defaultValue={o.settings.usdToGbp} inputMode="decimal" className={`${input} mt-1 block w-32`} />
            </label>
            <label className="text-[12px] text-[#a3a99d]">
              Pence per WhatsApp message
              <input name="whatsappPence" defaultValue={o.settings.whatsappPence} inputMode="decimal" className={`${input} mt-1 block w-32`} />
            </label>
            <label className="text-[12px] text-[#a3a99d]">
              Pence per customer email
              <input name="emailPence" defaultValue={o.settings.emailPence} inputMode="decimal" className={`${input} mt-1 block w-32`} />
            </label>
            <button className={btn}>Save prices</button>
          </form>
          <p className="mt-2 text-[12px] text-[#6e7468]">Claude&apos;s cost is worked out from tokens at Anthropic&apos;s list prices, in dollars; this rate turns it into pounds.</p>
        </Card>
      </section>
    </AdminPage>
  );
}
