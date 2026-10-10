import "server-only";
import readXlsxFile from "read-excel-file/node";
import { parseCsv, toTable, type Cell, type Table } from "./pos-table";

// Opening a POS export: CSV or Excel (.xlsx). Old .xls files aren't supported
// (most tills can export CSV instead).

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type FileKind = "csv" | "xlsx" | "xls" | "unknown";

// From the content type WhatsApp or the browser gave us, the file name if we
// have one, and the first bytes (an .xlsx file is a zip: it starts with "PK").
export function fileKind(contentType: string, bytes: Buffer, fileName = ""): FileKind {
  const ct = contentType.toLowerCase();
  const name = fileName.toLowerCase();
  if (bytes.subarray(0, 2).toString("latin1") === "PK" || name.endsWith(".xlsx") || ct.includes("spreadsheetml")) return "xlsx";
  // Old Excel files start with the OLE2 signature.
  if (bytes.subarray(0, 4).toString("hex") === "d0cf11e0" || name.endsWith(".xls")) return "xls";
  if (name.endsWith(".csv") || /csv|comma-separated|text\/plain|text\/tab/.test(ct)) return "csv";
  // Some phones send CSVs as "application/octet-stream": accept it if it reads as text.
  if (ct.includes("octet-stream") || ct.includes("ms-excel")) {
    const head = bytes.subarray(0, 2000).toString("utf8");
    if (!head.includes("\u0000") && /[,;\t]/.test(head)) return "csv";
  }
  return "unknown";
}

export function isSpreadsheetType(contentType: string) {
  return /csv|comma-separated|spreadsheet|ms-excel|text\/plain|octet-stream/i.test(contentType);
}

export async function readTable(bytes: Buffer, kind: "csv" | "xlsx"): Promise<Table | null> {
  if (kind === "csv") return toTable(parseCsv(bytes.toString("utf8")));
  // The sheet with the most rows (exports sometimes add a summary sheet first).
  const sheets = await readXlsxFile(bytes);
  const best = [...sheets].sort((a, b) => b.data.length - a.data.length)[0];
  return best ? toTable(best.data as Cell[][]) : null;
}
