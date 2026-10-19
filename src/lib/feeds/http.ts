import "server-only";
import { getSupabase } from "@/lib/supabase";

// Fetching for the feeds: a time limit, one polite wait when a provider says
// "too many requests", and an optional copy in cached_data so a retry (or a
// second restaurant asking for the same thing) doesn't call the provider again.
// API keys are passed in the URL or headers by the caller and never stored:
// the cache key is chosen by the caller.

export class FeedHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FeedHttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The address without its key, for error messages and logs.
export const safeUrl = (url: string) => url.replace(/(apikey|app_key|key)=[^&]+/gi, "$1=…");

export async function getJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; cacheKey?: string; maxAgeMs?: number } = {},
): Promise<T> {
  const supabase = getSupabase();
  if (opts.cacheKey && opts.maxAgeMs) {
    const { data } = await supabase.from("cached_data").select("data, fetched_at").eq("key", opts.cacheKey).maybeSingle<{ data: T; fetched_at: string }>();
    if (data && Date.now() - new Date(data.fetched_at).getTime() < opts.maxAgeMs) return data.data;
  }
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, { headers: { Accept: "application/json", ...opts.headers }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    if (res.status !== 429 || attempt === 1) break;
    const wait = Math.min(30, Number(res.headers.get("retry-after")) || Number(res.headers.get("x-requestcounter-reset")) || 15);
    await sleep(wait * 1000);
  }
  if (!res!.ok) throw new FeedHttpError(`${new URL(url).hostname} ${res!.status} (${safeUrl(url).slice(0, 160)}): ${(await res!.text()).slice(0, 200)}`, res!.status);
  const json = (await res!.json()) as T;
  if (opts.cacheKey) {
    const { error } = await supabase.from("cached_data").upsert({ key: opts.cacheKey, data: json, fetched_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) console.error("Couldn't cache a feed answer", error.message);
  }
  return json;
}

export async function getText(url: string, timeoutMs = 60_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new FeedHttpError(`${new URL(url).hostname} ${res.status}`, res.status);
  return res.text();
}
