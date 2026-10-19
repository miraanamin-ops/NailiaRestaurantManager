import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { isPublicWebAddress, textFromHtml } from "@/lib/onboarding/website";
import { academicYearOf, schoolDateProblems, type SchoolDate } from "./school-terms";

// Reading a council's term dates page (or PDF) with Claude, for the builder to
// check on /feeds/terms. Claude only reads: every row it finds is a draft until
// the builder ticks it, and a row that breaks the plain-code checks is shown
// with its problem and can't be saved as it is.

const Rows = z.object({
  rows: z.array(
    z.object({
      kind: z.enum(["term", "inset"]).describe("term: a school term (with its half term inside it); inset: a training/inset day when pupils are off"),
      start_day: z.string().describe("YYYY-MM-DD, the first day pupils are in (term) or off (inset)"),
      end_day: z.string().describe("YYYY-MM-DD, the last day pupils are in (term) or off (inset)"),
      half_term_start: z.string().nullable().describe("YYYY-MM-DD, the first weekday of the half term holiday inside this term, else null"),
      half_term_end: z.string().nullable().describe("YYYY-MM-DD, the last weekday of that half term, else null"),
      notes: z.string().nullable().describe("anything the page says about the row (e.g. 'Easter Monday is a bank holiday'), else null"),
    }),
  ),
  unreadable: z.string().nullable().describe("what you couldn't read or weren't sure of, else null"),
});

const MAX_BYTES = 8_000_000;

export async function readTermDates(url: string, councilName: string, councilCode: string): Promise<{ rows: (SchoolDate & { problem: string | null })[]; notes: string | null }> {
  const u = new URL(url);
  if (!isPublicWebAddress(u)) throw new Error("Only public web addresses can be read.");
  const res = await fetch(u, { headers: { "User-Agent": "DinerAI/1.0 (school term dates)" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`The page answered ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("The file is too big to read (over 8 MB).");
  const isPdf = type.includes("pdf") || bytes.subarray(0, 5).toString() === "%PDF-";
  const page = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: bytes.toString("base64") } }
    : { type: "text" as const, text: textFromHtml(bytes.toString("utf8"), 60_000) };
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low", format: betaZodOutputFormat(Rows) },
    system:
      "You copy school term dates from a UK council's published calendar into rows, exactly as written. Never guess or fill in a date that isn't there; if the page gives the pattern for another year or for academies only, say so in unreadable. Dates are UK style on the page (day before month).",
    messages: [
      {
        role: "user",
        content: [page, { type: "text" as const, text: `This is ${councilName} council's school term dates (${url}). List every term, with its half term, and any inset days it lists.` }],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't read this page.");
  const out = response.parsed_output as z.infer<typeof Rows>;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const rows = out.rows
    .filter((r) => iso.test(r.start_day) && iso.test(r.end_day))
    .map((r) => {
      const row: SchoolDate = {
        council_code: councilCode,
        kind: r.kind,
        start_day: r.start_day,
        end_day: r.end_day,
        half_term_start: r.half_term_start && iso.test(r.half_term_start) ? r.half_term_start : null,
        half_term_end: r.half_term_end && iso.test(r.half_term_end) ? r.half_term_end : null,
        academic_year: academicYearOf(r.start_day),
        notes: r.notes,
      };
      return { ...row, problem: schoolDateProblems(row) };
    });
  return { rows, notes: out.unreadable };
}
