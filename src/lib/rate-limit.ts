import "server-only";
import { createHash } from "node:crypto";
import { getSupabase } from "@/lib/supabase";

// Simple rate limits kept in the database (rate_limits table): each attempt is
// a row, and an action is refused once there are too many rows for its key in
// the window. Keys are hashed, so no raw IP address or email is stored.

export type Limit = { key: string; max: number; windowMs: number };

export function limitKey(...parts: string[]) {
  const salt = process.env.LINK_SECRET || process.env.CRON_SECRET || "naila";
  return createHash("sha256").update(`${salt}:${parts.join(":")}`).digest("base64url").slice(0, 32);
}

// The visitor's IP address (Vercel puts it first in x-forwarded-for).
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

// True if any limit is already used up. Otherwise records one attempt against each and returns false.
export async function overLimit(limits: Limit[], now = new Date()) {
  const supabase = getSupabase();
  for (const l of limits) {
    const since = new Date(now.getTime() - l.windowMs).toISOString();
    const { count, error } = await supabase.from("rate_limits").select("id", { count: "exact", head: true }).eq("key", l.key).gte("created_at", since);
    // If the check itself fails, let the person through rather than lock everyone out.
    if (error) {
      console.error("Rate limit check failed", error);
      return false;
    }
    if ((count ?? 0) >= l.max) return true;
  }
  const { error } = await supabase.from("rate_limits").insert(limits.map((l) => ({ key: l.key })));
  if (error) console.error("Couldn't record a rate-limit attempt", error);
  return false;
}

// Rows older than two days are never needed (the longest window is a day). Run hourly.
export async function clearOldRateLimits(now = new Date()) {
  const { error } = await getSupabase().from("rate_limits").delete().lt("created_at", new Date(now.getTime() - 2 * 86_400_000).toISOString());
  if (error) console.error("Couldn't clear old rate limits", error);
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
