// The section registry (docs/pilot-sprint.md): each feature adds its own block to
// the 9am brief and its own section to the Monday report, without editing the
// brief, the report or any other feature. A feature writes one file with its
// definitions and adds one line to the lists in ./index.ts.
// No imports beyond types, so it's unit-tested (tests/sections.test.ts).
import type { Restaurant } from "@/lib/supabase";
import type { Period } from "@/lib/report/build";
import type { FeatureSection } from "@/lib/report/types";

// ---------- The 9am brief ----------

// A block of the brief: lines code wrote, shown unchanged after the forecast
// (the GM's composer never sees or rewords them). null or "" = nothing today.
export type BriefSectionDef = {
  id: string; // "rota", "events"... unique
  order: number; // lower comes first
  block: (input: { restaurant: Restaurant; now: Date }) => Promise<string | null>;
};

// ---------- The Monday report ----------

// A report section: a title, up to 3 numbers compared with the week before, and
// a few lines. Drawn by one shared renderer on the page and in the PDF.
export type ReportSectionDef = {
  id: string; // becomes FeatureSection.key; unique
  order: number;
  build: (input: { restaurant: Restaurant; period: Period }) => Promise<Omit<FeatureSection, "id" | "key"> | null>;
  // The section's numbers in a sentence, for the AI that writes the headline and actions ("" = none).
  facts?: (s: FeatureSection) => string;
};

type Failed = (id: string, err: unknown) => void;

// Every block in order; a failing one is left out (and reported), never stopping the brief.
export async function runBriefSections(defs: BriefSectionDef[], input: { restaurant: Restaurant; now: Date }, failed: Failed) {
  const out: string[] = [];
  for (const def of [...defs].sort((a, b) => a.order - b.order)) {
    try {
      const block = (await def.block(input))?.trim();
      if (block) out.push(block);
    } catch (err) {
      failed(def.id, err);
    }
  }
  return out;
}

// Every section in order, with its facts; a failing one is left out (and reported).
export async function runReportSections(defs: ReportSectionDef[], input: { restaurant: Restaurant; period: Period }, failed: Failed) {
  const sections: FeatureSection[] = [];
  const facts: string[] = [];
  for (const def of [...defs].sort((a, b) => a.order - b.order)) {
    try {
      const built = await def.build(input);
      if (!built) continue;
      const section: FeatureSection = { ...built, id: "feature", key: def.id, stats: built.stats.slice(0, 3) };
      sections.push(section);
      const f = def.facts?.(section);
      if (f) facts.push(f);
    } catch (err) {
      failed(def.id, err);
    }
  }
  return { sections, facts };
}
