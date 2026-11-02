import { changeLine, gbp, labourLine, MONTHLY_FOOTNOTE, ordinal, type MonthlyReportData } from "@/lib/report/monthly-rules";
import { whatsappLink } from "@/lib/report/types";

// The monthly report on the owner's phone (the same content as its PDF).

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-stone-500">{title}</h2>}
      {children}
    </section>
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

export function MonthlyReport({ token, data, createdAt }: { token: string; data: MonthlyReportData; createdAt: string }) {
  const f = data.figures;
  const brand = data.restaurant.brandColor;
  const lfl = f.vsLastMonth?.likeForLike;
  const max = Math.max(1, ...f.daily.map((d) => d.net ?? 0));
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
          <p className="text-lg font-bold leading-snug">{data.words.headline}</p>
          {data.words.summary !== data.words.headline && <p className="mt-2 text-sm text-stone-600">{data.words.summary}</p>}
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-2xl font-bold tabular-nums">{gbp(f.net)}</p>
              <p className="text-xs text-stone-500">net, {f.traded} trading days</p>
            </div>
            {f.orders ? (
              <div>
                <p className="text-2xl font-bold tabular-nums">{f.orders.toLocaleString("en-GB")}</p>
                <p className="text-xs text-stone-500">orders, {gbp(f.avgOrder ?? 0)} average</p>
              </div>
            ) : null}
            {lfl != null && (
              <div>
                <p className={`text-2xl font-bold tabular-nums ${lfl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {lfl >= 0 ? "+" : "-"}
                  {Math.abs(lfl)}%
                </p>
                <p className="text-xs text-stone-500">vs {f.vsLastMonth!.label}, like for like</p>
              </div>
            )}
          </div>
          <div className="mt-3 space-y-1 text-sm text-stone-600">
            {f.vsLastMonth && <p>{changeLine(f.vsLastMonth)}.</p>}
            {f.vsLastYear && <p>{changeLine(f.vsLastYear)}.</p>}
          </div>
        </Card>

        <Card title="Day by day">
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

        {(f.movers.length > 0 || f.closures.length > 0) && (
          <Card title="What moved the month">
            <ul className="space-y-2 text-sm">
              {f.movers.map((m) => (
                <li key={m.day}>
                  <b>{m.label}</b>: {gbp(m.net)},{" "}
                  <span className={m.diff >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {m.diff >= 0 ? "+" : "-"}
                    {gbp(Math.abs(m.diff))}
                  </span>{" "}
                  on a usual {m.label.split(" ")[0]}. {m.reason}.
                </li>
              ))}
              {f.closures.map((c) => (
                <li key={c.day}>
                  <b>{c.label}</b>: no sales (closed?). A usual day like it takes {gbp(c.usual)}.
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Your week">
          <Bars rows={f.weekdays.filter((w) => w.avg !== null).map((w) => ({ label: `${w.weekday} (average)`, value: w.avg! }))} brand={brand} />
          {f.hours && (
            <p className="mt-3 text-sm text-stone-600">
              Busiest hour: <b>{f.hours.busiest}</b>. Quietest: <b>{f.hours.quietest}</b>.
            </p>
          )}
        </Card>

        {f.dishes && (
          <Card title="Your dishes">
            <Bars rows={f.dishes.top.map((d) => ({ label: d.item, value: d.amount }))} brand={brand} />
            <div className="mt-3 space-y-1 text-sm text-stone-600">
              <p>Your top 3 dishes are {f.dishes.topShare}% of dish sales.</p>
              {f.dishes.rising.length > 0 && <p>Rising: {f.dishes.rising.map((d) => `${d.item} +${d.change}%`).join(", ")}.</p>}
              {f.dishes.falling.length > 0 && <p>Falling: {f.dishes.falling.map((d) => `${d.item} ${d.change}%`).join(", ")}.</p>}
              {f.dishes.slow.length > 0 && <p>Selling under 5 a week: {f.dishes.slow.map((d) => d.item).join(", ")}.</p>}
            </div>
          </Card>
        )}

        {(f.labour || f.reviews) && (
          <Card title="Staff and reviews">
            <div className="grid grid-cols-2 gap-4">
              {f.labour && (
                <div>
                  <p className={`text-2xl font-bold ${f.labour.target ? (f.labour.pct <= f.labour.target ? "text-emerald-700" : "text-red-700") : ""}`}>{f.labour.pct}%</p>
                  <p className="text-xs text-stone-500">{labourLine(f.labour, f.traded)}</p>
                </div>
              )}
              {f.reviews && (
                <div>
                  <p className="text-2xl font-bold">{f.reviews.count}</p>
                  <p className="text-xs text-stone-500">new Google reviews{f.reviews.average ? `, ${f.reviews.average} stars average` : ""}</p>
                </div>
              )}
            </div>
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

        {f.missing.length > 0 && (
          <Card title="More next month">
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
              {f.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Card>
        )}

        <p className="pt-2 text-center text-xs text-stone-500">
          {MONTHLY_FOOTNOTE} Made{" "}
          {new Date(createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </p>
      </main>
    </div>
  );
}
