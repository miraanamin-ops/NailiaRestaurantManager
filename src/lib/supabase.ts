import "server-only";
import { createClient } from "@supabase/supabase-js";

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

export type MenuItem = { name: string; price: number; description: string | null };
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
};

// The live site's address, for links in emails and WhatsApp messages sent
// outside a web request. Vercel sets VERCEL_PROJECT_PRODUCTION_URL itself.
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// The site's public address, from the incoming request (works locally and on Vercel).
export function baseUrlFrom(headers: Headers) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// The clock the rules use: the fake test time if one is set, otherwise now.
export function restaurantNow(restaurant: Pick<Restaurant, "fake_now">) {
  return restaurant.fake_now ? new Date(restaurant.fake_now) : new Date();
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
