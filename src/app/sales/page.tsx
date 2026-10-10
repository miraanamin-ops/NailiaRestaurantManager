import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { getRestaurant } from "@/lib/onboarding/store";
import { showNumber } from "@/lib/onboarding/steps";
import { dayLabel, gbp } from "@/lib/sales/format";
import { salesPageData } from "@/lib/sales/page-data";
import { button, Card, Frame } from "../onboarding/ui";

export const metadata: Metadata = { title: "Sales", robots: { index: false, follow: false } };

const SOURCE: Record<string, string> = { z_report: "Till report", pos: "POS file", seed: "Dummy" };
const Z_STATUS: Record<string, { label: string; cls: string }> = {
  saved: { label: "Saved", cls: "bg-emerald-50 text-emerald-800" },
  needs_confirm: { label: "Waiting for YES", cls: "bg-amber-50 text-amber-900" },
  needs_date: { label: "Waiting for the date", cls: "bg-amber-50 text-amber-900" },
  needs_replace: { label: "Replace?", cls: "bg-amber-50 text-amber-900" },
  unreadable: { label: "Couldn't read", cls: "bg-red-50 text-red-800" },
};
const IMPORT_STATUS: Record<string, string> = {
  imported: "✅ Imported",
  needs_mapping: "Check the columns",
  failed: "❌ Couldn't import",
  cancelled: "Cancelled",
};

// The owner's sales page: upload a POS export, see till reports and recent days.
// (Till reports come in as photos on WhatsApp; files can come either way.)
export default function SalesPage({ searchParams }: PageProps<"/sales">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

async function Sales({ searchParams }: Pick<PageProps<"/sales">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/sales${one("r") ? `?r=${one("r")}` : ""}`);
  const restaurantId = pickRestaurantId(owner, one("r"));
  if (!restaurantId) return <Frame>No restaurant found for this login.</Frame>;
  const [r, data] = await Promise.all([getRestaurant(restaurantId), salesPageData(restaurantId)]);
  const year = new Date().getFullYear();
  const muted = "text-sm text-stone-600";

  return (
    <Frame>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}: sales</h1>
        <Link href={`/?r=${restaurantId}`} className="shrink-0 text-sm text-emerald-700 underline">
          Dashboard
        </Link>
      </div>
      {one("msg") && <p className="mb-4 whitespace-pre-line rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">{one("msg")}</p>}
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        <Card>
          <h2 className="text-lg font-bold">Upload a sales file</h2>
          <p className={muted}>
            An export from your till (CSV or Excel). The first time, I&apos;ll show you which column I think is which; after that, files like it import straight
            away. You can also just send the file on WhatsApp.
          </p>
          <form action="/sales/upload" method="post" encType="multipart/form-data" className="space-y-3">
            <input type="hidden" name="r" value={restaurantId} />
            <input
              type="file"
              name="file"
              required
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:font-medium"
            />
            <button className={button}>Upload</button>
          </form>
          <p className="text-xs text-stone-500">
            No file handy? <a className="underline" href="/samples/pos-export-sample.csv" download>Download a sample POS export</a> and upload it. Up to 4 MB.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Till reports</h2>
          <p className={muted}>Send a photo of your end-of-day till report (Z-report) on WhatsApp. Staff numbers can send them too.</p>
          {data.zReports.length ? (
            <ul className="divide-y divide-stone-100">
              {data.zReports.map((z) => {
                const st = Z_STATUS[z.status];
                return (
                  <li key={z.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium">{z.business_date ? dayLabel(z.business_date, year) : "Date not read"}</div>
                      <div className="text-sm text-stone-600">
                        {z.net_sales !== null ? `${gbp(Number(z.net_sales))} net` : "No total"}
                        {z.transactions !== null ? ` · ${z.transactions} sales` : ""}
                        {z.sender_role === "staff" ? " · from staff" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {st && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}
                      {z.photoUrl && (
                        <a href={z.photoUrl} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">
                          Photo
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">None yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Last 14 days</h2>
          {data.days.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="py-1 font-medium">Day</th>
                  <th className="py-1 text-right font-medium">Net sales</th>
                  <th className="py-1 text-right font-medium">Sales</th>
                  <th className="py-1 pl-3 font-medium">From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td className="py-1.5">{dayLabel(d.day, year)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {gbp(Number(d.net_sales))}
                      {d.net_estimated ? "*" : ""}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{d.transactions ?? "–"}</td>
                    <td className="py-1.5 pl-3 text-stone-600">{SOURCE[d.source] ?? d.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone-500">No sales figures yet.</p>
          )}
          {data.days.some((d) => d.net_estimated) && <p className="text-xs text-stone-500">* POS files give totals with VAT; net worked out at 20% VAT.</p>}
          <p className="text-xs text-stone-500">Information about your business, not financial advice.</p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Sales files</h2>
          {data.imports.length ? (
            <ul className="divide-y divide-stone-100 text-sm">
              {data.imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{i.file_name ?? (i.channel === "whatsapp" ? "Sent on WhatsApp" : "Uploaded file")}</div>
                    <div className="text-stone-600">
                      {i.first_day && i.last_day ? `${dayLabel(i.first_day, year)} to ${dayLabel(i.last_day, year)} · ` : ""}
                      {i.rows_imported !== null ? `${i.rows_imported} lines` : `${i.rows_total ?? 0} rows`}
                      {i.rows_duplicate ? `, ${i.rows_duplicate} already in` : ""}
                    </div>
                  </div>
                  {i.status === "needs_mapping" ? (
                    <Link href={`/sales/import/${i.id}?r=${restaurantId}`} className="shrink-0 font-medium text-emerald-700 underline">
                      Check the columns
                    </Link>
                  ) : (
                    <span className="shrink-0 text-stone-600" title={i.error ?? undefined}>
                      {IMPORT_STATUS[i.status]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">None yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Staff numbers</h2>
          <p className={muted}>
            They can send till reports and sales files, nothing else. Add one on WhatsApp: <b>ADD STAFF +447700900123</b> (and REMOVE STAFF to take them off).
          </p>
          {data.staff.length ? (
            <ul className="text-sm">
              {data.staff.map((s) => (
                <li key={s.id}>{showNumber(s.whatsapp)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">None yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Weather</h2>
          <p className={muted}>
            Stored every day for your address, to help forecast busy and quiet days later.{" "}
            {data.weather.days ? `${data.weather.days} days stored.` : "Nothing stored yet (it starts with the next hourly check)."}
          </p>
          {data.weather.last && (
            <p className="text-sm">
              {dayLabel(data.weather.last.day, year)}: {data.weather.last.temp_max ?? "?"}°C, {data.weather.last.rain_mm ?? 0}mm rain
              {data.weather.last.conditions ? ` (${data.weather.last.conditions.toLowerCase()})` : ""}
            </p>
          )}
        </Card>
      </div>
    </Frame>
  );
}
