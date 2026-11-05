import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import type { Period } from "@/lib/report/build";
import type { Restaurant } from "@/lib/supabase";
import { calendarBriefSection, financeBriefSection, lastWeekReportSection, nextWeekReportSection } from "./finance";
import { googleReportSection } from "./google";
import { photoAskBriefSection } from "@/lib/agents/photo-ask";
import { menuReportSection } from "./menu";
import { reviewBriefSection, timeSavedReportSection } from "@/lib/review/receipt";
import { runBriefSections, runReportSections, type BriefOffer, type BriefSectionDef, type ReportSectionDef } from "./types";

// The registry (./types.ts says how it works). To add a feature's block or section,
// import its definition and add one line to a list. Nothing else changes.
export const BRIEF_SECTIONS: BriefSectionDef[] = [
  financeBriefSection, // Mondays: this week's sales forecast and labour % (lib/finance)
  calendarBriefSection, // the local calendar's lines, and one campaign idea (lib/calendar-lines)
  reviewBriefSection, // the business review's receipt if it didn't go the evening before, else time saved so far (lib/review)
  photoAskBriefSection, // Tuesdays: one dish photo for Thursday's Google post (lib/agents/photo-ask)
];
export const REPORT_SECTIONS: ReportSectionDef[] = [
  lastWeekReportSection, // sales vs forecast, labour %, best and worst day
  googleReportSection, // rating, reviews, replies, calls, directions, views, 3 themes
  nextWeekReportSection, // forecast range, rota cost, key calendar dates
  menuReportSection, // menu engineering: winners, hidden gems, crowd-pleasers (lib/menu-engineering)
  timeSavedReportSection, // about how much time DinerAI saved, last week and so far (lib/review)
];

const reportFailure = (where: string, restaurant: Restaurant) => (id: string, err: unknown) => {
  console.error(`The ${id} section of the ${where} failed; it goes without it`, err);
  void alertBuilder(`section-error:${where}:${id}:${restaurant.id}`, `Section "${id}" left out of the ${where} for ${restaurant.name}: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
};

// The features' blocks for this morning's brief (both brief paths), and the
// offers ("Draft an offer" / "Not now") to send after it.
export async function briefSections(restaurant: Restaurant, now: Date): Promise<{ blocks: string[]; offers: BriefOffer[] }> {
  const offers: BriefOffer[] = [];
  const blocks = await runBriefSections(BRIEF_SECTIONS, { restaurant, now }, reportFailure("brief", restaurant), offers);
  return { blocks, offers };
}

// The features' sections for the Monday report.
export function reportFeatureSections(restaurant: Restaurant, period: Period) {
  return runReportSections(REPORT_SECTIONS, { restaurant, period }, reportFailure("report", restaurant));
}
