import "server-only";
import type { GoogleConnector } from "./types";

// Live mode: the real Google Business Profile API. Not built yet.
//
// When we add it, each method maps to an API call, and reviews are copied
// into our `reviews` table so the rest of the app keeps working unchanged:
// - listReviews / claimNewReviews: GET accounts/{a}/locations/{l}/reviews,
//   upserted into `reviews` by google_review_id (new rows have handled_at = null),
//   then claimed from that table exactly as dummy mode does
// - replyToReview: PUT .../reviews/{id}/reply
// - publishPost: POST .../localPosts (photo via media URL)
// - listPublishedPosts: GET .../localPosts
// - getInsights: Business Profile Performance API fetchMultiDailyMetricsTimeSeries
//   (BUSINESS_IMPRESSIONS_*, CALL_CLICKS, BUSINESS_DIRECTION_REQUESTS)
// It needs Google API access approval, an OAuth login per restaurant, and
// the restaurant's account and location IDs.
function notYet(): never {
  throw new Error("Live Google mode isn't set up yet. Set GOOGLE_MODE=dummy (the default).");
}

export const liveGoogle: GoogleConnector = {
  mode: "live",
  listReviews: async () => notYet(),
  claimNewReviews: async () => notYet(),
  releaseReview: async () => notYet(),
  replyToReview: async () => notYet(),
  publishPost: async () => notYet(),
  listPublishedPosts: async () => notYet(),
  getInsights: async () => notYet(),
};
