import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { btnPrimary, btnSecondary, EmptyCard, Eyebrow, Notice, Page, PageHeader, Panel, Pill, Section, Tile, WhatsAppTip } from "@/components/ui";
import { ownerPage } from "@/lib/dashboard/page-context";
import { changeLabel } from "@/lib/dashboard/rules";
import { salesOverview, type SalesOverview, type SalesPeriod } from "@/lib/dashboard/sales";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { showNumber, whatsAppLink } from "@/lib/onboarding/steps";
import { dayLabel, gbp } from "@/lib/sales/format";
import { salesPageData } from "@/lib/sales/page-data";

export const metadata: Metadata = { title: "Sales · DinerAI", robots: { index: false, follow: false } };

const SOURCE: Record<string, string> = { z_report: "Till report", pos: "POS file", seed: "Dummy" };
const Z_STATUS: Record<string, { label: string; tone: "signal" | "amber" | "neg" }> = {
  saved: { label: "Saved", tone: "signal" },
  needs_confirm: { label: "Waiting for YES", tone: "amber" },
  needs_date: { label: "Waiting for the date", tone: "amber" },
  needs_replace: { label: "Replace?", tone: "amber" },
  unreadable: { label: "Couldn't read", tone: "neg" },
};
const IMPORT_STATUS: Record<string, string> = {
  imported: "Imported",
  needs_mapping: "Check the columns",
  failed: "Couldn't import",
  cancelled: "Cancelled",
};
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const HEAT = ["bg-[#1e221b]", "bg-[#c8f03c]/20", "bg-[#c8f03c]/45", "bg-[#c8f03c]/70", "bg-[#c8f03c]"];

// The owner's sales page: how the money is doing (from the till, sales files and
// till reports), and where the numbers come from (upload a file, till reports by
// WhatsApp, staff numbers).
export default function SalesPage({ searchParams }: PageProps<"/sales">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

async function Sales({ searchParams }: Pick<PageProps<"/sales">, "searchParams">) {
  const { owner, restaurant, choices, one, now } = await ownerPage("/sales", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const restaurantId = restaurant.id;
  const period: SalesPeriod = one("period") === "month" ? "month" : "week";
  const [data, overview] = await Promise.all([salesPageData(restaurantId), salesOverview(restaurantId, now, period)]);
  const year = new Date().getFullYear();
  const range = `${dayLabel(overview.start, year)} to ${dayLabel(overview.end, year)}`;
  const toggle = (p: SalesPeriod, label: string) => (
    <a
      href={`/sales?r=${restaurantId}${p === "month" ? "&period=month" : ""}`}
      className={`rounded-full px-3.5 py-1.5 text-[13px] ${period === p ? "bg-[#c8f03c] font-semibold text-[#0b0c0a]" : "text-[#a3a99d] hover:text-[#edefe8]"}`}
    >
      {label}
    </a>
  );

  return (
    <Page>
      <RestaurantSwitcher choices={choices} current={restaurantId} path="/sales" />
      <PageHeader
        eyebrow="Sales"
        title="Sales"
        sub={overview.hasData ? `${range} · before VAT` : undefined}
        action={
          <div className="inline-flex rounded-full bg-[#171a14] p-1 ring-1 ring-[#2c3127]">
            {toggle("week", "Week")}
            {toggle("month", "4 weeks")}
          </div>
        }
      />
      <div className="space-y-4">
        {one("msg") && <Notice>{one("msg")}</Notice>}
        {one("error") && <Notice tone="neg">{one("error")}</Notice>}
      </div>

      {overview.hasData ? (
        <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Panel className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[30px] font-semibold tracking-[-0.02em] text-[#edefe8]">{gbp(overview.takings.now)}</div>
                {overview.takings.pct !== null && (
                  <Pill tone={overview.takings.dir === "down" ? "neg" : "signal"}>
                    {changeLabel(overview.takings)} vs the {period === "week" ? "week" : "4 weeks"} before
                  </Pill>
                )}
              </div>
              <div className="text-[14px] text-[#a3a99d]">taken {period === "week" ? "in the last 7 days" : "in the last 4 weeks"}</div>
              {overview.headline && (
                <div className="flex items-start gap-2.5 rounded-xl bg-[#1e221b] p-3">
                  <Icon name="spark" className="mt-0.5 h-4 w-4 text-[#c8f03c]" />
                  <p className="text-[14px] leading-snug text-[#edefe8]">{overview.headline}</p>
                </div>
              )}
            </Panel>

            <DayChart overview={overview} />

            <div className="grid grid-cols-3 gap-2.5">
              <Tile
                label="Orders"
                value={overview.orders ? overview.orders.now.toLocaleString("en-GB") : "–"}
                change={overview.orders}
                changeText={overview.orders ? changeLabel(overview.orders) : undefined}
                foot={overview.orders ? `${Math.round(overview.orders.now / overview.days.length)} a day` : "Not in your data"}
              />
              <Tile
                label="Avg spend"
                value={overview.avgSpend ? gbp(overview.avgSpend.now, true) : "–"}
                change={overview.avgSpend}
                changeText={overview.avgSpend ? changeLabel(overview.avgSpend) : undefined}
                foot={overview.avgSpend ? `${gbp(overview.avgSpend.before, true)} before` : "Per order"}
              />
              <Tile label="Best day" value={bestDay(overview)} foot={gbp(Math.max(...overview.days.map((d) => d.net)))} />
            </div>

            <Heatmap overview={overview} />
          </div>

          <div className="space-y-6">
            <Dishes overview={overview} />
            <NextWeek overview={overview} />
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <EmptyCard
            icon="sales"
            title="See your sales here"
            text="Upload an export from your till below, or send a photo of your end-of-day till report on WhatsApp. I'll track your takings and warn you before quiet days."
          >
            <a href="#upload" className={btnPrimary}>
              Upload a sales file
            </a>
            <a href={whatsAppLink(ourWhatsAppNumber(), "")} target="_blank" rel="noreferrer" className={btnSecondary}>
              Send a till report
            </a>
          </EmptyCard>
        </div>
      )}

      <div className="mt-10 space-y-6">
        <Section title="Where your numbers come from">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3" >
              <div id="upload" className="flex items-center gap-2">
                <Icon name="upload" className="h-5 w-5 text-[#a3a99d]" />
                <h3 className="text-[15px] font-medium text-[#edefe8]">Upload a sales file</h3>
              </div>
              <p className="text-[13px] text-[#a3a99d]">
                An export from your till (CSV or Excel). The first time, I&apos;ll show you which column I think is which; after that, files like it import
                straight away. You can also just send the file on WhatsApp.
              </p>
              <form action="/sales/upload" method="post" encType="multipart/form-data" className="space-y-3">
                <input type="hidden" name="r" value={restaurantId} />
                <input
                  type="file"
                  name="file"
                  required
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="block w-full rounded-xl bg-[#121410] px-3 py-3 text-[13px] text-[#a3a99d] ring-1 ring-[#2c3127] file:mr-3 file:rounded-full file:border-0 file:bg-[#1e221b] file:px-3 file:py-1.5 file:text-[#edefe8]"
                />
                <button className={`${btnPrimary} w-full`}>Upload</button>
              </form>
              <p className="text-[12px] text-[#6e7468]">
                No file handy?{" "}
                <a className="underline" href="/samples/pos-export-sample.csv" download>
                  Download a sample POS export
                </a>{" "}
                and upload it. Up to 4 MB.
              </p>
              {data.imports.length > 0 && (
                <ul className="divide-y divide-[#1e221b] border-t border-[#1e221b] text-[13px]">
                  {data.imports.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-[#edefe8]">{i.file_name ?? (i.channel === "whatsapp" ? "Sent on WhatsApp" : "Uploaded file")}</div>
                        <div className="text-[#a3a99d]">
                          {i.first_day && i.last_day ? `${dayLabel(i.first_day, year)} to ${dayLabel(i.last_day, year)} · ` : ""}
                          {i.rows_imported !== null ? `${i.rows_imported} lines` : `${i.rows_total ?? 0} rows`}
                          {i.rows_duplicate ? `, ${i.rows_duplicate} already in` : ""}
                        </div>
                      </div>
                      {i.status === "needs_mapping" ? (
                        <Link href={`/sales/import/${i.id}?r=${restaurantId}`} className="shrink-0 font-medium text-[#c8f03c] underline">
                          Check the columns
                        </Link>
                      ) : (
                        <span className="shrink-0 text-[#a3a99d]" title={i.error ?? undefined}>
                          {IMPORT_STATUS[i.status]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon name="whatsapp" className="h-5 w-5 text-[#a3a99d]" />
                <h3 className="text-[15px] font-medium text-[#edefe8]">End-of-day till reports</h3>
              </div>
              <p className="text-[13px] text-[#a3a99d]">Send a photo of your end-of-day till report (Z-report) on WhatsApp. Staff numbers can send them too.</p>
              <a href={whatsAppLink(ourWhatsAppNumber(), "")} target="_blank" rel="noreferrer" className={`${btnSecondary} w-full`}>
                <Icon name="whatsapp" className="h-4 w-4 text-[#c8f03c]" /> Open WhatsApp
              </a>
              {data.zReports.length ? (
                <ul className="divide-y divide-[#1e221b] border-t border-[#1e221b] text-[13px]">
                  {data.zReports.map((z) => {
                    const st = Z_STATUS[z.status];
                    return (
                      <li key={z.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-[#edefe8]">{z.business_date ? dayLabel(z.business_date, year) : "Date not read"}</div>
                          <div className="text-[#a3a99d]">
                            {z.net_sales !== null ? `${gbp(Number(z.net_sales))} net` : "No total"}
                            {z.transactions !== null ? ` · ${z.transactions} sales` : ""}
                            {z.sender_role === "staff" ? " · from staff" : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {st && <Pill tone={st.tone}>{st.label}</Pill>}
                          {z.photoUrl && (
                            <a href={z.photoUrl} target="_blank" rel="noreferrer" className="text-[#c8f03c] underline">
                              Photo
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-[#6e7468]">None yet.</p>
              )}
            </Panel>
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Day by day">
            <Panel>
              {data.days.length ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[#6e7468]">
                      <th className="py-1 font-medium">Day</th>
                      <th className="py-1 text-right font-medium">Net sales</th>
                      <th className="py-1 text-right font-medium">Orders</th>
                      <th className="py-1 pl-3 font-medium">From</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e221b]">
                    {data.days.map((d) => (
                      <tr key={d.day}>
                        <td className="py-2 text-[#edefe8]">{dayLabel(d.day, year)}</td>
                        <td className="py-2 text-right tabular-nums text-[#edefe8]">
                          {gbp(Number(d.net_sales))}
                          {d.net_estimated ? "*" : ""}
                        </td>
                        <td className="py-2 text-right tabular-nums text-[#a3a99d]">{d.transactions ?? "–"}</td>
                        <td className="py-2 pl-3 text-[#a3a99d]">{SOURCE[d.source] ?? d.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-[#6e7468]">No sales figures yet.</p>
              )}
              {data.days.some((d) => d.net_estimated) && <p className="mt-2 text-[12px] text-[#6e7468]">* POS files give totals with VAT; net worked out at 20% VAT.</p>}
            </Panel>
          </Section>

          <div className="space-y-6">
            <Section title="Staff numbers">
              <Panel className="space-y-2">
                <p className="text-[13px] text-[#a3a99d]">
                  They can send till reports and sales files, nothing else. Add one on WhatsApp: <span className="text-[#edefe8]">ADD STAFF +447700900123</span> (and REMOVE
                  STAFF to take them off).
                </p>
                {data.staff.length ? (
                  <ul className="space-y-1 text-[14px] text-[#edefe8]">
                    {data.staff.map((s) => (
                      <li key={s.id}>{showNumber(s.whatsapp)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-[#6e7468]">None yet.</p>
                )}
              </Panel>
            </Section>
            <Section title="Weather">
              <Panel>
                <p className="text-[13px] text-[#a3a99d]">
                  Stored every day for your address, to help forecast busy and quiet days.{" "}
                  {data.weather.days ? `${data.weather.days} days stored.` : "Nothing stored yet (it starts with the next hourly check)."}
                </p>
                {data.weather.last && (
                  <p className="mt-1 text-[14px] text-[#edefe8]">
                    {dayLabel(data.weather.last.day, year)}: {data.weather.last.temp_max ?? "?"}°C, {data.weather.last.rain_mm ?? 0}mm rain
                    {data.weather.last.conditions ? ` (${data.weather.last.conditions.toLowerCase()})` : ""}
                  </p>
                )}
              </Panel>
            </Section>
          </div>
        </div>
        <p className="text-[12px] text-[#6e7468]">Information about your business, not financial advice.</p>
      </div>
    </Page>
  );
}

function bestDay(o: SalesOverview) {
  const best = [...o.days].sort((a, b) => b.net - a.net)[0];
  if (!best || !best.net) return "–";
  const d = new Date(`${best.day}T12:00:00Z`);
  return o.period === "week" ? LONG_DAYS[d.getUTCDay()].slice(0, 3) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function DayChart({ overview }: { overview: SalesOverview }) {
  const max = Math.max(1, ...overview.days.map((d) => Math.max(d.net, d.forecast ?? 0)));
  const hasForecast = overview.days.some((d) => d.forecast !== null);
  const week = overview.period === "week";
  return (
    <Panel className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-medium text-[#edefe8]">Day by day</h3>
        <div className="flex items-center gap-3 text-[11px] text-[#a3a99d]">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#c8f03c]" />
            Takings
          </span>
          {hasForecast && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#343a30]" />
              Forecast
            </span>
          )}
        </div>
      </div>
      <div className={`grid items-end gap-1 ${week ? "h-48 grid-cols-7 gap-2" : "h-40"}`} style={week ? undefined : { gridTemplateColumns: `repeat(${overview.days.length}, minmax(0, 1fr))` }}>
        {overview.days.map((d) => {
          const date = new Date(`${d.day}T12:00:00Z`);
          const weekend = date.getUTCDay() === 5 || date.getUTCDay() === 6;
          return (
            <div key={d.day} className="flex h-full flex-col items-center justify-end" title={`${d.day}: ${gbp(d.net)}${d.forecast !== null ? ` (forecast ${gbp(d.forecast)})` : ""}`}>
              {week && <span className="mb-1 font-mono text-[10px] text-[#a3a99d]">{d.net ? gbp(d.net) : ""}</span>}
              <div className="relative flex w-full max-w-[30px] flex-1 items-end">
                {d.forecast !== null && <div className="absolute bottom-0 w-full rounded-t-sm bg-[#343a30]" style={{ height: `${(d.forecast / max) * 100}%` }} />}
                <div className="relative w-full rounded-t-sm bg-[#c8f03c]" style={{ height: `${Math.max(1, (d.net / max) * 100)}%`, opacity: d.net ? 1 : 0.2 }} />
              </div>
              {week ? (
                <span className={`mt-1.5 font-mono text-[11px] ${weekend ? "font-semibold text-[#c8f03c]" : "text-[#a3a99d]"}`}>
                  {SHORT[date.getUTCDay()]}
                  {d.temp !== null && <span className="ml-1 text-[#6e7468]">{d.temp}°</span>}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Heatmap({ overview }: { overview: SalesOverview }) {
  const { heat } = overview;
  if (heat.empty) return null;
  const rowsOrder = [0, 1, 2, 3, 4, 5, 6];
  const label = (h: number) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);
  return (
    <Panel className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-medium text-[#edefe8]">Busiest hours</h3>
          <span className="text-[12px] text-[#a3a99d]">Last 4 weeks, by takings</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#a3a99d]">
          Quiet
          {HEAT.slice(1).map((c) => (
            <span key={c} className={`h-2.5 w-2.5 rounded-[2px] ${c}`} />
          ))}
          Busy
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[320px] space-y-1">
          <div className="grid gap-1 text-center font-mono text-[9px] text-[#6e7468]" style={{ gridTemplateColumns: `22px repeat(${heat.hours.length}, minmax(0,1fr))` }}>
            <span />
            {heat.hours.map((h) => (
              <span key={h}>{label(h)}</span>
            ))}
          </div>
          {rowsOrder.map((wd) => (
            <div key={wd} className="grid items-center gap-1" style={{ gridTemplateColumns: `22px repeat(${heat.hours.length}, minmax(0,1fr))` }}>
              <span className="font-mono text-[10px] text-[#a3a99d]">{["M", "T", "W", "T", "F", "S", "S"][wd]}</span>
              {heat.levels[wd].map((lvl, i) => (
                <span key={i} className={`h-3.5 rounded-[2px] ${HEAT[lvl]}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Dishes({ overview }: { overview: SalesOverview }) {
  return (
    <Section title="Your dishes" aside={<Eyebrow>{overview.period === "week" ? "Last 7 days" : "Last 4 weeks"}</Eyebrow>}>
      {overview.dishes.length ? (
        <Panel className="space-y-1">
          <Eyebrow tone="signal">Best sellers</Eyebrow>
          <ul className="divide-y divide-[#1e221b]">
            {overview.dishes.map((d) => (
              <li key={d.item} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-[#edefe8]">{d.item}</div>
                  <div className="text-[12px] text-[#a3a99d]">{Math.round(d.sold)} sold</div>
                </div>
                <div className="font-mono text-[13px] text-[#edefe8]">{gbp(d.amount)}</div>
              </li>
            ))}
          </ul>
          {overview.slowDishes.length > 0 && (
            <div className="mt-2 space-y-1.5 rounded-xl bg-[#1e221b] p-3">
              <Eyebrow tone="amber">Selling least</Eyebrow>
              {overview.slowDishes.map((d) => (
                <div key={d.item} className="flex items-center justify-between text-[13px]">
                  <span className="truncate text-[#edefe8]">{d.item}</span>
                  <span className="text-[#ffb23d]">{Math.round(d.sold)} sold</span>
                </div>
              ))}
              <a
                href={whatsAppLink(ourWhatsAppNumber(), `Which dishes should I look at? ${overview.slowDishes.map((d) => d.item).join(", ")} aren't selling much.`)}
                target="_blank"
                rel="noreferrer"
                className="inline-block pt-1 text-[13px] font-medium text-[#c8f03c]"
              >
                Ask Dina what to do →
              </a>
            </div>
          )}
          <p className="pt-1 text-[11px] text-[#6e7468]">Money includes VAT, as on your till.</p>
        </Panel>
      ) : (
        <EmptyCard icon="sales" title="No dish sales yet" text="An itemised export from your till shows your best and worst sellers here." />
      )}
    </Section>
  );
}

function NextWeek({ overview }: { overview: SalesOverview }) {
  const { next } = overview;
  if (next.total === null && !next.quiet) return null;
  const quietName = next.quiet ? LONG_DAYS[new Date(`${next.quiet.day}T12:00:00Z`).getUTCDay()] : null;
  return (
    <Section title="Next week">
      <Panel className="space-y-3">
        {next.total !== null && (
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] text-[#a3a99d]">Forecast takings</span>
            <span className="text-[20px] font-semibold text-[#c8f03c]">{gbp(next.total)}</span>
          </div>
        )}
        {next.quiet && quietName && (
          <>
            <div className="flex items-start gap-2 rounded-xl bg-[#1e221b] p-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#ffb23d]" />
              <p className="text-[14px] text-[#edefe8]">
                {quietName} looks quiet (about {next.quiet.orders} orders).
              </p>
            </div>
            <a href={whatsAppLink(ourWhatsAppNumber(), `${quietName} is quiet`)} target="_blank" rel="noreferrer" className={`${btnPrimary} w-full`}>
              Draft a {quietName} offer
            </a>
          </>
        )}
        <p className="text-[11px] text-[#6e7468]">Forecasts are information, not financial advice.</p>
      </Panel>
      <WhatsAppTip>
        Send a photo of tonight&apos;s till report on WhatsApp and it&apos;s added here.
      </WhatsAppTip>
    </Section>
  );
}
