import "server-only";
import { randomBytes } from "node:crypto";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import type { ZFigures } from "./z-check";

// Saving sales data. Every row belongs to one restaurant; real data for a day
// (a till report or a POS file) replaces dummy data for that day.

// Till report photos and POS files go in a private bucket: never a public link.
export const SALES_BUCKET = "sales-files";
const VAT_RATE = 0.2;

export async function saveSalesFile(restaurantId: string, folder: "z-reports" | "pos", bytes: Buffer, contentType: string, ext: string) {
  const path = `${restaurantId}/${folder}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const { error } = await getSupabase().storage.from(SALES_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Couldn't save the file: ${error.message}`);
  return path;
}

export async function downloadSalesFile(path: string) {
  const { data, error } = await getSupabase().storage.from(SALES_BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn't open the saved file: ${error?.message ?? "missing"}`);
  return Buffer.from(await data.arrayBuffer());
}

// A link to a saved photo that works for an hour (for the owner's sales page).
export async function signedFileUrl(path: string) {
  const { data } = await getSupabase().storage.from(SALES_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// Supabase returns at most 1,000 rows per request: this keeps asking until it has them all.
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await page(from, from + 999)) ?? [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// A saved till report becomes that day's sales (replacing a POS total or dummy data).
export async function saveDayFromZ(restaurantId: string, zReportId: string, f: ZFigures) {
  const supabase = getSupabase();
  const day = f.business_date!;
  check(
    await supabase.from("sales_days").upsert(
      {
        restaurant_id: restaurantId,
        day,
        net_sales: f.net_sales,
        gross_sales: f.gross_sales,
        vat: f.vat,
        transactions: f.transactions,
        card: f.card,
        cash: f.cash,
        discounts: f.discounts,
        refunds: f.refunds,
        net_estimated: f.net_estimated,
        source: "z_report",
        z_report_id: zReportId,
        is_dummy: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,day" },
    ),
  );
  // Hours: the report's own, if it has them. Dummy hours and items for the day go either way.
  const hoursToClear = f.hourly.length ? ["seed", "z_report", "pos"] : ["seed", "z_report"];
  check(await supabase.from("sales_hours").delete().eq("restaurant_id", restaurantId).eq("day", day).in("source", hoursToClear));
  check(await supabase.from("sales_items").delete().eq("restaurant_id", restaurantId).eq("day", day).eq("is_dummy", true));
  if (f.hourly.length) {
    check(
      await supabase
        .from("sales_hours")
        .insert(f.hourly.map((h) => ({ restaurant_id: restaurantId, day, hour: h.hour, sales: h.sales, source: "z_report", is_dummy: false }))),
    );
  }
}

// After a POS import: each day's totals from all its item sales, unless a till
// report already covers that day (the till report wins).
export async function saveDaysFromPos(
  restaurantId: string,
  days: { day: string; gross: number; transactions: number | null; hours: { hour: number; sales: number }[] }[],
) {
  if (!days.length) return;
  const supabase = getSupabase();
  const existing =
    check(
      await supabase
        .from("sales_days")
        .select("day, source")
        .eq("restaurant_id", restaurantId)
        .in("day", days.map((d) => d.day))
        .returns<{ day: string; source: string }[]>(),
    ) ?? [];
  const fromTill = new Set(existing.filter((e) => e.source === "z_report").map((e) => e.day));
  const toSave = days.filter((d) => !fromTill.has(d.day));
  if (toSave.length) {
    check(
      await supabase.from("sales_days").upsert(
        toSave.map((d) => ({
          restaurant_id: restaurantId,
          day: d.day,
          gross_sales: d.gross,
          net_sales: Math.round((d.gross / (1 + VAT_RATE)) * 100) / 100,
          vat: Math.round((d.gross - d.gross / (1 + VAT_RATE)) * 100) / 100,
          transactions: d.transactions,
          card: null,
          cash: null,
          discounts: null,
          refunds: null,
          net_estimated: true,
          source: "pos",
          z_report_id: null,
          is_dummy: false,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "restaurant_id,day" },
      ),
    );
  }
  // Hours from the POS file, where it has times (a till report's own hours stay).
  for (const d of days.filter((x) => x.hours.length)) {
    const tillHours =
      check(
        await supabase
          .from("sales_hours")
          .select("hour")
          .eq("restaurant_id", restaurantId)
          .eq("day", d.day)
          .eq("source", "z_report")
          .returns<{ hour: number }[]>(),
      ) ?? [];
    if (tillHours.length) continue;
    check(await supabase.from("sales_hours").delete().eq("restaurant_id", restaurantId).eq("day", d.day));
    check(
      await supabase
        .from("sales_hours")
        .insert(d.hours.map((h) => ({ restaurant_id: restaurantId, day: d.day, hour: h.hour, sales: h.sales, source: "pos", is_dummy: false }))),
    );
  }
}
