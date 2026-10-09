import "server-only";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import type { GoogleConnector, GooglePost, GoogleReview } from "./types";

// Dummy mode: our own database plays the part of Google.
// reviews = the reviews on the listing; google_posts with published_at = live posts.
export const dummyGoogle: GoogleConnector = {
  mode: "dummy",

  async listReviews(restaurantId) {
    const res = await getSupabase()
      .from("reviews")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("review_date", { ascending: false })
      .returns<GoogleReview[]>();
    return check(res) ?? [];
  },

  async claimNewReviews(restaurantId) {
    // One UPDATE ... WHERE handled_at IS NULL: the database hands each review to one check only.
    const res = await getSupabase()
      .from("reviews")
      .update({ handled_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .is("handled_at", null)
      .select("*")
      .order("review_date")
      .returns<GoogleReview[]>();
    return check(res) ?? [];
  },

  async releaseReview(reviewId) {
    check(await getSupabase().from("reviews").update({ handled_at: null }).eq("id", reviewId));
  },

  async replyToReview(restaurantId, reviewId, text) {
    check(
      await getSupabase()
        .from("reviews")
        .update({ reply_text: text, reply_posted_at: new Date().toISOString(), replied: true })
        .eq("id", reviewId)
        .eq("restaurant_id", restaurantId),
    );
  },

  async publishPost(restaurantId, post) {
    const googlePostId = `dummy-${post.id.slice(0, 8)}`;
    check(
      await getSupabase()
        .from("google_posts")
        .update({ published_at: new Date().toISOString(), google_post_id: googlePostId })
        .eq("id", post.id)
        .eq("restaurant_id", restaurantId),
    );
    return { googlePostId };
  },

  async listPublishedPosts(restaurantId) {
    const res = await getSupabase()
      .from("google_posts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .returns<GooglePost[]>();
    return check(res) ?? [];
  },

  async addDummyReview(restaurantId, review) {
    return checkRow(
      await getSupabase()
        .from("reviews")
        .insert({
          restaurant_id: restaurantId,
          author_name: review.author,
          rating: review.rating,
          text: review.text,
          replied: false,
          source: "dummy_google",
        })
        .select("*")
        .single<GoogleReview>(),
    );
  },
};
