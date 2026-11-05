import "server-only";
import ExcelJS from "exceljs";
import type { TemplateSpec } from "./specs";

// A template spec (specs.ts) as an Excel file the owner opens in Excel, Google
// Sheets or Numbers: the data tab first (what opens), with a heading row in the
// restaurant's colour that stays put when scrolling, dropdowns where there's a
// fixed list, notes on the headings, examples in grey; then a "How to fill this
// in" tab.

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
// White text on dark colours, near-black on light ones.
function textOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "FF1C1917" : "FFFFFFFF";
}
const FILL_IN = "FFFFF7E6"; // the columns to fill in: a soft cream
const LOCKED = "FFF5F5F4"; // pre-filled columns: light grey
const NUMFMT = { money: '"£"#,##0.00', number: "0", date: "dd/mm/yyyy", text: "@", time: "hh:mm" } as const;

export async function buildWorkbook(spec: TemplateSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DinerAI";
  wb.created = new Date();

  const ws = wb.addWorksheet(spec.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = spec.columns.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((cell, n) => {
    cell.font = { bold: true, color: { argb: textOn(spec.brandColor) } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(spec.brandColor) } };
    cell.alignment = { vertical: "middle", wrapText: true };
    const note = spec.columns[n - 1]?.note;
    if (note) cell.note = note;
  });

  const total = spec.rows.length + spec.blankRows;
  for (let i = 0; i < total; i++) {
    const values = spec.rows[i] ?? spec.columns.map(() => null);
    const row = ws.addRow(values);
    const example = spec.exampleRows?.includes(i);
    spec.columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      if (c.format) cell.numFmt = NUMFMT[c.format];
      if (spec.kind !== "sales_example") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.locked ? LOCKED : FILL_IN } };
      if (example) cell.font = { italic: true, color: { argb: "FF78716C" } };
      if (c.choices) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.choices.join(",")}"`], showErrorMessage: true, errorTitle: "Pick from the list", error: `Choose one of: ${c.choices.join(", ")}` };
    });
  }
  // The menu's last row ("All other dishes") stands out.
  if (spec.kind === "menu_costs") ws.getRow(spec.rows.length + 1).font = { bold: true };

  const how = wb.addWorksheet("How to fill this in");
  how.columns = [{ width: 110 }];
  how.addRow([spec.title]).font = { bold: true, size: 14 };
  how.addRow([]);
  for (const line of spec.instructions) {
    const row = how.addRow([line]);
    row.alignment = { wrapText: true, vertical: "top" };
  }
  how.addRow([]);
  how.addRow(["From DinerAI. Questions? Just ask me on WhatsApp."]).font = { italic: true, color: { argb: "FF78716C" } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
