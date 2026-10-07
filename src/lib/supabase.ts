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
};

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

export type Review = {
  id: string;
  author_name: string;
  rating: number;
  text: string | null;
  review_date: string;
  replied: boolean;
};
