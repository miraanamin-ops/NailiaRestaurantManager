import "server-only";
import readXlsxFile from "read-excel-file/node";
import { parseCsv, toTable, type Cell, type Table } from "@/lib/sales/pos-table";

// One of our sheets from a file the owner sent back: the tab by its name (else the
// first tab), as a table. CSV works too (a sheet saved as CSV has one tab).
export async function readTemplateTable(bytes: Buffer, sheet: string): Promise<Table | null> {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return toTable(parseCsv(bytes.toString("utf8")));
  const sheets = await readXlsxFile(bytes);
  const pick = sheets.find((s) => s.sheet.trim().toLowerCase() === sheet.toLowerCase()) ?? sheets[0];
  return pick ? toTable(pick.data as Cell[][]) : null;
}
