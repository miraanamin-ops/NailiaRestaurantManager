import "server-only";
import { logAction } from "@/lib/audit";
import { check, checkRow } from "@/lib/drafts";
import { appUrl, getSupabase } from "@/lib/supabase";
import { plural } from "@/lib/text";
import { suggestMapping } from "./ai";
import { dayLabel, gbp, round2 } from "./format";
import { fileKind, MAX_FILE_BYTES, readTable } from "./pos-file";
import {
  applyMapping,
  dayTotals,
  describeMapping,
  layoutSignature,
  mappingProblems,
  mappingWorks,
  rowKeys,
  sampleForAi,
  type PosMapping,
  type SaleLine,
  type Table,
} from "./pos-table";
import { downloadSalesFile, saveDaysFromPos, saveSalesFile, selectAll } from "./store";

// POS exports (CSV or Excel), uploaded on the sales page or sent on WhatsApp.
// The first file in a new layout: the AI suggests which column is which, the
// owner confirms, and the layout is saved so the next file just imports.

export type PosImport = {
  id: string;
  restaurant_id: string;
  file_path: string;
  file_name: string | null;
  file_type: "csv" | "xlsx";
  signature: string | null;
  layout_id: string | null;
  mapping: (PosMapping & { pos_name?: string | null }) | null;
  status: "needs_mapping" | "imported" | "failed" | "cancelled";
  channel: "web" | "whatsapp";
  sent_by: string | null;
  rows_total: number | null;
  rows_imported: number | null;
  rows_duplicate: number | null;
  rows_skipped: number | null;
  first_day: string | null;
  last_day: string | null;
  total_amount: number | null;
  error: string | null;
  created_at: string;
  imported_at: string | null;
};

export type ImportOutcome =
  | { status: "imported"; importId: string; message: string }
  | { status: "needs_mapping"; importId: string; message: string }
  | { status: "failed"; importId: string | null; message: string };

export function importPageUrl(importId: string, restaurantId: string) {
  return `${appUrl()}/sales/import/${importId}?r=${restaurantId}`;
}

async function loadImport(restaurantId: string, importId: string) {
  return check(
    await getSupabase().from("pos_imports").select("*").eq("id", importId).eq("restaurant_id", restaurantId).maybeSingle<PosImport>(),
  );
}

async function setImport(row: Pick<PosImport, "id" | "restaurant_id">, fields: Partial<PosImport>) {
  check(await getSupabase().from("pos_imports").update(fields).eq("id", row.id).eq("restaurant_id", row.restaurant_id));
}

export async function tableFor(row: PosImport): Promise<Table | null> {
  return readTable(await downloadSalesFile(row.file_path), row.file_type);
}

// A new file: save it, then import it (known layout) or ask about the columns.
export async function receivePosFile(input: {
  restaurantId: string;
  bytes: Buffer;
  contentType: string;
  fileName?: string | null;
  channel: "web" | "whatsapp";
  sentBy: string | null;
  actor: "owner" | "staff";
}): Promise<ImportOutcome> {
  const { restaurantId, bytes } = input;
  if (bytes.length > MAX_FILE_BYTES) return { status: "failed", importId: null, message: "That file is too big (over 4 MB). Try exporting a shorter period, e.g. one month." };
  const kind = fileKind(input.contentType, bytes, input.fileName ?? "");
  if (kind === "xls") return { status: "failed", importId: null, message: "That's an old Excel file (.xls). Please export it as CSV or .xlsx from your till and send it again." };
  if (kind === "unknown") return { status: "failed", importId: null, message: "I can read sales files as CSV or Excel (.xlsx). That file is neither." };

  let table: Table | null = null;
  try {
    table = await readTable(bytes, kind);
  } catch (err) {
    console.error("Couldn't read the POS file", err);
  }
  if (!table || !table.rows.length) return { status: "failed", importId: null, message: "I couldn't find a table of sales in that file. Is it the right export?" };

  const signature = layoutSignature(table.headers);
  const filePath = await saveSalesFile(restaurantId, "pos", bytes, input.contentType || "application/octet-stream", kind);
  const supabase = getSupabase();
  const row = checkRow(
    await supabase
      .from("pos_imports")
      .insert({
        restaurant_id: restaurantId,
        file_path: filePath,
        file_name: input.fileName?.slice(0, 200) ?? null,
        file_type: kind,
        signature,
        status: "needs_mapping",
        channel: input.channel,
        sent_by: input.sentBy,
        rows_total: table.rows.length,
      })
      .select("*")
      .single<PosImport>(),
  );

  // Seen this layout before (and the owner confirmed it): import straight away.
  const layout = check(
    await supabase
      .from("pos_layouts")
      .select("id, mapping")
      .eq("restaurant_id", restaurantId)
      .eq("signature", signature)
      .maybeSingle<{ id: string; mapping: PosMapping }>(),
  );
  if (layout && mappingWorks(table, layout.mapping)) {
    await setImport(row, { layout_id: layout.id, mapping: layout.mapping });
    return runImport({ ...row, layout_id: layout.id }, table, layout.mapping, input.actor);
  }

  // New layout: the AI suggests a mapping for the owner to check.
  const suggestion = await suggestMapping(sampleForAi(table));
  if (!suggestion.mapping) {
    await setImport(row, { status: "failed", error: suggestion.problem });
    return { status: "failed", importId: row.id, message: `I couldn't use that file: ${suggestion.problem ?? "it doesn't look like item sales."}` };
  }
  const mapping = { ...suggestion.mapping, pos_name: suggestion.posName };
  await setImport(row, { mapping });
  return { status: "needs_mapping", importId: row.id, message: mappingQuestion({ ...row, mapping }, table) };
}

// The WhatsApp question about a new layout.
export function mappingQuestion(row: PosImport, table: Table) {
  const m = row.mapping!;
  const works = mappingWorks(table, m);
  const { lines } = applyMapping(table, m);
  const first = lines[0];
  const days = lines.map((l) => l.day).sort();
  const intro = `📊 *New sales file layout*${m.pos_name ? ` (looks like ${m.pos_name})` : ""}. Here's how I read the columns:`;
  const example = first ? `\nFirst sale: ${dayLabel(first.day)}${first.hour !== null ? ` ${String(first.hour).padStart(2, "0")}:00` : ""}, ${first.item} ×${first.quantity}, ${gbp(first.amount, true)}` : "";
  const link = importPageUrl(row.id, row.restaurant_id);
  if (!works) {
    return `${intro}\n${describeMapping(m).map((l) => `- ${l}`).join("\n")}\n\nThat doesn't read most rows properly, so please check the columns here: ${link}`;
  }
  return `${intro}\n${describeMapping(m).map((l) => `- ${l}`).join("\n")}${example}\n\nReply *YES* to import ${plural(lines.length, "sales line")} (${dayLabel(days[0])} to ${dayLabel(days.at(-1)!)}), or change the columns here: ${link}\nAfter this, files like it import straight away.`;
}

// The owner confirmed (or corrected) the columns: save the layout and import.
export async function confirmImport(restaurantId: string, importId: string, mapping: PosMapping, actor: "owner" | "staff" = "owner"): Promise<ImportOutcome> {
  const row = await loadImport(restaurantId, importId);
  if (!row) return { status: "failed", importId: null, message: "I couldn't find that file." };
  if (row.status === "imported") return { status: "imported", importId, message: "That file is already imported." };
  if (row.status !== "needs_mapping") return { status: "failed", importId, message: "That file isn't waiting to be imported any more. Send it again to start over." };
  const table = await tableFor(row);
  if (!table) return { status: "failed", importId, message: "I couldn't open the saved file. Please send it again." };
  const problems = mappingProblems(table.headers, mapping);
  if (problems.length) return { status: "failed", importId, message: problems.join(" ") };
  if (!mappingWorks(table, mapping)) {
    return { status: "failed", importId, message: "With those columns, most rows don't have a readable date, item and price. Please check the columns again." };
  }
  const supabase = getSupabase();
  const posName = row.mapping?.pos_name ?? null;
  const clean: PosMapping = {
    date: mapping.date,
    time: mapping.time,
    item: mapping.item,
    quantity: mapping.quantity,
    price: mapping.price,
    price_is: mapping.price_is,
    receipt: mapping.receipt,
    date_order: mapping.date_order,
  };
  const layout = checkRow(
    await supabase
      .from("pos_layouts")
      .upsert(
        { restaurant_id: restaurantId, signature: row.signature, headers: table.headers, mapping: clean, pos_name: posName, confirmed_at: new Date().toISOString() },
        { onConflict: "restaurant_id,signature" },
      )
      .select("id")
      .single<{ id: string }>(),
  );
  await setImport(row, { layout_id: layout.id, mapping: { ...clean, pos_name: posName } });
  return runImport({ ...row, layout_id: layout.id }, table, clean, actor);
}

export async function cancelImport(restaurantId: string, importId: string) {
  const row = await loadImport(restaurantId, importId);
  if (row?.status === "needs_mapping") await setImport(row, { status: "cancelled" });
}

// Saves the file's sale lines (skipping any already imported) and works out each day's totals.
async function runImport(row: PosImport, table: Table, mapping: PosMapping, actor: "owner" | "staff"): Promise<ImportOutcome> {
  const supabase = getSupabase();
  const rid = row.restaurant_id;
  const { lines, skipped } = applyMapping(table, mapping);
  if (!lines.length) {
    await setImport(row, { status: "failed", error: "No readable sale lines", rows_skipped: skipped });
    return { status: "failed", importId: row.id, message: "I couldn't find any sales in that file with those columns." };
  }
  const keys = rowKeys(lines);
  const days = [...new Set(lines.map((l) => l.day))].sort();
  const [first, last] = [days[0], days.at(-1)!];

  // Lines already imported (from an earlier upload of the same period) are skipped.
  const existing = await selectAll<{ row_key: string }>((from, to) =>
    supabase.from("sales_items").select("row_key").eq("restaurant_id", rid).eq("is_dummy", false).gte("day", first).lte("day", last).range(from, to),
  );
  const have = new Set(existing.map((e) => e.row_key));
  const fresh: (SaleLine & { row_key: string })[] = lines.map((l, i) => ({ ...l, row_key: keys[i] })).filter((l) => !have.has(l.row_key));

  if (fresh.length) {
    // Real sales replace dummy data for the same days.
    check(await supabase.from("sales_items").delete().eq("restaurant_id", rid).eq("is_dummy", true).gte("day", first).lte("day", last));
    check(await supabase.from("sales_hours").delete().eq("restaurant_id", rid).eq("source", "seed").gte("day", first).lte("day", last));
    for (let i = 0; i < fresh.length; i += 500) {
      check(
        await supabase.from("sales_items").insert(
          fresh.slice(i, i + 500).map((l) => ({
            restaurant_id: rid,
            day: l.day,
            hour: l.hour,
            item: l.item,
            quantity: l.quantity,
            amount: l.amount,
            receipt: l.receipt,
            import_id: row.id,
            row_key: l.row_key,
            is_dummy: false,
          })),
        ),
      );
    }
    // Each touched day's totals from all its real item sales (this file and earlier ones).
    const touched = [...new Set(fresh.map((l) => l.day))];
    const all = await selectAll<{ day: string; hour: number | null; amount: number; receipt: string | null }>((from, to) =>
      supabase.from("sales_items").select("day, hour, amount, receipt").eq("restaurant_id", rid).eq("is_dummy", false).gte("day", first).lte("day", last).range(from, to),
    );
    await saveDaysFromPos(rid, dayTotals(all.filter((l) => touched.includes(l.day)).map((l) => ({ ...l, amount: Number(l.amount) }))));
  }

  const amount = round2(fresh.reduce((s, l) => s + l.amount, 0));
  await setImport(row, {
    status: "imported",
    rows_imported: fresh.length,
    rows_duplicate: lines.length - fresh.length,
    rows_skipped: skipped,
    first_day: first,
    last_day: last,
    total_amount: amount,
    imported_at: new Date().toISOString(),
  });
  const period = first === last ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`;
  await logAction({
    restaurantId: rid,
    actor,
    action: "sales_imported",
    detail: `Sales file imported: ${plural(fresh.length, "line")}, ${period}${lines.length > fresh.length ? ` (${lines.length - fresh.length} already in)` : ""}`,
    data: { import_id: row.id },
  });
  if (!fresh.length) {
    return { status: "imported", importId: row.id, message: `📊 Those sales are already in (${plural(lines.length, "line")}, ${period}). Nothing new to add.` };
  }
  const extras: string[] = [];
  const dupes = lines.length - fresh.length;
  if (dupes) extras.push(`${plural(dupes, "line")} ${dupes === 1 ? "was" : "were"} already in, so I skipped ${dupes === 1 ? "it" : "them"}.`);
  if (skipped) extras.push(`${plural(skipped, "row")} ${skipped === 1 ? "wasn't a sale" : "weren't sales"} (totals or blanks).`);
  return {
    status: "imported",
    importId: row.id,
    message: `📊 Imported ${plural(fresh.length, "sales line")}, ${period} (${gbp(amount)} including VAT).${extras.length ? `\n${extras.join(" ")}` : ""}`,
  };
}

// The newest file waiting for its columns to be confirmed on WhatsApp (from the last day).
export async function pendingImport(restaurantId: string, now: Date) {
  return check(
    await getSupabase()
      .from("pos_imports")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "needs_mapping")
      .eq("channel", "whatsapp")
      .gte("created_at", new Date(now.getTime() - 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PosImport>(),
  );
}

export async function recentImports(restaurantId: string, limit = 10) {
  return (
    check(
      await getSupabase()
        .from("pos_imports")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<PosImport[]>(),
    ) ?? []
  );
}

export async function getImport(restaurantId: string, importId: string) {
  return loadImport(restaurantId, importId);
}
