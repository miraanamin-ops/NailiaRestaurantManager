import "server-only";
import readXlsxFile from "read-excel-file/node";
import { parseCsv, toTable, type Cell, type Table } from "@/lib/sales/pos-table";
import { templateKindOf } from "./read";

const isXlsx = (bytes: Buffer) => bytes.subarray(0, 2).toString("latin1") === "PK";

// One of our sheets from a file the owner sent back: the tab by its name (else the
// first tab), as a table. CSV works too (a sheet saved as CSV has one tab).
export async function readTemplateTable(bytes: Buffer, sheet: string): Promise<Table | null> {
  if (!isXlsx(bytes)) return toTable(parseCsv(bytes.toString("utf8")));
  const sheets = await readXlsxFile(bytes);
  const pick = sheets.find((s) => s.sheet.trim().toLowerCase() === sheet.toLowerCase()) ?? sheets[0];
  return pick ? toTable(pick.data as Cell[][]) : null;
}

// Is this file one of our sheets (any tab, by its headings)? Its kind and table, or null.
export async function readOwnSheet(bytes: Buffer): Promise<{ kind: NonNullable<ReturnType<typeof templateKindOf>>; table: Table } | null> {
  try {
    const tables = isXlsx(bytes) ? (await readXlsxFile(bytes)).map((s) => toTable(s.data as Cell[][])) : [toTable(parseCsv(bytes.toString("utf8")))];
    for (const table of tables) {
      const kind = table ? templateKindOf(table.headers) : null;
      if (table && kind) return { kind, table };
    }
  } catch {
    // Not readable as a sheet: not one of ours.
  }
  return null;
}
