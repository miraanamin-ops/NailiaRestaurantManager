import "server-only";
import { check } from "@/lib/drafts";
import type { Theme } from "@/lib/sections/google-rules";
import { getSupabase } from "@/lib/supabase";
import { countThemes, type ReviewTag, type TagReview } from "./themes-rules";

// The Monday report's themes from the saved review tags (lib/review/parts/themes.ts),
// counted by code: no second AI call. null: none of these reviews is tagged.
export async function tagThemesFor(restaurantId: string, reviews: TagReview[], max = 3): Promise<Theme[] | null> {
  const ids = reviews.filter((r) => r.text).map((r) => r.id);
  if (!ids.length) return null;
  const tags = (check(await getSupabase().from("review_tags").select("review_id, themes, sentiment").eq("restaurant_id", restaurantId).in("review_id", ids)) ?? []) as ReviewTag[];
  if (!tags.length) return null;
  const { praises, complaints } = countThemes(tags, reviews);
  return [...praises.map((c) => ({ label: c.label, count: c.count, tone: "praised" as const })), ...complaints.map((c) => ({ label: c.label, count: c.count, tone: "complaint" as const }))]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max);
}
