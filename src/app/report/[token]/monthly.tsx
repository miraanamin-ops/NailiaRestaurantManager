import { gbp, highlightsOf, labourLine, MONTHLY_FOOTNOTE, notIncluded, ordinal, type MonthlyReportData } from "@/lib/report/monthly-rules";
import { whatsappLink } from "@/lib/report/types";
import { benchmarkTitle, STAND } from "@/lib/report/benchmark-rules";

// The monthly report on the owner's phone (the same content as its PDF): numbers and
// charts, the 3 or 4 key messages about them, then three actions.

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-stone-500">{title}</h2>}
      {children}
    </section>
  );
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <p className={`text-xl font-bold tabular-nums ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : ""}`}>{value}</p>
      <p className="text-xs text-stone-500">{label}</p>
    </div>
  );
}

function Bars({ rows, brand }: { rows: { label: string; value: number }[]; brand: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-stone-600">{r.label}</span>
          <span className="h-2.5 flex-1 rounded-full bg-stone-100">
            <span className="block h-2.5 rounded-full" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: brand }} />
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums">{gbp(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const pct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n)}%`;

export function MonthlyReport({ token, data, createdAt }: { token: string; data: MonthlyReportData; createdAt: string }) {
  const f = data.figures;
  const brand = data.restaurant.brandColor;
  const lfl = f.vsLastMonth?.likeForLike;
  const yoy = f.vsLastYear?.likeForLike;
  const max = Math.max(1, ...f.daily.map((d) => d.net ?? 0));
  const left = notIncluded(f);
  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-4 pb-10 pt-8 text-white" style={{ background: data.restaurant.brandDark }}>
        <div className="mx-auto max-w-xl">
          <div className="mb-3 h-1 w-10 rounded-full" style={{ background: brand }} />
          <p className="text-sm text-stone-300">Monthly report · {f.label}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.restaurant.name}</h1>
          {data.simulated && <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">{data.simulated}</p>}
          <a href={`/report/${token}/pdf`} className="mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-stone-900 active:opacity-80" style={{ background: brand }}>
            Download PDF
          </a>
        </div>
      </header>
      <main className="mx-auto -mt-5 w-full max-w-xl space-y-4 px-4 pb-12">
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <Tile value={gbp(f.net)} label={`net takings, ${f.traded} trading days`} />
            {f.orders ? <Tile value={f.orders.toLocaleString("en-GB")} label={`orders, ${gbp(f.avgOrder ?? 0)} average`} /> : null}
            {lfl != null && <Tile value={pct(lfl)} label={`vs ${f.vsLastMonth!.label.split(" ")[0]}, like for like`} tone={lfl >= 0 ? "good" : "bad"} />}
            {yoy != null && <Tile value={pct(yoy)} label={`vs ${f.vsLastYear!.label}`} tone={yoy >= 0 ? "good" : "bad"} />}
          </div>
        </Card>

        <Card title="What stood out">
          <ul className="space-y-3 border-l-4 pl-4" style={{ borderColor: brand }}>
            {highlightsOf(data).map((h) => (
              <li key={h.title}>
                <p className="font-semibold leading-snug">{h.title}</p>
                {h.detail && <p className="text-sm text-stone-600">{h.detail}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Takings day by day">
          <div className="flex h-24 items-end gap-px" aria-label="Takings each day">
            {f.daily.map((d) => (
              <span
                key={d.day}
                title={`${d.day}: ${d.net ? gbp(d.net) : "no sales"}`}
                className="flex-1 rounded-t-sm"
                style={{ height: `${d.net ? Math.max(3, (d.net / max) * 100) : 3}%`, background: d.net ? brand : "#d6d3d1" }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-stone-500">
            <span>1st</span>
            <span>{ordinal(f.days)}</span>
          </div>
        </Card>

        <Card title="Average by weekday">
          <Bars rows={f.weekdays.filter((w) => w.avg !== null).map((w) => ({ label: w.weekday, value: w.avg! }))} brand={brand} />
          {f.hours && (
            <p className="mt-3 text-sm text-stone-600">
              Busiest hour: <b>{f.hours.busiest}</b>. Quietest: <b>{f.hours.quietest}</b>.
            </p>
          )}
        </Card>

        {f.dishes && (
          <Card title="Top dishes">
            <Bars rows={f.dishes.top.map((d) => ({ label: d.item, value: d.amount }))} brand={brand} />
          </Card>
        )}

        {(f.labour || f.reviews) && (
          <Card>
            <div className="grid grid-cols-2 gap-3">
              {f.labour && (
                <Tile value={`${f.labour.pct}%`} label={labourLine(f.labour, f.traded)} tone={f.labour.target ? (f.labour.pct <= f.labour.target ? "good" : "bad") : undefined} />
              )}
              {f.reviews && <Tile value={String(f.reviews.count)} label={`new Google reviews${f.reviews.average ? `, ${f.reviews.average} stars average` : ""}`} />}
            </div>
          </Card>
        )}

        {data.benchmark && (
          <Card title="How you compare nearby">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="pb-2 font-normal" />
                  <th className="pb-2 text-right font-normal">You</th>
                  <th className="pb-2 text-right font-normal">Nearby</th>
                  <th className="pb-2 text-right font-normal">Where you stand</th>
                </tr>
              </thead>
              <tbody>
                {data.benchmark.rows.map((r) => (
                  <tr key={r.key} className="border-t border-stone-100">
                    <td className="py-2 pr-2 text-stone-600">{r.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.you}</td>
                    <td className="py-2 text-right tabular-nums">{r.nearby}</td>
                    <td className="py-2 pl-2 text-right text-xs font-medium" style={{ color: STAND[r.position] }}>
                      {r.position}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-stone-500">{benchmarkTitle(data.benchmark)}. Nearby = the middle restaurant (median); no restaurant&apos;s own figures are shown.</p>
          </Card>
        )}

        <Card title="Three things for next month">
          <ol className="space-y-4">
            {data.words.actions.map((a, i) => {
              const link = whatsappLink(data.whatsappNumber, a.message);
              return (
                <li key={a.title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-stone-900" style={{ background: brand }}>
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold">{a.title}</p>
                    {a.why && <p className="text-sm text-stone-600">{a.why}</p>}
                    {link && (
                      <a href={link} className="mt-2 inline-block rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white">
                        Start in WhatsApp
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <p className="pt-2 text-center text-xs text-stone-500">
          {left ? `${left} ` : ""}
          {MONTHLY_FOOTNOTE} Made{" "}
          {new Date(createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </p>
      </main>
    </div>
  );
}
