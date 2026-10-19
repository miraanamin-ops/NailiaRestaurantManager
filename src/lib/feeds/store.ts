import "server-only";
import { getSupabase } from "@/lib/supabase";
import type { CalendarFeedRow, FixtureFeedRow } from "./types";

// Writing feed rows. Calendar rows and fixtures go through the database's own
// functions (supabase/041_outside_feeds.sql), keyed by feed and external id, so
// a re-run never adds a row twice and a date the builder confirmed is kept.

const CHUNK = 200;

type Counts = { inserted: number; updated: number; kept: number };

async function inChunks<T>(rows: T[], fn: (part: T[]) => Promise<Counts>) {
  const total: Counts = { inserted: 0, updated: 0, kept: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const c = await fn(rows.slice(i, i + CHUNK));
    total.inserted += c.inserted;
    total.updated += c.updated;
    total.kept += c.kept;
  }
  return total;
}

async function rpcCounts(fn: string, rows: unknown[]): Promise<Counts> {
  const { data, error } = await getSupabase().rpc(fn, { p_rows: rows });
  if (error) throw new Error(`${fn}: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Partial<Counts> | null;
  return { inserted: Number(r?.inserted ?? 0), updated: Number(r?.updated ?? 0), kept: Number(r?.kept ?? 0) };
}

// Two rows with one key in a batch: the last one wins (a feed's answer can repeat a match).
const byKey = <T extends { external_source: string; external_id: string }>(rows: T[]) => [...new Map(rows.map((r) => [`${r.external_source}|${r.external_id}`, r])).values()];

export const upsertCalendar = (rows: CalendarFeedRow[]) => inChunks(byKey(rows), (part) => rpcCounts("feed_upsert_calendar", part));
export const upsertFixtures = (rows: FixtureFeedRow[]) => inChunks(byKey(rows), (part) => rpcCounts("feed_upsert_fixtures", part));

// Shared feed rows that are gone at the source (a postponed match, a cancelled event).
export async function removeFeedRows(externalSource: string, externalIds: string[]) {
  if (!externalIds.length) return 0;
  const { data, error } = await getSupabase()
    .from("local_calendar")
    .delete()
    .is("restaurant_id", null)
    .eq("external_source", externalSource)
    .in("external_id", externalIds)
    .is("confirmed_at", null)
    .select("id");
  if (error) throw new Error(`remove feed rows: ${error.message}`);
  return data?.length ?? 0;
}

// The calendar row ids of some feed rows (for calendar_relevance).
export async function calendarIds(externalSource: string, externalIds: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const { data, error } = await getSupabase()
      .from("local_calendar")
      .select("id, external_id")
      .is("restaurant_id", null)
      .eq("external_source", externalSource)
      .in("external_id", externalIds.slice(i, i + CHUNK))
      .returns<{ id: string; external_id: string }[]>();
    if (error) throw new Error(`calendar ids: ${error.message}`);
    for (const r of data ?? []) out.set(r.external_id, r.id);
  }
  return out;
}

// How near each event is to a restaurant. The builder's say (relevant, marked_by) is never overwritten.
export async function saveRelevance(restaurantId: string, rows: { event_id: string; distance_m: number }[]) {
  if (!rows.length) return 0;
  const computed_at = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await getSupabase()
      .from("calendar_relevance")
      .upsert(
        rows.slice(i, i + 500).map((r) => ({ restaurant_id: restaurantId, event_id: r.event_id, distance_m: r.distance_m, computed_at, source: "model" })),
        { onConflict: "restaurant_id,event_id" },
      );
    if (error) throw new Error(`calendar relevance: ${error.message}`);
  }
  return rows.length;
}

// Forecasts as issued: added, never changed (an issue already saved is skipped).
export async function insertForecasts(rows: Record<string, unknown>[]) {
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await getSupabase().rpc("feed_insert_forecasts", { p_rows: rows.slice(i, i + 500) });
    if (error) throw new Error(`weather forecasts: ${error.message}`);
    added += Number(data ?? 0);
  }
  return added;
}
