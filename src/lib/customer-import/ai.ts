import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, fallbackFor, MAX_TOKENS, MODELS } from "@/lib/claude";
import { columnShapes, mappingProblems, ruleMapping, type Mapping, type Table } from "./rules";

// Which column is the email, name, phone and birthday, read by AI from the headings
// and what each column looks like (how many cells look like emails, phones or dates):
// never the customers' names, emails or numbers. Checked by code; if the AI's
// mapping doesn't hold up, the rules' mapping is used instead.

const AiMapping = z.object({
  email: z.number().int().nullable().describe("The column number holding email addresses"),
  name: z.number().int().nullable().describe("The column with the first name (or the full name if there's no first name column), or null"),
  phone: z.number().int().nullable().describe("The column with phone numbers, or null"),
  birthday: z.number().int().nullable().describe("The column with dates of birth or birthdays, or null"),
});

export async function mapColumns(table: Table): Promise<{ mapping: Mapping; by: "ai" | "rules" }> {
  const rules = ruleMapping(table);
  try {
    const shapes = columnShapes(table);
    const response = await claude().beta.messages.parse({
      ...fallbackFor("haiku"),
      model: MODELS.haiku,
      max_tokens: Math.min(MAX_TOKENS, 1024),
      output_config: { effort: "low", format: betaZodOutputFormat(AiMapping) },
      messages: [
        {
          role: "user",
          content: `A restaurant owner uploaded a customer list. Here are its columns: the heading and the share of cells that look like an email, a phone number or a date (no customer data). Say which column number holds each field (null if none). Headings can be in any language or a booking system's own words ("Guest", "E-mail address", "DOB", "Mobile").\n\n${JSON.stringify(shapes, null, 2)}`,
        },
      ],
    });
    const out = response.parsed_output;
    if (out && !mappingProblems(table, out).length) return { mapping: out, by: "ai" };
  } catch (err) {
    console.error("AI column mapping failed; using the rules", err);
  }
  return { mapping: rules, by: "rules" };
}
