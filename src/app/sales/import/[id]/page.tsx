import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { dayLabel, gbp } from "@/lib/sales/format";
import { getImport, tableFor } from "@/lib/sales/pos-import";
import { applyMapping, mappingWorks, type PosMapping } from "@/lib/sales/pos-table";
import { button, Card, Frame, secondary } from "../../../onboarding/ui";
import { cancelUpload, importWithMapping } from "../../actions";
import { mappingFromForm, NONE } from "../../mapping-form";

export const metadata: Metadata = { title: "Check the columns", robots: { index: false, follow: false } };

// The first file in a new layout: which column is which? The AI's guess is filled
// in; the owner changes anything wrong, checks the preview, and imports.
export default function ImportPage({ params, searchParams }: PageProps<"/sales/import/[id]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <CheckColumns params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const FIELDS: { key: keyof PosMapping; label: string; required: boolean; hint: string }[] = [
  { key: "date", label: "Date", required: true, hint: "When the sale happened" },
  { key: "time", label: "Time", required: false, hint: "Can be the same column as the date" },
  { key: "item", label: "Item", required: true, hint: "The dish or drink" },
  { key: "quantity", label: "Quantity", required: false, hint: "None: each row is one item" },
  { key: "price", label: "Price", required: true, hint: "The money for the row" },
  { key: "receipt", label: "Receipt or order number", required: false, hint: "Used to count sales" },
];

async function CheckColumns({ params, searchParams }: Pick<PageProps<"/sales/import/[id]">, "params" | "searchParams">) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const one = (k: string) => {
    const v = q[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const owner = await requireOwner(`/sales/import/${id}${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  const row = rid ? await getImport(rid, id) : null;
  if (!rid || !row) return <Frame>That file couldn&apos;t be found.</Frame>;
  if (row.status !== "needs_mapping") {
    return (
      <Frame>
        <Card>
          <p>This file is {row.status === "imported" ? "already imported" : row.status}.</p>
          <Link className="text-emerald-700 underline" href={`/sales?r=${rid}`}>
            Back to sales
          </Link>
        </Card>
      </Frame>
    );
  }
  const table = await tableFor(row);
  if (!table) return <Frame>The saved file couldn&apos;t be opened. Please upload it again.</Frame>;

  // The columns shown: what the owner just picked ("Update preview"), else the AI's suggestion.
  const picked = one("date") ? mappingFromForm((k) => one(k) ?? "") : null;
  const mapping = picked ?? row.mapping;
  const works = mapping ? mappingWorks(table, mapping) : false;
  const preview = mapping ? applyMapping({ headers: table.headers, rows: table.rows.slice(0, 200) }, mapping).lines.slice(0, 6) : [];
  const total = mapping ? applyMapping(table, mapping) : null;
  const year = new Date().getFullYear();
  const select = "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base";
  const hidden = mapping ? (Object.entries(mapping) as [string, string | null][]).filter(([k]) => k !== "pos_name") : [];

  return (
    <Frame>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Check the columns</h1>
      <p className="mb-4 text-sm text-stone-600">
        {row.file_name ?? "Your file"} is a new layout{row.mapping?.pos_name ? ` (it looks like ${row.mapping.pos_name})` : ""}. Check which column is which once;
        files like it will then import straight away.
      </p>
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        <Card>
          <form method="get" className="space-y-3">
            <input type="hidden" name="r" value={rid} />
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-sm font-medium">
                  {f.label}
                  {!f.required && <span className="font-normal text-stone-500"> (optional)</span>}
                </span>
                <select name={f.key} defaultValue={(mapping?.[f.key] as string | null) ?? NONE} className={select}>
                  {!f.required && <option value={NONE}>None</option>}
                  {f.required && !mapping?.[f.key] && <option value={NONE}>Choose…</option>}
                  {table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-stone-500">{f.hint}</span>
              </label>
            ))}
            <label className="block">
              <span className="text-sm font-medium">The price is…</span>
              <select name="price_is" defaultValue={mapping?.price_is ?? "line_total"} className={select}>
                <option value="line_total">the total for the row</option>
                <option value="unit_price">the price of one item</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Dates are written</span>
              <select name="date_order" defaultValue={mapping?.date_order ?? "dmy"} className={select}>
                <option value="dmy">day/month/year (UK)</option>
                <option value="mdy">month/day/year (US)</option>
                <option value="ymd">year-month-day</option>
              </select>
            </label>
            <button className={secondary}>Update preview</button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Preview</h2>
          {preview.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="py-1 font-medium">When</th>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">£</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {preview.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 align-top whitespace-nowrap">
                      {dayLabel(l.day, year)}
                      {l.hour !== null ? ` ${String(l.hour).padStart(2, "0")}:00` : ""}
                    </td>
                    <td className="py-1.5 pr-2 align-top">{l.item}</td>
                    <td className="py-1.5 text-right align-top tabular-nums">{l.quantity}</td>
                    <td className="py-1.5 text-right align-top tabular-nums">{gbp(l.amount, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone-600">With these columns, no rows can be read yet.</p>
          )}
          {total && total.lines.length > 0 && (
            <p className="text-sm text-stone-600">
              {total.lines.length} sales lines in the file
              {total.skipped ? `, ${total.skipped} rows that aren't sales (totals or blanks) will be skipped` : ""}.
            </p>
          )}
          {mapping && works ? (
            <form action={importWithMapping} className="space-y-2">
              <input type="hidden" name="r" value={rid} />
              <input type="hidden" name="id" value={row.id} />
              {hidden.map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v ?? NONE} />
              ))}
              <button className={button}>Looks right: import</button>
            </form>
          ) : (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Most rows don&apos;t read properly with these columns. Change them above and press Update preview.</p>
          )}
          <form action={cancelUpload}>
            <input type="hidden" name="r" value={rid} />
            <input type="hidden" name="id" value={row.id} />
            <button className="w-full py-2 text-sm text-stone-600 underline">Cancel this file</button>
          </form>
        </Card>
      </div>
    </Frame>
  );
}
