import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { googleSwitch } from "@/lib/switches";
import { dummyGoogle } from "./dummy";
import { liveGoogle } from "./live";
import type { GoogleConnector } from "./types";

export type { GoogleConnector, GooglePost, GoogleReview, PostTopic } from "./types";

// The only way the app talks to Google. Picked per restaurant:
//   GOOGLE_MODE dummy (default)      every restaurant uses our own database
//   GOOGLE_MODE simulated or live    a restaurant that has linked its Google
//                                    location uses the real API; one that hasn't
//                                    (e.g. the demo restaurants) stays on dummy.
// Simulated reads live Google and the send gate (lib/send.ts) posts nothing.
// (lib/switches.ts: preview and development never write to live Google.)

export type GoogleMode = "dummy" | "simulated" | "live";

async function linked(restaurantId: string) {
  const r = check(
    await getSupabase().from("restaurants").select("google_connection_id, google_location_id").eq("id", restaurantId).maybeSingle<{ google_connection_id: string | null; google_location_id: string | null }>(),
  );
  return Boolean(r?.google_connection_id && r.google_location_id);
}

// What Google means for this restaurant right now.
export async function googleModeFor(restaurantId: string): Promise<GoogleMode> {
  const mode = googleSwitch(process.env).mode;
  if (mode === "dummy") return "dummy";
  return (await linked(restaurantId)) ? mode : "dummy";
}

export async function googleFor(restaurantId: string): Promise<GoogleConnector> {
  return (await googleModeFor(restaurantId)) === "dummy" ? dummyGoogle : liveGoogle;
}

// The connector for code that passes the restaurant to each call: every call
// goes to that restaurant's own connector.
export function google(): Omit<GoogleConnector, "mode" | "addDummyReview"> {
  const via = async (id: string) => googleFor(id);
  return {
    listReviews: async (id) => (await via(id)).listReviews(id),
    claimNewReviews: async (id) => (await via(id)).claimNewReviews(id),
    // Both modes keep their claims in our own table.
    markReviewHandled: (reviewId) => dummyGoogle.markReviewHandled(reviewId),
    releaseReview: (reviewId) => dummyGoogle.releaseReview(reviewId),
    replyToReview: async (id, reviewId, text) => (await via(id)).replyToReview(id, reviewId, text),
    removeReply: async (id, reviewId) => (await via(id)).removeReply(id, reviewId),
    publishPost: async (id, post) => (await via(id)).publishPost(id, post),
    unpublishPost: async (id, postId) => (await via(id)).unpublishPost(id, postId),
    listPublishedPosts: async (id) => (await via(id)).listPublishedPosts(id),
  };
}
