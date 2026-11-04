// Settings for the business review Dina sends straight after onboarding
// (supabase/058_business_review.sql, lib/review/). Plain values, no imports, so
// tests and pages read the same numbers.

// Real restaurants get the review automatically when this is true (switched on
// with the builder's OK, 4 Nov 2026); false = only test and demo sites. The
// builder can run it for any site from the admin console either way.
export const OPEN_TO_REAL_SITES = true;

// The pieces of the review, each its own job. after: runs once that part is
// done (or has failed: `needs` says whether it can still run without it).
export const PARTS = ["reviews_sync", "backlog", "themes", "profile", "rivals", "events", "poster"] as const;
export type Part = (typeof PARTS)[number];
export const PART_AFTER: Partial<Record<Part, { after: Part; needs: boolean }>> = {
  backlog: { after: "reviews_sync", needs: true },
  themes: { after: "reviews_sync", needs: true },
  profile: { after: "reviews_sync", needs: false },
};

// The message goes when every part has finished, or this long after the review
// started with whatever is ready (missing sections are left out).
export const DEADLINE_MINUTES = 10;
// A send that was claimed but never finished (a crashed worker) can be claimed again after this.
export const SEND_CLAIM_STALE_MINUTES = 5;

// WhatsApp: a quick-reply message body can be 1,024 characters; the review stays under 1,000.
export const MESSAGE_MAX = 1000;

// Reviews: the most recent this many are read from Google; replies are drafted
// this many reviews per job; approved replies go to Google this far apart.
export const REVIEWS_MAX = 200;
export const REPLY_BATCH = 10;
export const REPLY_RELEASE_SECONDS = 10;

// The themes section needs at least this many reviews.
export const THEMES_MIN_REVIEWS = 10;

// Rivals: same primary category within 1 mile, closest first.
export const RIVALS = { count: 5, radiusMetres: 1609 } as const;

// Next 30 days of events; at most this many named in the message.
export const EVENTS_DAYS = 30;
export const EVENTS_IN_MESSAGE = 2;

// A profile score at or above this gets the "one of the best" line.
export const GREAT_SCORE = 90;

// The evening receipt: 8pm, or 2 hours after the review if that's later, never
// after 9pm (then it's in the next morning brief instead). UK time.
export const RECEIPT = { hour: 20, minHoursAfter: 2, latestHour: 21 } as const;

// Estimated minutes each piece of work saves the owner (the "about X hours" line).
export const MINUTES_SAVED = {
  review_reply: 4,
  profile_fix: 10,
  insight_summary: 30,
  rival_check: 30,
  campaign_draft: 20,
  google_post: 15,
  poster: 30,
} as const;
export type SavedAction = keyof typeof MINUTES_SAVED;

// Button ids (lib/review/flow.ts reads them back).
export const FLOW_PREFIX = "review:";
// The "See my review" button on the template sent outside the 24-hour window.
export const REVIEW_OPEN_ID = "review:open";
