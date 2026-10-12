import "server-only";
import { getSupabase } from "@/lib/supabase";
import { holidaysAhead, type BankHoliday } from "./bank-holiday-rules";

// UK bank holidays (England and Wales) from gov.uk, cached in the database for a
// week so the Monday check doesn't call gov.uk for every restaurant. If gov.uk
// can't be reached, the last saved list is used; if there's none, no flags.

const SOURCE = "https://www.gov.uk/bank-holidays.json";
const CACHE_KEY = "uk_bank_holidays";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Cached = { data: BankHoliday[]; fetched_at: string };

async function fromGovUk(): Promise<BankHoliday[]> {
  const res = await fetch(SOURCE, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`gov.uk bank holidays: ${res.status}`);
  const json = (await res.json()) as { "england-and-wales"?: { events?: { title: string; date: string }[] } };
  const events = json["england-and-wales"]?.events ?? [];
  if (!events.length) throw new Error("gov.uk bank holidays: no events for England and Wales");
  return events.map((e) => ({ date: e.date, title: e.title }));
}

export async function bankHolidays(now = new Date()): Promise<BankHoliday[]> {
  const supabase = getSupabase();
  const { data: cached } = await supabase.from("cached_data").select("data, fetched_at").eq("key", CACHE_KEY).maybeSingle<Cached>();
  if (cached && now.getTime() - new Date(cached.fetched_at).getTime() < MAX_AGE_MS) return cached.data;
  try {
    const fresh = await fromGovUk();
    const { error } = await supabase.from("cached_data").upsert({ key: CACHE_KEY, data: fresh, fetched_at: now.toISOString() }, { onConflict: "key" });
    if (error) console.error("Couldn't save the bank holidays", error);
    return fresh;
  } catch (err) {
    console.error("Couldn't fetch the bank holidays", err);
    return cached?.data ?? [];
  }
}

// The bank holidays in the next 4 weeks with no special hours set.
export async function unsetHolidaysAhead(specialHours: Record<string, unknown> | null, today: string) {
  return holidaysAhead(await bankHolidays(), specialHours, today);
}
