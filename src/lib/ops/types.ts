// Row types for the operations tables (supabase/030 to 037; docs/data-model.md).
// Money is whole pence; quantities are in the ingredient's unit; timestamps are
// ISO strings in UTC; days are London "YYYY-MM-DD".
import type { ModelRole } from "./model-roles";

export type { ModelRole };

// Where a row came from (the ops_source list in 030_ops_foundation.sql).
export const OPS_SOURCES = ["photo", "export", "manual", "owner_message", "assumed", "feed", "synthetic", "model", "migrated", "builder"] as const;
export type OpsSource = (typeof OPS_SOURCES)[number];

type Base = { id: string; restaurant_id: string; created_at: string };
type Confirmable = { confirmed_at: string | null; confirmed_by: string | null };

// 1. Menu and recipes
export type MenuSectionRow = Base & {
  name: string;
  position: number;
  json_keys: string[];
  extra: Record<string, unknown>;
  active_from: string;
  active_to: string | null;
  source: OpsSource;
  updated_at: string;
};
export type DishRow = Base & {
  section_id: string;
  name: string;
  description: string | null;
  allergens: string[];
  allergens_confirmed: boolean;
  position: number;
  json_keys: string[];
  extra: Record<string, unknown>;
  active_from: string;
  active_to: string | null;
  source: OpsSource;
  updated_at: string;
};
export type DishPriceRow = Base & { dish_id: string; price_pence: number | null; effective_from: string; recorded_at: string; source: OpsSource };
export type DishRenameRow = { id: string; restaurant_id: string; dish_id: string; old_name: string; new_name: string; renamed_at: string; source: OpsSource };
export type StdUnit = "g" | "ml" | "each";
export type IngredientRow = Base & Confirmable & { name: string; unit: StdUnit; category: string | null; active: boolean; source: OpsSource };
export type RecipeVersionRow = Base & Confirmable & {
  dish_id: string;
  effective_from: string;
  recorded_at: string;
  portions: number;
  notes: string | null;
  source: OpsSource;
};
export type RecipeLineRow = Base & { recipe_version_id: string; ingredient_id: string; quantity: number; waste_pct: number; position: number };
export type MatchMethod = "exact" | "fuzzy" | "ai" | "owner";
export type TillItemMatchRow = Base & Confirmable & {
  till_name: string;
  till_key: string;
  dish_id: string | null;
  is_dish: boolean;
  confidence: number | null;
  method: MatchMethod;
  source: OpsSource;
  updated_at: string;
};

// 2. Sales detail
export type Channel = "dine_in" | "takeaway" | "delivery";
export type SalesChannelSplitRow = Base & Confirmable & {
  day: string;
  hour: number | null;
  channel: Channel;
  sales_pence: number;
  includes_vat: boolean;
  orders: number | null;
  covers: number | null;
  source: OpsSource;
};

// 3. Staff
export type AgeBand = "under_18" | "18_20" | "21_plus" | "apprentice";
export type StaffRow = Base & Confirmable & {
  display_name: string;
  roles: string[];
  skills: string[];
  contracted_hours: number | null;
  max_hours_week: number | null; // 043: the most hours a week they want (or may) work
  employment_start: string | null;
  employment_end: string | null;
  age_band: AgeBand | null;
  age_band_set_on: string | null;
  staff_number_id: string | null;
  source: OpsSource;
  deleted_at: string | null;
  updated_at: string;
};
export type StaffPayRateRow = Base & Confirmable & { staff_id: string; hourly_pence: number; effective_from: string; recorded_at: string; source: OpsSource };
export type StaffAvailabilityRow = Base & {
  staff_id: string;
  weekday: number; // Monday = 1
  starts: string; // "17:00:00"
  ends: string;
  kind: "available" | "unavailable" | "preferred";
  effective_from: string;
  effective_to: string | null;
  source: OpsSource;
};
export type StaffTimeOffRow = Base & {
  staff_id: string;
  starts_at: string;
  ends_at: string;
  kind: "holiday" | "sick" | "unavailable" | "extra_available";
  status: "requested" | "approved" | "declined" | "cancelled";
  source: OpsSource;
};
export type CoverRuleRow = Base & {
  role: string;
  weekday: number | null;
  starts: string;
  ends: string;
  min_staff: number;
  covers_per_staff: number | null;
  effective_from: string;
  effective_to: string | null;
  source: OpsSource;
};
// 043: per role, the fewest people on any shift, plus one more per so many forecast orders an hour.
export type RotaRuleRow = Base & {
  role: string;
  min_on_shift: number;
  orders_per_extra_staff: number | null;
  source: OpsSource;
  updated_at: string;
};

// 4. Rotas
export type RotaStatus = "draft" | "approved" | "published";
export type RotaWeekRow = Base & {
  week_start: string;
  status: RotaStatus;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  source: OpsSource;
  updated_at: string;
};
export type RotaShiftRow = Base & {
  rota_week_id: string;
  staff_id: string | null;
  role: string;
  business_date: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  notes: string | null;
  source: OpsSource;
  updated_at: string;
};
export type ShiftActualRow = Base & Confirmable & {
  staff_id: string | null;
  rota_shift_id: string | null;
  role: string | null;
  business_date: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  source: OpsSource; // photo (rota photo), export (rota app), manual, assumed (as planned)
};

// 5. Costs
export type SupplierRow = Base & { name: string; category: string | null; notes: string | null; source: OpsSource };
export type InvoiceRow = Base & Confirmable & {
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  net_pence: number | null;
  vat_pence: number | null;
  gross_pence: number | null;
  photo_path: string | null;
  media_type: string | null;
  read: unknown;
  status: "needs_confirm" | "saved" | "discarded" | "unreadable";
  source: OpsSource;
};
export type InvoiceLineRow = Base & Confirmable & {
  invoice_id: string;
  position: number;
  description: string;
  quantity: number | null;
  unit_text: string | null;
  quantity_std: number | null;
  line_net_pence: number | null;
  vat_pence: number | null;
  ingredient_id: string | null;
  match_confidence: number | null;
  match_method: MatchMethod | null;
};
export type IngredientPriceRow = Base & Confirmable & {
  ingredient_id: string;
  price_pence: number;
  pack_quantity: number;
  effective_from: string;
  recorded_at: string;
  supplier_id: string | null;
  invoice_line_id: string | null;
  source: OpsSource;
};
export type FixedCostCategory = "rent" | "business_rates" | "utilities" | "insurance" | "loan" | "subscriptions" | "salaries" | "other";
export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly" | "one_off";
export type FixedCostRow = Base & Confirmable & {
  name: string;
  category: FixedCostCategory;
  amount_pence: number;
  frequency: Frequency;
  effective_from: string;
  effective_to: string | null;
  recorded_at: string;
  notes: string | null;
  source: OpsSource;
};
export type TargetMetric = "labour_pct" | "food_cost_pct" | "prime_cost_pct" | "weekly_sales_pence" | "daily_sales_pence";
export type TargetRow = Base & { metric: TargetMetric; value: number; effective_from: string; recorded_at: string; source: OpsSource };

// 6. Deals
export type DealOutcomeRow = Base & {
  campaign_id: string | null;
  restaurant_event_id: string | null;
  kind: "expected" | "measured";
  uplift_pence: number | null;
  uplift_pct: number | null;
  extra_covers: number | null;
  window_start: string | null;
  window_end: string | null;
  method: string;
  model_run_id: string | null;
  notes: string | null;
  recorded_at: string;
  source: OpsSource;
};

// 7. Model outputs
export type ModelKind = "forecast" | "rota" | "menu" | "finance" | "deal" | "other";
export type ModelRunRow = Base & {
  model_name: string;
  model_version: string;
  kind: ModelKind;
  role: ModelRole;
  status: "running" | "succeeded" | "failed" | "superseded";
  started_at: string;
  finished_at: string | null;
  data_from: string | null;
  data_to: string | null;
  data_cutoff: string | null;
  backtest_metric: string | null;
  backtest_score: number | null;
  passed: boolean | null;
  metrics: unknown;
  params: unknown;
  job_id: string | null;
  source: OpsSource;
};
export type ForecastMetric = "sales_pence" | "covers" | "orders";
export type ForecastRow = Base & {
  model_run_id: string;
  target_day: string;
  hour_start: string | null;
  local_hour: number | null;
  metric: ForecastMetric;
  channel: "all" | Channel;
  low: number;
  likely: number;
  high: number;
  issued_at: string;
};
export type SuggestedRotaRow = Base & {
  model_run_id: string;
  rota_week_id: string;
  total_cost_pence: number;
  labour_pct: number | null;
  forecast_sales_pence: number | null;
  notes: unknown;
  issued_at: string;
};
export type SuggestedRotaShiftRow = Base & {
  suggested_rota_id: string;
  staff_id: string | null;
  role: string;
  business_date: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  cost_pence: number | null;
};
export type MenuCategoryKind = "star" | "plowhorse" | "puzzle" | "dog";
export type MenuAnalysisRow = Base & {
  model_run_id: string;
  dish_id: string;
  period_start: string;
  period_end: string;
  units_sold: number | null;
  sales_pence: number | null;
  food_cost_pence: number | null;
  margin_pence: number | null;
  popularity_index: number | null;
  margin_index: number | null;
  category: MenuCategoryKind | null;
  suggestion: string | null;
  suggested_price_pence: number | null;
  issued_at: string;
};
export type FinanceSnapshotRow = Base & {
  model_run_id: string | null;
  week_start: string;
  sales_pence: number | null;
  labour_cost_pence: number | null;
  food_cost_pence: number | null;
  fixed_costs_pence: number | null;
  labour_pct: number | null;
  food_cost_pct: number | null;
  prime_cost_pct: number | null;
  lines: { line: string; pence: number }[];
  data_quality: unknown;
  issued_at: string;
};

// 8. Outside factors
export type WeatherHourRow = Base & {
  hour_start: string;
  temp: number | null;
  rain_mm: number | null;
  weather_code: number | null;
  cloud_pct: number | null;
  wind_kmh: number | null;
  provider: string;
  source: OpsSource;
  fetched_at: string;
};
export type WeatherForecastRow = Base & {
  issued_at: string;
  target_day: string | null;
  hour_start: string | null;
  temp_max: number | null;
  temp_min: number | null;
  temp: number | null;
  rain_mm: number | null;
  rain_chance: number | null;
  weather_code: number | null;
  provider: string;
  source: OpsSource;
};
export const CALENDAR_TYPES = [
  "bank_holiday", "religious", "cultural", "school_holiday", "inset_day", "sport", "football", "local_event", "disruption", "payday", "clock_change",
] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];
export type CalendarScope = "national" | "regional" | "council" | "local" | "restaurant";
export type CalendarEventRow = {
  id: string;
  restaurant_id: string | null; // empty = shared
  day: string; // first day
  end_day: string | null;
  starts_at: string | null;
  ends_at: string | null;
  name: string;
  type: CalendarType;
  scope: CalendarScope | null;
  region: string | null;
  council_code: string | null;
  latitude: number | null;
  longitude: number | null;
  venue_id: string | null;
  expected_size: number | null;
  date_uncertain: boolean;
  source: "builder" | "gov.uk" | "feed" | "manual" | "owner_message" | "synthetic";
  external_source: string | null;
  external_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type VenueRow = { id: string; name: string; kind: "stadium" | "arena" | "concert_hall" | "park" | "other"; latitude: number; longitude: number; capacity: number | null; teams: string[]; source: OpsSource; created_at: string };
export type FootballFixtureRow = { id: string; event_id: string; competition: string | null; home_team: string; away_team: string; kickoff_at: string; venue_id: string | null; external_source: string | null; external_id: string | null; source: OpsSource; created_at: string };
export type RestaurantTeamRow = Base & { team: string; why: string | null; source: OpsSource };
export type CalendarRelevanceRow = Base & {
  event_id: string;
  distance_m: number | null;
  relevant: boolean | null;
  marked_by: string | null;
  marked_at: string | null;
  computed_at: string | null;
  source: OpsSource;
};
export type PrayerTimesRow = Base & {
  day: string;
  fajr: string; // sehri ends
  sunrise: string | null;
  dhuhr: string;
  asr: string;
  maghrib: string; // iftar
  isha: string;
  method: string;
  source: OpsSource;
};

// 9. The restaurant's own events
export const RESTAURANT_EVENT_TYPES = ["closure", "partial_closure", "refit", "menu_change", "price_change", "promotion", "short_staffed", "other"] as const;
export type RestaurantEventType = (typeof RESTAURANT_EVENT_TYPES)[number];
export type RestaurantEventRow = Base & Confirmable & {
  type: RestaurantEventType;
  starts_at: string;
  ends_at: string | null;
  treat_as_unusual: boolean;
  campaign_id: string | null;
  notes: string | null;
  source: OpsSource;
  created_by: string | null;
  updated_at: string;
};
