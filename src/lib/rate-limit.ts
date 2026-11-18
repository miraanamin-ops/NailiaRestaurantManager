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

// Records this attempt against each limit first, then counts: true if any limit
// is now over its max. Recording before counting means two requests arriving at
// the same moment both see each other, so they can't both slip under the limit.
// A refused attempt still counts (repeated hammering keeps the window full).
export async function overLimit(limits: Limit[], now = new Date()) {
  await recordAttempt(limits);
  return countsOver(limits, now, (count, max) => count > max);
}

// True if any limit is already used up; records nothing. For actions that only
// count once we know what they cost (pair with recordAttempt).
export async function limitReached(limits: Limit[], now = new Date()) {
  return countsOver(limits, now, (count, max) => count >= max);
}

async function countsOver(limits: Limit[], now: Date, over: (count: number, max: number) => boolean) {
  const supabase = getSupabase();
  for (const l of limits) {
    const since = new Date(now.getTime() - l.windowMs).toISOString();
    const { count, error } = await supabase.from("rate_limits").select("id", { count: "exact", head: true }).eq("key", l.key).gte("created_at", since);
    // If the check itself fails, let the person through rather than lock everyone out.
    if (error) {
      console.error("Rate limit check failed", error);
      return false;
    }
    if (over(count ?? 0, l.max)) return true;
  }
  return false;
}

export async function recordAttempt(limits: Limit[]) {
  const { error } = await getSupabase().from("rate_limits").insert(limits.map((l) => ({ key: l.key })));
  if (error) console.error("Couldn't record a rate-limit attempt", error);
}

// Rows older than two days are never needed (the longest window is a day). Run hourly.
export async function clearOldRateLimits(now = new Date()) {
  const { error } = await getSupabase().from("rate_limits").delete().lt("created_at", new Date(now.getTime() - 2 * 86_400_000).toISOString());
  if (error) console.error("Couldn't clear old rate limits", error);
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
