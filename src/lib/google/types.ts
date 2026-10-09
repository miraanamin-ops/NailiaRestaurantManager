// The one interface the rest of the app uses for Google Business Profile.
// Two implementations: "dummy" (our own database) and "live" (the real API).

export type GoogleReview = {
  id: string;
  restaurant_id: string;
  author_name: string;
  rating: number;
  text: string | null;
  review_date: string;
  replied: boolean;
  reply_text: string | null;
  reply_posted_at: string | null;
  handled_at: string | null;
  source: string;
};

export type PostTopic = "update" | "offer" | "event";

export type GooglePost = {
  id: string;
  restaurant_id: string;
  draft_id: string | null;
  topic: PostTopic;
  text: string;
  photo_url: string | null;
  published_at: string | null;
  google_post_id: string | null;
  created_at: string;
};

export interface GoogleConnector {
  readonly mode: "dummy" | "live";

  /** All reviews, newest first. */
  listReviews(restaurantId: string): Promise<GoogleReview[]>;
  /**
   * Reviews the check hasn't handled yet, claimed in one step: two checks
   * running at once can never both get the same review.
   */
  claimNewReviews(restaurantId: string): Promise<GoogleReview[]>;
  /** Puts a claimed review back (e.g. drafting its reply failed) so the next check retries it. */
  releaseReview(reviewId: string): Promise<void>;
  /** Posts the owner's reply under a review. */
  replyToReview(restaurantId: string, reviewId: string, text: string): Promise<void>;

  /** Publishes a post; returns Google's id for it. */
  publishPost(restaurantId: string, post: Pick<GooglePost, "id" | "topic" | "text" | "photo_url">): Promise<{ googlePostId: string }>;
  /** Published posts, newest first. */
  listPublishedPosts(restaurantId: string): Promise<GooglePost[]>;

  /** Dummy mode only: pretend a new review has appeared on Google. */
  addDummyReview?(restaurantId: string, review: { author: string; rating: number; text: string }): Promise<GoogleReview>;
}
