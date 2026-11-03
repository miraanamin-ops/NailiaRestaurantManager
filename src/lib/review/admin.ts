import "server-only";
import { check } from "@/lib/drafts";
import { dryRunContext, googleDryRunReason } from "@/lib/gate-rules";
import { googleModeFor } from "@/lib/google";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { BusinessReview } from "./types";

// The builder's "Run business review" (/onboarding/admin/business-review): any
// restaurant with WhatsApp linked, real ones too (Pilot Zero, pilots who set up
// before the review existed). It runs the same job as setup finishing; every
// Google write still goes through the release gate, so a dry run stays a dry run.

export type AdminReviewRow = {
  id: string;
  name: string;
  kind: "test" | "demo" | "real";
  pilotZero: boolean;
  google: string; // "dummy", "simulated", "live"
  repliesDryRun: boolean;
  profileDryRun: boolean;
  review: Pick<BusinessReview, "status" | "started_by" | "sent_at" | "created_at"> | null;
};

export async function reviewAdminRows(): Promise<AdminReviewRow[]> {
  const restaurants = (check(await getSupabase().from("restaurants").select("*").not("owner_whatsapp", "is", null).order("name")) ?? []) as Restaurant[];
  const ids = restaurants.map((r) => r.id);
  let reviews: BusinessReview[] = [];
  try {
    reviews = ids.length ? ((check(await getSupabase().from("business_reviews").select("*").in("restaurant_id", ids)) ?? []) as BusinessReview[]) : [];
  } catch {
    reviews = []; // before supabase/058
  }
  const ctx = dryRunContext(process.env);
  return Promise.all(
    restaurants.map(async (r) => {
      const review = reviews.find((x) => x.restaurant_id === r.id) ?? null;
      return {
        id: r.id,
        name: r.name,
        kind: r.is_test ? "test" : r.is_demo ? "demo" : "real",
        pilotZero: r.pilot_zero === true,
        google: await googleModeFor(r.id),
        repliesDryRun: googleDryRunReason(r, "replies", ctx) !== null,
        profileDryRun: googleDryRunReason(r, "profile", ctx) !== null,
        review: review ? { status: review.status, started_by: review.started_by, sent_at: review.sent_at, created_at: review.created_at } : null,
      } satisfies AdminReviewRow;
    }),
  );
}
