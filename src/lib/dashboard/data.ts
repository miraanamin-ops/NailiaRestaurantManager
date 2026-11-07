import "server-only";
import { waitingDrafts, doneTally } from "@/lib/brief";
import { recentCampaignStats } from "@/lib/campaigns";
import { londonYmd } from "@/lib/clock";
import { type Draft } from "@/lib/drafts";
import { draftPreviewUrl } from "@/lib/email/previews";
import { savedWeekAhead } from "@/lib/forecast/snapshot";
import { google } from "@/lib/google";
import { addDays } from "@/lib/sales/format";
import { getSupabase, type Restaurant, type Review } from "@/lib/supabase";
import { getUpcomingEvents } from "@/lib/upcoming-events";
import type { UpcomingEvent } from "@/lib/upcoming-events-rules";
import { birthdayOn, busyness, compare, decidableOnWeb, weatherWords, type Busyness, type Change } from "./rules";

// What the owner's home, approvals and customers pages show, for one restaurant.
// Every query is filtered by restaurant_id. Each piece fails on its own (logged,
// shown as "not available"), so one missing table never blanks the whole page.

const DAY_MS = 86_400_000;

async function safe<T>(label: string, p: Promise<T> | PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error(`Dashboard: ${label} failed`, err);
    return fallback;
  }
}

function rows<T>(res: { data: T[] | null; error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

function count(res: { count: number | null; error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

// ---------- Waiting for you ----------

export type WaitingItem = {
  draft: Draft;
  review: Pick<Review, "id" | "author_name" | "rating" | "text"> | null;
  campaignName: string | null;
  previewUrl: string | null;
  urgent: boolean;
  onWeb: boolean; // Approve / Skip here; otherwise answered on WhatsApp
};

export async function waitingItems(restaurantId: string): Promise<WaitingItem[]> {
  const drafts = await waitingDrafts(restaurantId);
  if (!drafts.length) return [];
  const reviewIds = new Set(drafts.map((d) => d.review_id).filter(Boolean));
  const campaignIds = drafts.filter((d) => d.kind === "email_campaign").map((d) => d.id);
  const [reviews, campaigns] = await Promise.all([
    reviewIds.size ? safe("reviews", google().listReviews(restaurantId), [] as Review[]) : Promise.resolve([] as Review[]),
    campaignIds.length
      ? safe(
          "campaign names",
          getSupabase().from("campaigns").select("draft_id, name").eq("restaurant_id", restaurantId).in("draft_id", campaignIds).then(rows<{ draft_id: string; name: string }>),
          [],
        )
      : Promise.resolve([] as { draft_id: string; name: string }[]),
  ]);
  const byReview = new Map(reviews.filter((r) => reviewIds.has(r.id)).map((r) => [r.id, r]));
  const names = new Map(campaigns.map((c) => [c.draft_id, c.name]));
  const items = drafts.map((d) => {
    const review = d.review_id ? (byReview.get(d.review_id) ?? null) : null;
    return {
      draft: d,
      review,
      campaignName: names.get(d.id) ?? null,
      previewUrl: draftPreviewUrl(d),
      urgent: Boolean(review && review.rating <= 3),
      onWeb: decidableOnWeb(d as Draft & { business_review_id?: string | null }),
    };
  });
  // Urgent first, then oldest first (as the brief numbers them).
  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

// ---------- This week vs last ----------

export type Week = {
  sales: { change: Change; daily: number[]; hasData: boolean; orders: Change | null };
  rating: { avg: number | null; change: Change | null; total: number; newThisWeek: number };
  customers: { total: number; newThisWeek: Change; notRedeemed: number };
  redeemed: Change;
};

async function weekNumbers(restaurantId: string, now: Date, reviews: Review[]): Promise<Week> {
  const supabase = getSupabase();
  const today = londonYmd(now);
  const from = addDays(today, -14);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const head = { count: "exact" as const, head: true };

  const [days, total, signupsNow, signupsBefore, rewardsNow, rewardsBefore, offersNow, offersBefore, notRedeemed] = await Promise.all([
    safe(
      "sales days",
      supabase
        .from("sales_days")
        .select("day, net_sales, transactions")
        .eq("restaurant_id", restaurantId)
        .gte("day", from)
        .lt("day", today)
        .order("day")
        .then(rows<{ day: string; net_sales: number | string; transactions: number | null }>),
      [],
    ),
    safe(
      "customers",
      supabase.from("customers").select("id", head).eq("restaurant_id", restaurantId).not("email_confirmed_at", "is", null).is("deleted_at", null).then(count),
      0,
    ),
    safe("sign-ups", supabase.from("customer_events").select("id", head).eq("restaurant_id", restaurantId).eq("type", "signup").gte("created_at", weekAgo).then(count), 0),
    safe(
      "sign-ups before",
      supabase.from("customer_events").select("id", head).eq("restaurant_id", restaurantId).eq("type", "signup").gte("created_at", twoWeeksAgo).lt("created_at", weekAgo).then(count),
      0,
    ),
    safe("rewards", supabase.from("rewards").select("id", head).eq("restaurant_id", restaurantId).gte("redeemed_at", weekAgo).then(count), 0),
    safe("rewards before", supabase.from("rewards").select("id", head).eq("restaurant_id", restaurantId).gte("redeemed_at", twoWeeksAgo).lt("redeemed_at", weekAgo).then(count), 0),
    safe("offers", supabase.from("campaign_sends").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "customer").gte("redeemed_at", weekAgo).then(count), 0),
    safe(
      "offers before",
      supabase.from("campaign_sends").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "customer").gte("redeemed_at", twoWeeksAgo).lt("redeemed_at", weekAgo).then(count),
      0,
    ),
    safe("unredeemed rewards", supabase.from("rewards").select("id", head).eq("restaurant_id", restaurantId).is("redeemed_at", null).then(count), 0),
  ]);

  const split = addDays(today, -7);
  const thisWeek = days.filter((d) => d.day >= split);
  const lastWeek = days.filter((d) => d.day < split);
  const sum = (ds: typeof days, f: (d: (typeof days)[number]) => number) => ds.reduce((s, d) => s + f(d), 0);
  const salesNow = sum(thisWeek, (d) => Number(d.net_sales) || 0);
  const salesBefore = sum(lastWeek, (d) => Number(d.net_sales) || 0);
  const hasOrders = thisWeek.some((d) => d.transactions !== null);

  const rated = reviews.filter((r) => r.rating);
  const avg = (rs: Review[]) => (rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : null);
  const older = rated.filter((r) => r.review_date < weekAgo);
  const avgNow = avg(rated);
  const avgBefore = avg(older);

  return {
    sales: {
      change: compare(Math.round(salesNow), Math.round(salesBefore)),
      daily: thisWeek.map((d) => Number(d.net_sales) || 0),
      hasData: thisWeek.length > 0,
      orders: hasOrders ? compare(sum(thisWeek, (d) => d.transactions ?? 0), sum(lastWeek, (d) => d.transactions ?? 0)) : null,
    },
    rating: {
      avg: avgNow,
      change: avgNow !== null && avgBefore !== null ? compare(avgNow, avgBefore) : null,
      total: rated.length,
      newThisWeek: rated.length - older.length,
    },
    customers: { total, newThisWeek: compare(signupsNow, signupsBefore), notRedeemed },
    redeemed: compare(rewardsNow + offersNow, rewardsBefore + offersBefore),
  };
}

// ---------- Today and the week ahead ----------

export type DayAhead = { date: string; orders: number | null; busy: Busyness; events: string[]; birthdays: number };
export type Today = { orders: number | null; salesPence: number | null; busy: Busyness; weather: { words: string | null; tempMax: number | null; rainChance: number | null } | null; events: string[] };

const monday = (ymd: string) => addDays(ymd, -((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7));

// withForecast: the week-ahead forecast can take a while the first time each day
// (it is worked out and saved), so the home page streams it in on its own.
export async function weekAhead(restaurantId: string, now: Date, withForecast = true) {
  const supabase = getSupabase();
  const today = londonYmd(now);
  const last = addDays(today, 6);
  const weeks = [...new Set([monday(today), monday(last)])];
  const [ahead, events, birthdays, weather] = await Promise.all([
    withForecast ? safe("week ahead", Promise.all(weeks.map((w) => savedWeekAhead(restaurantId, w, now))), []) : Promise.resolve([]),
    safe("events", getUpcomingEvents(restaurantId, today, last), [] as UpcomingEvent[]),
    safe(
      "birthdays",
      supabase
        .from("customers")
        .select("birthday")
        .eq("restaurant_id", restaurantId)
        .not("birthday", "is", null)
        .not("email_confirmed_at", "is", null)
        .is("deleted_at", null)
        .is("unsubscribed_at", null)
        .then(rows<{ birthday: string | null }>),
      [],
    ),
    safe(
      "weather",
      supabase
        .from("weather_forecasts")
        .select("temp_max, rain_chance, weather_code, issued_at")
        .eq("restaurant_id", restaurantId)
        .eq("target_day", today)
        .order("issued_at", { ascending: false })
        .limit(1)
        .then(rows<{ temp_max: number | string | null; rain_chance: number | null; weather_code: number | null }>),
      [],
    ),
  ]);
  const forecastDays = new Map(
    ahead
      .filter((w) => w.status === "ok" || w.status === "held_back")
      .flatMap((w) => w.days)
      .map((d) => [d.date, d]),
  );
  const days: DayAhead[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const f = forecastDays.get(date);
    return {
      date,
      orders: f?.orders ?? null,
      busy: busyness(f?.orders ?? null, f?.normal_orders ?? null),
      events: [...new Set(events.filter((e) => e.date === date).map((e) => e.title))].slice(0, 2),
      birthdays: birthdays.filter((b) => birthdayOn(b.birthday, date)).length,
    };
  });
  const w = weather[0];
  const todayRow = forecastDays.get(today);
  const todayInfo: Today = {
    orders: days[0].orders,
    salesPence: todayRow?.sales_mid ?? null,
    busy: days[0].busy,
    weather: w ? { words: weatherWords(w.weather_code), tempMax: w.temp_max === null ? null : Math.round(Number(w.temp_max)), rainChance: w.rain_chance } : null,
    events: days[0].events,
  };
  return { days, today: todayInfo, hasForecast: forecastDays.size > 0 };
}

// ---------- Setup checklist ----------

export type SetupItem = { label: string; done: boolean; href: string };

async function setupList(restaurant: Restaurant, hasSales: boolean): Promise<SetupItem[]> {
  // Set up with Dina: the same list as her setup (its open gaps), so the two never
  // disagree (7 Nov 2026), each opening the chat at that step.
  const dina = await safe("setup gaps", fromDinaGaps(restaurant), null);
  if (dina) return dina;
  const google = await safe(
    "google connection",
    getSupabase().from("google_connections").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).eq("kind", "owner").eq("status", "ok").then(count),
    0,
  );
  const unconfirmed = (restaurant.menu ?? []).flatMap((c) => c.items).filter((i) => (i.allergens?.length ?? 0) > 0 && !i.allergens_confirmed).length;
  const r = (p: string) => `${p}?r=${restaurant.id}`;
  return [
    { label: "Link your WhatsApp", done: Boolean(restaurant.owner_whatsapp), href: r("/onboarding") },
    { label: "Connect your Google profile", done: google > 0 || restaurant.is_demo, href: r("/settings/google") },
    { label: "Set a sign-up reward", done: Boolean(restaurant.signup_reward), href: r("/settings") },
    { label: unconfirmed ? `Confirm allergens for ${unconfirmed} dish${unconfirmed === 1 ? "" : "es"}` : "Confirm your allergens", done: unconfirmed === 0, href: r("/settings#menu") },
    { label: "Send your sales (till or spreadsheet)", done: hasSales, href: r("/sales") },
  ];
}

async function fromDinaGaps(restaurant: Restaurant): Promise<SetupItem[] | null> {
  const supabase = getSupabase();
  const { data: session } = await supabase.from("onboarding_sessions").select("restaurant_id").eq("restaurant_id", restaurant.id).maybeSingle();
  if (!session) return null;
  const { data: gaps } = await supabase.from("setup_gaps").select("step_key, resolved_at, dismissed").eq("restaurant_id", restaurant.id).returns<{ step_key: string; resolved_at: string | null; dismissed: boolean }[]>();
  const { gapTitle, EXTRA_GAPS, isFlowStep } = await import("@/lib/onboarding/flow");
  const chat = (step: string) => `/onboarding/chat?r=${restaurant.id}&step=${step}`;
  return [
    { label: "Link your WhatsApp", done: Boolean(restaurant.owner_whatsapp), href: `/onboarding/in?r=${restaurant.id}` },
    ...(gaps ?? []).map((g) => ({
      label: gapTitle(g.step_key),
      done: Boolean(g.resolved_at) || g.dismissed,
      href: chat(isFlowStep(g.step_key) ? g.step_key : (EXTRA_GAPS[g.step_key]?.step ?? "hello")),
    })),
  ];
}

// ---------- Everything for the home page ----------

export async function homeData(restaurant: Restaurant, now: Date) {
  const reviews = await safe("reviews", google().listReviews(restaurant.id), [] as Review[]);
  const [waiting, tally, week, ahead, campaigns] = await Promise.all([
    safe("waiting drafts", waitingItems(restaurant.id), [] as WaitingItem[]),
    safe("done tally", doneTally(restaurant.id, new Date(now.getTime() - 7 * DAY_MS), now), [] as string[]),
    weekNumbers(restaurant.id, now, reviews),
    weekAhead(restaurant.id, now, false),
    safe("campaigns", recentCampaignStats(restaurant.id, 1), []),
  ]);
  const setup = await setupList(restaurant, week.sales.hasData);
  const latestReviews = [...reviews].sort((a, b) => b.review_date.localeCompare(a.review_date)).slice(0, 3);
  return { waiting, tally, week, today: ahead.today, campaign: campaigns[0] ?? null, setup, latestReviews };
}

export type HomeData = Awaited<ReturnType<typeof homeData>>;
