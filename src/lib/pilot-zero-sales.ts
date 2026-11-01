import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { SALES_BUCKET } from "@/lib/sales/store";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { PilotZeroError } from "./pilot-zero";

// Removing imported sales from the Pilot Zero restaurant (admin console,
// /onboarding/admin/pilot-zero; builder only): the made-up year from pilot-zero/
// can be wiped if the restaurant (e.g. Maison Noor) becomes a real customer.
// By one upload or by a date range. Only POS uploads ("imported" sales) go: the
// owner's till report photos are kept. Only a restaurant marked for Pilot Zero,
// and only after its name is typed. In the audit log (action sales_removed).

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ImportRow = { id: string; file_name: string | null; file_path: string; first_day: string | null; last_day: string | null; rows_imported: number | null; imported_at: string | null };

export async function importsFor(restaurantId: string) {
  return (
    check(
      await getSupabase()
        .from("pos_imports")
        .select("id, file_name, file_path, first_day, last_day, rows_imported, imported_at")
        .eq("restaurant_id", restaurantId)
        .eq("status", "imported")
        .order("imported_at", { ascending: false })
        .returns<ImportRow[]>(),
    ) ?? []
  );
}

type Target = { importId: string } | { from: string; to: string };

export async function removeImportedSales(input: { restaurantId: string; target: Target; confirm: string; builderEmail: string }) {
  const supabase = getSupabase();
  const r = check(await supabase.from("restaurants").select("*").eq("id", input.restaurantId).maybeSingle<Restaurant>());
  if (!r) throw new PilotZeroError("That restaurant wasn't found");
  if (r.pilot_zero !== true) throw new PilotZeroError(`${r.name} isn't marked for Pilot Zero, so its sales can't be removed here`);
  if (input.confirm.trim().toLowerCase() !== r.name.trim().toLowerCase()) throw new PilotZeroError(`Nothing removed: type the restaurant's name exactly (${r.name}) to confirm.`);

  const imports = await importsFor(r.id);
  let from: string;
  let to: string;
  let whole: ImportRow[];
  if ("importId" in input.target) {
    const id = input.target.importId;
    const row = imports.find((i) => i.id === id);
    if (!row?.first_day || !row.last_day) throw new PilotZeroError("That upload wasn't found (or has no sales in it).");
    [from, to, whole] = [row.first_day, row.last_day, [row]];
  } else {
    ({ from, to } = input.target);
    if (!DAY.test(from) || !DAY.test(to) || from > to) throw new PilotZeroError("Pick a start and end date, the start first.");
    whole = imports.filter((i) => i.first_day && i.last_day && i.first_day >= from && i.last_day <= to);
  }

  // The days: imported totals and hours only (till reports stay). Items: in the
  // range for a date range, that upload's own for an upload.
  const days = check(await supabase.from("sales_days").delete().eq("restaurant_id", r.id).eq("source", "pos").gte("day", from).lte("day", to).select("id"))?.length ?? 0;
  check(await supabase.from("sales_hours").delete().eq("restaurant_id", r.id).eq("source", "pos").gte("day", from).lte("day", to));
  const items =
    "importId" in input.target
      ? (check(await supabase.from("sales_items").delete().eq("restaurant_id", r.id).eq("import_id", input.target.importId).select("id"))?.length ?? 0)
      : (check(await supabase.from("sales_items").delete().eq("restaurant_id", r.id).gte("day", from).lte("day", to).select("id"))?.length ?? 0);
  // Uploads wholly covered: marked removed, their files deleted.
  for (const i of whole) {
    check(await supabase.from("pos_imports").update({ status: "cancelled", error: `Removed by the builder (Pilot Zero), ${new Date().toISOString().slice(0, 10)}` }).eq("id", i.id).eq("restaurant_id", r.id));
    await supabase.storage.from(SALES_BUCKET).remove([i.file_path]);
  }
  await logAction({
    restaurantId: r.id,
    actor: "builder",
    action: "sales_removed",
    detail: `Imported sales removed, ${from} to ${to}: ${days} days${items ? `, ${items} item lines` : ""}${whole.length ? `; ${whole.length} upload${whole.length === 1 ? "" : "s"} (${whole.map((i) => i.file_name ?? "a file").join(", ")}) and their files deleted` : ""}. Till reports kept. (by ${input.builderEmail})`,
    data: { from, to, days, items, uploads: whole.map((i) => i.id) },
  });
  return { from, to, days, items, uploads: whole.length };
}
