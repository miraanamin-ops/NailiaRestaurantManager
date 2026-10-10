// The weekly report's frozen data. Saved as JSON when the report is made, and
// read by both the web page and the PDF, so they always show the same numbers.
// No server-only imports here: the page components use these types too.

// This week vs the week before.
export type Compare = { now: number; before: number };

// 14 daily values: the first 7 are the week before, the last 7 are last week.
export type Daily = { days: string[]; values: number[] };

// How a number is shown: a count, a star rating, or pounds.
export type ValueFormat = "rating" | "count" | "money";

export type HeadlineSection = {
  id: "headline";
  stats: { label: string; value: Compare; format: ValueFormat }[];
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

// Only when there's sales data (till reports, POS files or dummy data) for the fortnight.
export type SalesSection = {
  id: "sales";
  net: Compare; // net sales (excluding VAT), last week vs the week before
  lastMonth: number | null; // the same week four weeks earlier, if there's data for it
  daily: Daily; // net sales per day (pounds)
  daysWithData: Compare; // how many of the 7 days have figures
  transactions: Compare | null;
  avgSpend: Compare | null; // net per sale
  best: { day: string; amount: number } | null; // last week's best and worst day
  worst: { day: string; amount: number } | null;
  topItems: { name: string; quantity: number; amount: number }[]; // last week (amount includes VAT)
  netEstimated: boolean; // some days only had totals with VAT: net worked out at 20%
  dummy: boolean; // includes dummy data
};

export type ActionsSection = {
  id: "actions";
  actions: { title: string; why: string; message: string }[];
};

export type ReportSection = HeadlineSection | SalesSection | ReputationSection | CustomersSection | GoogleSection | ActionsSection;
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
  sales: "Sales",
  reputation: "Reputation",
  customers: "Customers and campaigns",
  google: "Google visibility",
  actions: "Next week's 3 actions",
};

// Under this much, a change counts as "the same" (a twentieth of a star, or 50p).
const SAME_WITHIN: Record<ValueFormat, number> = { rating: 0.05, count: 0.5, money: 0.5 };

// Whole pounds, or pounds and pence under £100 (e.g. an average spend of £19.40).
const pounds = (n: number) =>
  Math.abs(n) < 100 ? `£${n.toFixed(2)}` : `£${Math.round(n).toLocaleString("en-GB")}`;

// "+3", "−0.2", "+£340 (+6%)", "no change": the small comparison under every number.
export function changeText(c: Compare, format: ValueFormat = "count", vs = "the week before") {
  const diff = c.now - c.before;
  if (Math.abs(diff) < SAME_WITHIN[format]) return `same as ${vs}`;
  const sign = diff > 0 ? "+" : "−";
  if (format === "money") {
    const pct = c.before > 0 ? ` (${sign}${Math.round((Math.abs(diff) / c.before) * 100)}%)` : "";
    return `${sign}${pounds(Math.abs(diff))}${pct} vs ${vs}`;
  }
  const abs = format === "rating" ? Math.abs(diff).toFixed(1) : String(Math.abs(diff));
  return `${sign}${abs} vs ${vs}`;
}

export function direction(c: Compare, format: ValueFormat = "count"): "up" | "down" | "same" {
  const diff = c.now - c.before;
  if (Math.abs(diff) < SAME_WITHIN[format]) return "same";
  return diff > 0 ? "up" : "down";
}

export function formatValue(v: number, format: ValueFormat) {
  if (format === "money") return pounds(v);
  return format === "rating" ? (v ? v.toFixed(1) : "–") : String(v);
}

// The small print under the Sales section (web page and PDF).
export const SALES_FOOTNOTE = "Information about your business, not financial advice.";

// A wa.me link that opens WhatsApp with the action's message ready to send.
export function whatsappLink(number: string | null, message: string) {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

// Report links stop working after this many days (the owner gets a new one every Monday).
export const REPORT_LINK_DAYS = 30;

export function reportExpired(expiresAt: string | null, now: Date) {
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() <= now.getTime();
}
