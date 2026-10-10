import "server-only";
import { createClient } from "@supabase/supabase-js";
import { LIVE_APP_URL } from "@/lib/hosts";
import { isTestMode } from "@/lib/test-mode";

// Server-side Supabase client. Uses the secret key, so it must never be
// imported into browser code ("server-only" makes the build fail if it is).
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// allergens are only shown to customers (or used in their messages) once confirmed.
export type MenuItem = { name: string; price: number; description: string | null; allergens?: string[]; allergens_confirmed?: boolean };
export type MenuCategory = { category: string; items: MenuItem[] };

export type Restaurant = {
  id: string;
  name: string;
  cuisine: string | null;
  address: string | null;
  phone: string | null;
  opening_hours: Record<string, string>;
  menu: MenuCategory[];
  brand_voice: string | null;
  // Safety-rule settings (added in step 4)
  discount_cap_percent: number;
  send_window_start: string; // "09:00:00"
  send_window_end: string; // "21:00:00"
  paused: boolean;
  paused_at: string | null;
  fake_now: string | null;
  owner_whatsapp: string | null;
  whatsapp_from: string | null;
  // Customer sign-up page (added in step 5)
  slug: string | null;
  signup_reward: string | null;
  brand_color: string;
  brand_dark: string;
  tagline: string | null;
  // Email campaigns (added in step 6)
  owner_email: string | null;
  email_test_mode: boolean;
  last_birthday_campaign_on: string | null;
  // Google posts (added in step 7)
  last_post_draft_on: string | null;
  // Morning brief and Monday report (added in step 8)
  last_brief_on: string | null;
  last_brief_at: string | null;
  brief_waiting_since: string | null;
  last_report_on: string | null;
  // Morning job retries (added in step 9)
  morning_lock_until: string | null;
  morning_failures: number;
  morning_failed_on: string | null;
  // A demo restaurant: everything belonging to it is dummy data (step 10).
  is_demo: boolean;
  // Scheduled jobs only run for active restaurants (step 11).
  active: boolean;
  // Found or chosen during onboarding (step 12).
  owner_name: string | null;
  website: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  photos: string[];
  // Real customer email (step 13).
  logo_url: string | null;
  reply_to_email: string | null;
  feedback_emails: boolean;
  // Sales and weather (step 15).
  latitude: number | null;
  longitude: number | null;
  weather_backfilled_at: string | null;
  last_weather_on: string | null;
};

// The app's address, used for every link we make (emails, QR codes, rewards,
// reports, login links): the APP_URL setting (https://app.dinerai.co.uk on the live
// site). Without it: the app domain on the live site, the deployment's own address
// on a Vercel preview, localhost when running locally.
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return LIVE_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// The same address inside a web request. On the live site (or with APP_URL set) it's
// always appUrl(), so a visit through an old vercel.app link still makes app.dinerai.co.uk
// links. Otherwise (local, previews) it's whatever address the request came to.
export function baseUrlFrom(headers: Headers) {
  if (process.env.APP_URL || process.env.VERCEL_ENV === "production") return appUrl();
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// The clock the rules use: the fake test time if one is set (test mode only), otherwise now.
export function restaurantNow(restaurant: Pick<Restaurant, "fake_now">) {
  return restaurant.fake_now && isTestMode() ? new Date(restaurant.fake_now) : new Date();
}

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  visit_count: number;
  last_visit: string | null;
  marketing_opt_in: boolean;
  notes: string | null;
};

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  status: "received" | "sent" | "failed";
  error: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  author_name: string;
  rating: number;
  text: string | null;
  review_date: string;
  replied: boolean;
};
