import "server-only";
import { writeReportInsights, type RestaurantContext } from "@/lib/assistant";
import { londonYmd, startOfLondonDay } from "@/lib/clock";
import { addDays } from "@/lib/sales/format";
import { buildSalesSection, salesFacts, type SalesDayRow, type SalesItemRow } from "@/lib/sales/report-section";
import { selectAll } from "@/lib/sales/store";
import { check, checkRow } from "@/lib/drafts";
import { google, type GooglePost, type GoogleReview } from "@/lib/google";
import { newToken } from "@/lib/signups";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { plural } from "@/lib/text";
import {
  direction,
  REPORT_LINK_DAYS,
  type ActionsSection,
  type Compare,
  type CustomersSection,
  type Daily,
  type GoogleSection,
  type HeadlineSection,
  type ReportData,
  type ReportSection,
  type ReputationSection,
  type SalesSection,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;

// ---------- Periods ----------

export type Period = { prevStart: Date; start: Date; end: Date };

// Scheduled (Monday 9am): last Monday to Sunday. RUN REPORT: the last 7 days
// including today (so far), in whole London days.
export function reportPeriod(now: Date, scheduled: boolean): Period {
  const end = scheduled ? startOfLondonDay(now) : startOfLondonDay(new Date(now.getTime() + DAY));
  return { prevStart: new Date(end.getTime() - 14 * DAY), start: new Date(end.getTime() - 7 * DAY), end };
}

function rangeLabel(from: Date, to: Date) {
  const last = new Date(to.getTime() - 1);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { timeZone: "Europe/London", ...opts });
  const sameMonth = fmt(from, { month: "short" }) === fmt(last, { month: "short" });
  return sameMonth
    ? `${fmt(from, { day: "numeric" })}–${fmt(last, { day: "numeric", month: "short" })}`
    : `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short" })}`;
}

// ---------- Counting helpers ----------

type When = string | null | undefined;
const inRange = (t: When, from: Date, to: Date) => {
  if (!t) return false;
  const ms = new Date(t).getTime();
  return ms >= from.getTime() && ms < to.getTime();
};
const compare = (times: When[], p: Period): Compare => ({
  now: times.filter((t) => inRange(t, p.start, p.end)).length,
  before: times.filter((t) => inRange(t, p.prevStart, p.start)).length,
});
function daily(times: When[], p: Period): Daily {
  const days: string[] = [];
  const values: number[] = [];
  for (let i = 0; i < 14; i++) {
    const from = new Date(p.prevStart.getTime() + i * DAY);
    const to = new Date(from.getTime() + DAY);
    days.push(from.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric" }));
    values.push(times.filter((t) => inRange(t, from, to)).length);
  }
  return { days, values };
}
const average = (nums: number[]) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0);

// ---------- Data sections ----------
// Each section says whether its data is connected, and builds its numbers.
// To add Sales, Operations or Finance later: add a type in ./types.ts, a builder
// here (connected() returns false until that data exists), and a renderer in the
// page and the PDF. Sections that aren't connected simply don't appear.

type Rows = {
  reviews: GoogleReview[];
  signups: { created_at: string }[];
  sends: { campaign_id: string; created_at: string; delivery: string; opened_at: When; clicked_at: When; redeemed_at: When }[];
  campaigns: { id: string; name: string; sent_at: string | null }[];
  rewards: { redeemed_at: When }[];
  posts: GooglePost[];
  salesDays: SalesDayRow[]; // from four weeks before last week, to the end of last week
  salesItems: SalesItemRow[]; // last week
};

type BuildInput = { restaurant: Restaurant; period: Period; rows: Rows };

type DataSection = {
  id: Exclude<ReportSection["id"], "headline" | "actions">;
  connected: (r: Restaurant) => boolean;
  build: (input: BuildInput) => Promise<ReportSection | null>;
  // The section's numbers in a few lines, for the AI that writes the summary and actions.
  facts: (s: ReportSection) => string;
};

const DATA_SECTIONS: DataSection[] = [
  {
    id: "sales",
    connected: () => true, // left out (build returns null) until there are sales figures for the fortnight
    async build({ period: p, rows }) {
      return buildSalesSection(londonYmd(p.start), rows.salesDays, rows.salesItems);
    },
    facts: (s) => salesFacts(s as SalesSection),
  },
  {
    id: "reputation",
    connected: () => true, // dummy or live Google: reviews always come through the connector
    async build({ period: p, rows }) {
      const ratingAt = (t: Date) => average(rows.reviews.filter((r) => new Date(r.review_date) < t).map((r) => r.rating));
      const newNow = rows.reviews.filter((r) => inRange(r.review_date, p.start, p.end));
      const newBefore = rows.reviews.filter((r) => inRange(r.review_date, p.prevStart, p.start));
      const section: ReputationSection = {
        id: "reputation",
        rating: { now: ratingAt(p.end), before: ratingAt(p.start) },
        totalReviews: rows.reviews.filter((r) => new Date(r.review_date) < p.end).length,
        newReviews: { now: newNow.length, before: newBefore.length },
        answered: compare(rows.reviews.map((r) => r.reply_posted_at), p),
        newAverage: newNow.length || newBefore.length ? { now: average(newNow.map((r) => r.rating)), before: average(newBefore.map((r) => r.rating)) } : null,
        praise: [],
        complaints: [],
        daily: daily(rows.reviews.map((r) => r.review_date), p),
      };
      return section;
    },
    facts(s) {
      const r = s as ReputationSection;
      return `Google rating ${r.rating.now} (week before ${r.rating.before}), ${r.totalReviews} reviews in total. New reviews ${r.newReviews.now} (before ${r.newReviews.before}). Reviews answered ${r.answered.now} (before ${r.answered.before}).${r.newAverage ? ` New reviews averaged ${r.newAverage.now} stars (before ${r.newAverage.before}).` : ""}`;
    },
  },
  {
    id: "customers",
    connected: () => true,
    async build({ period: p, rows }) {
      const lastWeekSends = rows.sends.filter((s) => inRange(s.created_at, p.start, p.end));
      const offerRedeemed = rows.sends.map((s) => s.redeemed_at);
      const rewardRedeemed = rows.rewards.map((r) => r.redeemed_at);
      const section: CustomersSection = {
        id: "customers",
        signups: compare(rows.signups.map((s) => s.created_at), p),
        emailsSent: compare(rows.sends.map((s) => s.created_at), p),
        simulated: lastWeekSends.filter((s) => s.delivery === "simulated").length,
        opens: compare(rows.sends.map((s) => s.opened_at), p),
        clicks: compare(rows.sends.map((s) => s.clicked_at), p),
        redemptions: compare([...offerRedeemed, ...rewardRedeemed], p),
        rewardRedemptions: compare(rewardRedeemed, p),
        campaigns: rows.campaigns
          .filter((c) => inRange(c.sent_at, p.start, p.end))
          .map((c) => {
            const sends = rows.sends.filter((s) => s.campaign_id === c.id);
            return { name: c.name, sent: sends.length, opened: sends.filter((s) => s.opened_at).length, redeemed: sends.filter((s) => s.redeemed_at).length };
          }),
        daily: daily(rows.signups.map((s) => s.created_at), p),
      };
      return section;
    },
    facts(s) {
      const c = s as CustomersSection;
      return `New email sign-ups ${c.signups.now} (before ${c.signups.before}). Campaign emails sent ${c.emailsSent.now} (before ${c.emailsSent.before}), opened ${c.opens.now} (before ${c.opens.before}), clicked ${c.clicks.now} (before ${c.clicks.before}). Offers and welcome rewards redeemed ${c.redemptions.now} (before ${c.redemptions.before}).${c.campaigns.length ? ` Campaigns last week: ${c.campaigns.map((x) => `"${x.name}" (${x.sent} sent, ${x.redeemed} redeemed)`).join(", ")}.` : " No campaigns last week."}`;
    },
  },
  {
    id: "google",
    connected: () => true,
    async build({ restaurant, period: p, rows }) {
      const g = google();
      let insights: GoogleSection["insights"] = null;
      // Views, calls and direction requests only exist once Google is live.
      if (g.mode === "live" && g.getInsights) {
        try {
          const [now, before] = await Promise.all([g.getInsights(restaurant.id, p.start, p.end), g.getInsights(restaurant.id, p.prevStart, p.start)]);
          insights = {
            views: { now: now.views, before: before.views },
            calls: { now: now.calls, before: before.calls },
            directions: { now: now.directions, before: before.directions },
          };
        } catch (err) {
          console.error("Google insights failed; leaving them out of the report", err);
        }
      }
      const section: GoogleSection = {
        id: "google",
        posts: compare(rows.posts.map((x) => x.published_at), p),
        recentPosts: rows.posts
          .filter((x) => inRange(x.published_at, p.start, p.end))
          .slice(0, 3)
          .map((x) => ({ text: x.text, publishedAt: x.published_at! })),
        insights,
      };
      return section;
    },
    facts(s) {
      const g = s as GoogleSection;
      return `Google posts published ${g.posts.now} (before ${g.posts.before}).${g.insights ? ` Listing views ${g.insights.views.now}, calls ${g.insights.calls.now}, direction requests ${g.insights.directions.now}.` : ""}`;
    },
  },
];

async function loadRows(restaurant: Restaurant, p: Period): Promise<Rows> {
  const supabase = getSupabase();
  const since = p.prevStart.toISOString();
  const [weekStart, weekEnd] = [londonYmd(p.start), londonYmd(p.end)];
  const [reviews, signups, sends, campaigns, rewards, posts, salesDays, salesItems] = await Promise.all([
    google().listReviews(restaurant.id),
    supabase.from("customer_events").select("created_at").eq("restaurant_id", restaurant.id).eq("type", "signup").gte("created_at", since).returns<Rows["signups"]>(),
    supabase
      .from("campaign_sends")
      .select("campaign_id, created_at, delivery, opened_at, clicked_at, redeemed_at")
      .eq("restaurant_id", restaurant.id)
      .eq("kind", "customer")
      .returns<Rows["sends"]>(),
    supabase.from("campaigns").select("id, name, sent_at").eq("restaurant_id", restaurant.id).gte("sent_at", since).returns<Rows["campaigns"]>(),
    supabase.from("rewards").select("redeemed_at").eq("restaurant_id", restaurant.id).gte("redeemed_at", since).returns<Rows["rewards"]>(),
    google().listPublishedPosts(restaurant.id),
    supabase
      .from("sales_days")
      .select("day, net_sales, transactions, net_estimated, is_dummy")
      .eq("restaurant_id", restaurant.id)
      .gte("day", addDays(weekStart, -28))
      .lt("day", weekEnd)
      .returns<SalesDayRow[]>(),
    selectAll<SalesItemRow>((from, to) =>
      supabase.from("sales_items").select("item, quantity, amount").eq("restaurant_id", restaurant.id).gte("day", weekStart).lt("day", weekEnd).range(from, to),
    ),
  ]);
  return {
    reviews,
    signups: check(signups) ?? [],
    sends: check(sends) ?? [],
    campaigns: check(campaigns) ?? [],
    rewards: check(rewards) ?? [],
    posts,
    salesDays: (check(salesDays) ?? []).map((d) => ({ ...d, net_sales: Number(d.net_sales) })),
    salesItems,
  };
}

// ---------- Headline, actions and the WhatsApp message ----------

function verdict(r: ReputationSection | undefined, c: CustomersSection | undefined, s?: SalesSection) {
  const dirs = [s && direction(s.net, "money"), r && direction(r.rating, "rating"), c && direction(c.signups), c && direction(c.redemptions)].filter(Boolean);
  const ups = dirs.filter((d) => d === "up").length;
  const downs = dirs.filter((d) => d === "down").length;
  return ups > downs ? "Good week" : downs > ups ? "Quieter week" : "Steady week";
}

// Two lines for WhatsApp, e.g. "Good week: rating up to 4.6, 18 new sign-ups." + the link.
export function whatsappHeadline(data: ReportData, url: string) {
  const r = data.sections.find((s): s is ReputationSection => s.id === "reputation");
  const c = data.sections.find((s): s is CustomersSection => s.id === "customers");
  const sales = data.sections.find((s): s is SalesSection => s.id === "sales");
  const bits: string[] = [];
  if (sales) {
    const d = direction(sales.net, "money");
    const pct = sales.net.before ? Math.round((Math.abs(sales.net.now - sales.net.before) / sales.net.before) * 100) : 0;
    bits.push(`sales £${Math.round(sales.net.now).toLocaleString("en-GB")}${d === "same" || !pct ? "" : ` (${d === "up" ? "up" : "down"} ${pct}%)`}`);
  }
  if (r?.rating.now) {
    const d = direction(r.rating, "rating");
    bits.push(`rating ${d === "up" ? "up to" : d === "down" ? "down to" : "steady at"} ${r.rating.now.toFixed(1)}`);
  }
  if (c) bits.push(plural(c.signups.now, "new sign-up"));
  return `📊 *${verdict(r, c, sales)}*${bits.length ? `: ${bits.join(", ")}.` : "."}\nYour weekly report is ready: ${url}`;
}

function fallbackSentence(r: ReputationSection | undefined, c: CustomersSection | undefined) {
  const parts: string[] = [];
  if (r) parts.push(`${plural(r.newReviews.now, "new review")} and ${plural(r.answered.now, "reply", "replies")} posted`);
  if (c) parts.push(`${plural(c.signups.now, "new sign-up")} and ${plural(c.redemptions.now, "redemption")}`);
  return parts.length ? `${verdict(r, c)}: ${parts.join(", ")}.` : "A quiet week.";
}

const FALLBACK_ACTIONS: ActionsSection["actions"] = [
  { title: "Fill your quietest night", why: "An email offer is the quickest way to bring regulars in.", message: "Which night is quietest? Draft an email offer to fill it." },
  { title: "Post a dish on Google", why: "Regular posts keep your listing fresh.", message: "Draft a Google post about our Mixed Grill Platter" },
  { title: "Reply to any open reviews", why: "Answered reviews build trust with new customers.", message: "Which reviews still need a reply?" },
];

// ---------- Making and saving a report ----------

export type SavedReport = { id: string; token: string; headline: string; url: string; data: ReportData };

export async function createReport(ctx: RestaurantContext, period: Period): Promise<SavedReport> {
  const restaurant = ctx.restaurant;
  const rows = await loadRows(restaurant, period);
  const input: BuildInput = { restaurant, period, rows };

  const dataSections: ReportSection[] = [];
  const facts: string[] = [];
  for (const def of DATA_SECTIONS) {
    if (!def.connected(restaurant)) continue;
    const section = await def.build(input);
    if (!section) continue;
    dataSections.push(section);
    facts.push(def.facts(section));
  }
  const reputation = dataSections.find((s): s is ReputationSection => s.id === "reputation");
  const customers = dataSections.find((s): s is CustomersSection => s.id === "customers");
  const sales = dataSections.find((s): s is SalesSection => s.id === "sales");

  // The words come from Claude; if that fails, the report still goes out with plain-code ones.
  const reviewTexts = rows.reviews
    .filter((r) => r.text && new Date(r.review_date) < period.end && new Date(r.review_date) >= new Date(period.end.getTime() - 30 * DAY))
    .slice(0, 25)
    .map((r) => `${r.rating}★ ${r.text}`);
  let insights: Awaited<ReturnType<typeof writeReportInsights>> | null = null;
  try {
    insights = await writeReportInsights(ctx, facts.join("\n"), reviewTexts);
  } catch (err) {
    console.error("Report insights failed; using plain summaries", err);
  }
  if (reputation && insights) {
    reputation.praise = insights.praise;
    reputation.complaints = insights.complaints;
  }

  const headline: HeadlineSection = {
    id: "headline",
    sentence: insights?.sentence || fallbackSentence(reputation, customers),
    stats: [
      ...(sales ? [{ label: "Net sales", value: sales.net, format: "money" as const }] : []),
      ...(reputation ? [{ label: "Google rating", value: reputation.rating, format: "rating" as const }] : []),
      ...(customers
        ? [
            { label: "New sign-ups", value: customers.signups, format: "count" as const },
            { label: "Rewards & offers redeemed", value: customers.redemptions, format: "count" as const },
          ]
        : []),
    ].slice(0, 3),
  };
  const actions: ActionsSection = {
    id: "actions",
    actions: [...(insights?.actions ?? []), ...FALLBACK_ACTIONS].slice(0, 3),
  };

  const data: ReportData = {
    version: 1,
    restaurant: { name: restaurant.name, tagline: restaurant.tagline, brandColor: restaurant.brand_color, brandDark: restaurant.brand_dark },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      label: rangeLabel(period.start, period.end),
      prevLabel: rangeLabel(period.prevStart, period.start),
    },
    googleMode: google().mode,
    whatsappNumber: restaurant.whatsapp_from?.replace(/\D/g, "") || null,
    sections: [headline, ...dataSections, actions],
  };

  const token = newToken();
  const url = `${appUrl()}/report/${token}`;
  const text = whatsappHeadline(data, url);
  const row = checkRow(
    await getSupabase()
      .from("reports")
      .insert({
        restaurant_id: restaurant.id,
        token,
        period_start: period.start.toISOString(),
        period_end: period.end.toISOString(),
        expires_at: new Date(Date.now() + REPORT_LINK_DAYS * DAY).toISOString(),
        headline: text,
        data,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  return { id: row.id, token, headline: text, url, data };
}

export async function getReportByToken(token: string) {
  return check(
    await getSupabase()
      .from("reports")
      .select("token, restaurant_id, data, created_at, expires_at")
      .eq("token", token)
      .maybeSingle<{ token: string; restaurant_id: string; data: ReportData; created_at: string; expires_at: string | null }>(),
  );
}
