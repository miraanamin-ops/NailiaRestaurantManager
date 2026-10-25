import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import type { Period } from "@/lib/report/build";
import type { Restaurant } from "@/lib/supabase";
import { runBriefSections, runReportSections, type BriefSectionDef, type ReportSectionDef } from "./types";

// The registry (./types.ts says how it works). To add a feature's block or section,
// import its definition and add one line to a list. Nothing else changes.
export const BRIEF_SECTIONS: BriefSectionDef[] = [];
export const REPORT_SECTIONS: ReportSectionDef[] = [];

const reportFailure = (where: string, restaurant: Restaurant) => (id: string, err: unknown) => {
  console.error(`The ${id} section of the ${where} failed; it goes without it`, err);
  void alertBuilder(`section-error:${where}:${id}:${restaurant.id}`, `Section "${id}" left out of the ${where} for ${restaurant.name}: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
};

// The features' blocks for this morning's brief (both brief paths).
export function briefSectionBlocks(restaurant: Restaurant, now: Date) {
  return runBriefSections(BRIEF_SECTIONS, { restaurant, now }, reportFailure("brief", restaurant));
}

// The features' sections for the Monday report.
export function reportFeatureSections(restaurant: Restaurant, period: Period) {
  return runReportSections(REPORT_SECTIONS, { restaurant, period }, reportFailure("report", restaurant));
}
