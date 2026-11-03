import "server-only";
import { check, type Draft } from "@/lib/drafts";
import type { Owner } from "@/lib/auth";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { factsFor } from "./job";
import { rivalsNow, type PlaceRating } from "./rivals";
import { sectionLines, type ReviewFacts } from "./rules";
import type { BusinessReview, PartRecord, PartResults } from "./types";

// What the review page (/review/[slug], behind login) shows: the restaurant is
// found from the link, and only if this person may see it. Rivals are fetched
// fresh (Places terms); everything else is what the review saved.
export type ReviewPage = {
  restaurant: Restaurant;
  review: BusinessReview | null;
  facts: ReviewFacts | null;
  lines: string[];
  profile: PartResults["profile"] | null;
  themes: PartResults["themes"] | null;
  backlog: PartResults["backlog"] | null;
  rivals: { ours: PartResults["rivals"]["ours"]; list: PlaceRating[] } | null;
  planned: Pick<Draft, "id" | "kind" | "status" | "content" | "audience">[];
  poster: boolean;
};

export async function reviewPageFor(owner: Owner, slug: string): Promise<ReviewPage | null> {
  const db = getSupabase();
  const bySlug = check(await db.from("restaurants").select("*").eq("slug", slug).maybeSingle<Restaurant>());
  const restaurant = bySlug ?? (/^[0-9a-f-]{36}$/i.test(slug) ? check(await db.from("restaurants").select("*").eq("id", slug).maybeSingle<Restaurant>()) : null);
  if (!restaurant || !owner.restaurantIds.includes(restaurant.id)) return null;
  const review = check(await db.from("business_reviews").select("*").eq("restaurant_id", restaurant.id).maybeSingle<BusinessReview>());
  const empty: ReviewPage = { restaurant, review, facts: null, lines: [], profile: null, themes: null, backlog: null, rivals: null, planned: [], poster: false };
  if (!review) return empty;
  const parts = (check(await db.from("business_review_parts").select("*").eq("review_id", review.id)) ?? []) as PartRecord[];
  const result = <P extends keyof PartResults>(p: P) => {
    const row = parts.find((x) => x.part === p && (x.status === "done" || x.status === "queued"));
    return (row?.result ?? null) as PartResults[P] | null;
  };
  const facts = await factsFor(review, restaurant);
  const rivalsPart = result("rivals");
  const planned = (check(await db.from("drafts").select("id, kind, status, content, audience").eq("restaurant_id", restaurant.id).eq("business_review_id", review.id).in("kind", ["email_campaign", "google_post"])) ?? []) as ReviewPage["planned"];
  return {
    ...empty,
    facts,
    lines: sectionLines(facts),
    profile: review.google_connected ? result("profile") : null,
    themes: result("themes"),
    backlog: review.google_connected ? result("backlog") : null,
    rivals: rivalsPart ? { ours: rivalsPart.ours, list: await rivalsNow(restaurant).catch(() => []) } : null,
    planned,
    poster: Boolean(result("poster")?.ready && restaurant.slug),
  };
}
