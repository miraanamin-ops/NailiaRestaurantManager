// Restaurant-owned tables: every query on one must say which restaurant (or a
// specific row by id/token). tests/isolation.test.ts scans the code with this list;
// tests/ops-schema.test.ts checks every table with a restaurant_id column is on it.
export const OWNED_TABLES = [
  "customers", "reviews", "drafts", "campaigns", "campaign_sends", "sent_log", "audit_log", "reports", "google_posts", "rewards", "consents", "customer_events", "draft_feedback", "blocked_sends", "messages", "onboarding", "feedback", "feedback_requests", "z_reports", "sales_days", "sales_hours", "sales_items", "pos_layouts", "pos_imports", "weather_days", "staff_numbers", "agent_jobs", "jobs", "profile_versions", "shadow_drafts", "review_themes", "local_calendar",
  // Operations data (supabase/030 to 038)
  "menu_sections", "dishes", "dish_prices", "dish_renames", "ingredients", "recipe_versions", "recipe_lines", "till_item_matches", "menu_json_backup", "sales_channel_splits", "staff", "staff_pay_rates", "staff_availability", "staff_time_off", "cover_rules", "rota_weeks", "rota_shifts", "shift_actuals", "suppliers", "invoices", "invoice_lines", "ingredient_prices", "fixed_costs", "targets", "deal_outcomes", "model_runs", "forecasts", "suggested_rotas", "suggested_rota_shifts", "menu_analysis", "finance_snapshots", "weather_hours", "weather_forecasts", "restaurant_teams", "calendar_relevance", "prayer_times", "restaurant_events", "channel_fees",
];
