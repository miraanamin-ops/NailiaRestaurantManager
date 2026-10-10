import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { dayLabel } from "./format";
import type { PosMapping } from "./pos-table";
import type { ZRead } from "./z-check";

// The AI parts of sales: reading a till report photo, and suggesting which
// column of a POS export is which. The AI only reads; plain code (z-check.ts,
// pos-table.ts) decides whether the numbers add up and whether a mapping works.

type Content = Parameters<ReturnType<typeof claude>["beta"]["messages"]["parse"]>[0]["messages"][number]["content"];

async function parse<T extends z.ZodType>(schema: T, system: string, content: Content) {
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't read this one");
  return response.parsed_output as z.infer<T>;
}

const money = (what: string) => z.number().nullable().describe(`${what}, in pounds. null if it isn't on the report or you can't read it clearly.`);

const ZSchema = z.object({
  is_till_report: z.boolean().describe("true if this is an end-of-day till / POS sales report (a Z-report, Z reading, end of day summary or daily sales report). false for food photos, menus, receipts for one customer, or anything else."),
  business_date: z.string().nullable().describe("The trading day the report covers, as YYYY-MM-DD. null if no date is visible."),
  gross_sales: money("Total sales including VAT (gross takings, after discounts)"),
  net_sales: money("Sales excluding VAT (net)"),
  vat: money("Total VAT / tax"),
  transactions: z.number().nullable().describe("Number of sales / transactions / receipts / covers-as-transactions. null if not shown."),
  card: money("Card payments total"),
  cash: money("Cash payments total"),
  other_payments: money("All other payment types added together (vouchers, delivery apps, account, etc.)"),
  discounts: money("Discounts given (as a positive number)"),
  refunds: money("Refunds / returns (as a positive number)"),
  hourly: z.array(z.object({ hour: z.number().describe("Hour of day, 0-23, the start of the hour"), sales: z.number() })).describe("Sales by hour if the report lists them, else empty"),
  unclear: z.array(z.string()).describe("Short names of any figures that are blurred, cut off or hard to read, e.g. 'the cash total'. Empty if everything is clear."),
});

export type ZImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf" };

// Reads a till report photo (or PDF). today is London's "YYYY-MM-DD", for reports that leave out the year.
export async function readZReport(file: ZImage, today: string, note = ""): Promise<ZRead> {
  const block =
    file.mediaType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: file.base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: file.mediaType, data: file.base64 } };
  const out = await parse(
    ZSchema,
    `You read UK restaurant till reports (Z-reports) from photos. Copy the figures exactly as printed; never guess or calculate a figure that isn't printed (leave it null). If a figure is blurred or cut off, leave it null and list it under "unclear". Amounts are in pounds. Today is ${dayLabel(today)} ${today.slice(0, 4)}: if the report's date has no year, use the most recent such date that isn't in the future.`,
    [block, { type: "text" as const, text: `Read this till report.${note ? ` The sender wrote: "${note.slice(0, 200)}"` : ""}` }],
  );
  return out;
}

const MappingSchema = z.object({
  is_item_sales: z.boolean().describe("true if each row is a sale of an item (a line on a receipt or an item total for a date). false for other files (e.g. a summary with no items, a customer list, stock)."),
  pos_name: z.string().nullable().describe("The POS system this export looks like it's from (e.g. Square, SumUp, Lightspeed, Toast, Epos Now, Zettle), or null"),
  date: z.string().nullable().describe("Exact heading of the column with the date of the sale"),
  time: z.string().nullable().describe("Exact heading of the column with the time (can be the same as the date column if it holds both), or null"),
  item: z.string().nullable().describe("Exact heading of the column with the item / product name"),
  quantity: z.string().nullable().describe("Exact heading of the quantity column, or null if each row is one item"),
  price: z.string().nullable().describe("Exact heading of the column with the amount of money for the row. Prefer the total for the line including VAT (gross sales / total / amount) over a unit price; avoid net, tax, cost or discount columns."),
  price_is: z.enum(["line_total", "unit_price"]).describe("line_total if the price column is the total for the row's quantity, unit_price if it's the price of one item"),
  receipt: z.string().nullable().describe("Exact heading of the receipt / order / transaction / ticket number column, or null"),
  date_order: z.enum(["dmy", "mdy", "ymd"]).describe("How dates are written, e.g. 09/10/2026 in the UK is dmy"),
  problem: z.string().nullable().describe("If it isn't item sales or you can't find the date, item or price, say why in one short sentence"),
});

export type MappingSuggestion = { mapping: PosMapping | null; posName: string | null; problem: string | null };

// The column headings and a few rows (personal details blanked out first) -> which column is which.
export async function suggestMapping(sample: { headers: string[]; rows: string[][] }): Promise<MappingSuggestion> {
  const table = [sample.headers.join(" | "), ...sample.rows.map((r) => r.join(" | "))].join("\n");
  const out = await parse(
    MappingSchema,
    `You look at sales exports from restaurant and café tills (POS systems) and work out which column means what. Use the exact column headings given. The restaurant is in the UK.`,
    `Column headings and the first rows (cells separated by " | "):\n${table}`,
  );
  if (!out.is_item_sales || !out.date || !out.item || !out.price) {
    return { mapping: null, posName: out.pos_name, problem: out.problem ?? "It doesn't look like a list of item sales." };
  }
  return {
    mapping: {
      date: out.date,
      time: out.time,
      item: out.item,
      quantity: out.quantity,
      price: out.price,
      price_is: out.price_is,
      receipt: out.receipt,
      date_order: out.date_order,
    },
    posName: out.pos_name,
    problem: null,
  };
}
