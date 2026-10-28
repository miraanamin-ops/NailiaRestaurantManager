import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter } from "@/lib/agents/definition";

// Dina's instructions: agents/dina.md (front matter, then the prompt; the
// changelog is left out of what Claude sees). Her tools line is an allow-list:
// a tool the code offers that isn't listed there is refused (tests/dina.test.ts).
// Unlike the drafting agents she doesn't load house-rules.md (it's about drafts
// for customers); her own rules cover truth, data and style.

export type DinaDefinition = { version: string; tools: string[]; systemPrompt: string };

export function dinaDefinition(text: string): DinaDefinition {
  const { fields, body } = parseFrontMatter(text);
  if (fields.name !== "dina") throw new Error("dina.md: name must be dina");
  if (typeof fields.version !== "string" || !/^\d+\.\d+$/.test(fields.version)) throw new Error("dina.md: version must look like 0.1");
  if (!Array.isArray(fields.tools)) throw new Error("dina.md: tools must be a list like [a, b]");
  const changelog = body.search(/^# Changelog\s*$/m);
  if (changelog < 0 || !new RegExp(`^- ${fields.version.replace(".", "\\.")} \\(`, "m").test(body.slice(changelog))) {
    throw new Error(`dina.md: the changelog needs a line for version ${fields.version}`);
  }
  return { version: fields.version, tools: fields.tools, systemPrompt: body.slice(0, changelog).trim() };
}

let cached: DinaDefinition | null = null;
export function loadDina(): DinaDefinition {
  cached ??= dinaDefinition(readFileSync(join(process.cwd(), "agents", "dina.md"), "utf8"));
  return cached;
}

export function assertDinaTools(def: DinaDefinition, names: string[]) {
  const extra = names.filter((n) => !def.tools.includes(n));
  if (extra.length) throw new Error(`Dina isn't allowed these tools (not in agents/dina.md): ${extra.join(", ")}`);
}
