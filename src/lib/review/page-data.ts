import "server-only";
import { check } from "@/lib/drafts";
import type { Owner } from "@/lib/auth";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { factsFor } from "./job";
import { sectionLines, type ReviewFacts } from "./rules";
import type { BusinessReview, PartRecord } from "./types";

// What the review page (/review/[slug], behind login) shows: the restaurant is
// found from the link, and only if this person may see it.
export type ReviewPage = { restaurant: Restaurant; review: BusinessReview | null; parts: PartRecord[]; facts: ReviewFacts | null; lines: string[] };

export async function reviewPageFor(owner: Owner, slug: string): Promise<ReviewPage | null> {
  const bySlug = check(await getSupabase().from("restaurants").select("*").eq("slug", slug).maybeSingle<Restaurant>());
  const restaurant = bySlug ?? (/^[0-9a-f-]{36}$/i.test(slug) ? check(await getSupabase().from("restaurants").select("*").eq("id", slug).maybeSingle<Restaurant>()) : null);
  if (!restaurant || !owner.restaurantIds.includes(restaurant.id)) return null;
  const review = check(await getSupabase().from("business_reviews").select("*").eq("restaurant_id", restaurant.id).maybeSingle<BusinessReview>());
  if (!review) return { restaurant, review: null, parts: [], facts: null, lines: [] };
  const parts = (check(await getSupabase().from("business_review_parts").select("*").eq("review_id", review.id)) ?? []) as PartRecord[];
  const facts = await factsFor(review, restaurant);
  return { restaurant, review, parts, facts, lines: sectionLines(facts) };
}
