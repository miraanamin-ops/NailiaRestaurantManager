// The weekly report's frozen data. Saved as JSON when the report is made, and
// read by both the web page and the PDF, so they always show the same numbers.
// No server-only imports here: the page components use these types too.

// This week vs the week before.
export type Compare = { now: number; before: number };

// 14 daily values: the first 7 are the week before, the last 7 are last week.
export type Daily = { days: string[]; values: number[] };

export type HeadlineSection = {
  id: "headline";
  stats: { label: string; value: Compare; format: "rating" | "count" }[];
  sentence: string;
};

export type ReputationSection = {
  id: "reputation";
  rating: Compare; // average Google rating at the end of each week
  totalReviews: number;
  newReviews: Compare;
  answered: Compare; // replies posted that week
  newAverage: Compare | null; // average stars of that week's new reviews
  praise: string[];
  complaints: string[];
  daily: Daily; // new reviews per day
};

export type CustomersSection = {
  id: "customers";
  signups: Compare;
  emailsSent: Compare;
  simulated: number; // last week's sends that were test-mode only
  opens: Compare;
  clicks: Compare;
  redemptions: Compare; // campaign offers + welcome rewards
  rewardRedemptions: Compare; // just the welcome rewards
  campaigns: { name: string; sent: number; opened: number; redeemed: number }[];
  daily: Daily; // sign-ups per day
};

export type GoogleSection = {
  id: "google";
  posts: Compare;
  recentPosts: { text: string; publishedAt: string }[];
  // Only once Google is connected for real (hidden in dummy mode).
  insights: { views: Compare; calls: Compare; directions: Compare } | null;
};

export type ActionsSection = {
  id: "actions";
  actions: { title: string; why: string; message: string }[];
};

export type ReportSection = HeadlineSection | ReputationSection | CustomersSection | GoogleSection | ActionsSection;
export type SectionId = ReportSection["id"];

export type ReportData = {
  version: 1;
  restaurant: { name: string; tagline: string | null; brandColor: string; brandDark: string };
  period: { start: string; end: string; label: string; prevLabel: string };
  googleMode: "dummy" | "live";
  // The WhatsApp number the action buttons open a chat with (digits only), if known.
  whatsappNumber: string | null;
  sections: ReportSection[];
};

export const SECTION_TITLES: Record<SectionId, string> = {
  headline: "This week",
  reputation: "Reputation",
  customers: "Customers and campaigns",
  google: "Google visibility",
  actions: "Next week's 3 actions",
};

// "+3", "−0.2", "no change": the small comparison under every number.
export function changeText(c: Compare, format: "rating" | "count" = "count") {
  const diff = c.now - c.before;
  if (format === "rating" ? Math.abs(diff) < 0.05 : diff === 0) return "same as the week before";
  const sign = diff > 0 ? "+" : "−";
  const abs = format === "rating" ? Math.abs(diff).toFixed(1) : String(Math.abs(diff));
  return `${sign}${abs} vs the week before`;
}

export function direction(c: Compare, format: "rating" | "count" = "count"): "up" | "down" | "same" {
  const diff = c.now - c.before;
  if (format === "rating" ? Math.abs(diff) < 0.05 : diff === 0) return "same";
  return diff > 0 ? "up" : "down";
}

export function formatValue(v: number, format: "rating" | "count") {
  return format === "rating" ? (v ? v.toFixed(1) : "–") : String(v);
}

// A wa.me link that opens WhatsApp with the action's message ready to send.
export function whatsappLink(number: string | null, message: string) {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

// Report links stop working after this many days (the owner gets a new one every Monday).
export const REPORT_LINK_DAYS = 30;

export function reportExpired(expiresAt: string | null, now: Date) {
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() <= now.getTime();
}
