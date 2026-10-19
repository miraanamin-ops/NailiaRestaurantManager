// A calendar row as a feed writes it (feed_upsert_calendar in
// supabase/041_outside_feeds.sql). external_source + external_id keep a re-run
// from adding it twice.
export type CalendarFeedRow = {
  external_source: string;
  external_id: string;
  restaurant_id?: string | null;
  day: string;
  end_day?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  name: string;
  type:
    | "bank_holiday" | "religious" | "cultural" | "school_holiday" | "inset_day" | "sport" | "football"
    | "local_event" | "disruption" | "payday" | "clock_change";
  scope?: "national" | "regional" | "council" | "local" | "restaurant" | null;
  region?: string | null;
  council_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  venue_id?: string | null;
  expected_size?: number | null;
  date_uncertain?: boolean;
  alt_day?: string | null;
  alt_probability?: number | null;
  authority?: string | null;
  notes?: string | null;
  source?: "feed" | "builder" | "owner_message" | "gov.uk";
  fetched_at?: string;
};

// A match: its calendar row plus the fixture (feed_upsert_fixtures).
export type FixtureFeedRow = CalendarFeedRow & {
  sport: "football" | "cricket";
  competition: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
};
