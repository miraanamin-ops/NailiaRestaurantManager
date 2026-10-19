// Which shared calendar rows apply to a restaurant: the same rule as the
// analytics.calendar view (supabase/041_outside_feeds.sql), for app
// code that reads the calendar directly (Growth's calendar). Pure; the two are
// checked against each other in tests/outside-feeds-schema.test.ts.
//   own rows     always
//   national     everyone (a row with an authority only for restaurants following it)
//   regional     its nation, or London for a London borough (ONS code E09...)
//   council      its council
//   local        nearby: a calendar_relevance row not marked "not relevant"

export type ScopedRow = {
  id: string;
  restaurant_id: string | null;
  scope?: string | null;
  region?: string | null;
  council_code?: string | null;
  authority?: string | null;
};
export type ScopeRestaurant = { id: string; nation?: string | null; council_code?: string | null; religious_authority?: string | null };

export function calendarApplies(row: ScopedRow, r: ScopeRestaurant, nearby: Set<string>) {
  if (row.restaurant_id) return row.restaurant_id === r.id;
  const scope = row.scope ?? "national";
  if (scope === "national") return !row.authority || row.authority === (r.religious_authority ?? "east-london-mosque");
  if (scope === "regional") {
    const region = (row.region ?? "").toLowerCase();
    return region === (r.nation ?? "england").toLowerCase() || (region === "london" && (r.council_code ?? "").startsWith("E09"));
  }
  if (scope === "council") return Boolean(row.council_code) && row.council_code === r.council_code;
  if (scope === "local") return nearby.has(row.id);
  return false;
}
