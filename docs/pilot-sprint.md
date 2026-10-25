# Pilot sprint: shared contracts

Written 25 Oct 2026. The pilot features (rota, forecast in use, calendar, brief and report sections) all build against these four contracts, so they can be built one prompt at a time without touching each other. Nothing here is a feature yet: these are the shapes, the tables, and stubs that return typed data.

The one rule for all three data functions: **real data first**. Dummy data (marked `source: "dummy"`) only fills a gap, only for a demo restaurant (`is_demo`), and only while TEST_TOOLS (or the old TEST_MODE) is on. A real restaurant never gets dummy data, whatever the switches say (`src/lib/dummy-data.ts`).

## 1. Rota

Tables. Most already existed (032); 043 adds the two missing pieces.

| Contract name | Table | Fields used |
|---|---|---|
| staff | `staff` (032) | `display_name`, `roles` (e.g. `kitchen`, `front`), `max_hours_week` (**new, 043**), `employment_start`/`end` |
| hourly_rate | `staff_pay_rates` (032) | `hourly_pence`, from `effective_from` (a new rate is a new row) |
| availability by weekday | `staff_availability` (032) | `weekday` (Monday = 1), `starts`, `ends`, `kind` available/preferred/unavailable |
| rota_rules | `rota_rules` (**new, 043**) | `role`, `min_on_shift`, `orders_per_extra_staff` (one per restaurant per role) |
| rotas | `rota_weeks` (032) | one per restaurant per week (`week_start` a Monday), `status` draft/approved/published |
| rota_shifts | `rota_shifts` (032) | `staff_id` (empty = open shift), `role`, `business_date`, `starts_at`/`ends_at` (UTC), `break_minutes` |

`rotas` is the existing `rota_weeks` table: renaming it would break the analytics service and the generator, which already use it.

Read with `getRotaInputs(restaurantId, weekStart)` in `src/lib/rota/inputs.ts`:

```ts
type RotaInputs = { restaurantId; weekStart; source: "tables" | "dummy"; staff: RotaStaff[]; rules: RotaRule[] };
type RotaStaff = { id; name; roles: string[]; hourly_rate_pence: number | null; max_hours_week: number | null;
                   availability: Record<1..7, { starts: "HH:MM"; ends: "HH:MM" }[]> };
type RotaRule  = { role; min_on_shift: number; orders_per_extra_staff: number | null };
```

Staff employed at any point that week; pay and availability as in force on the Monday. Dummy: `DUMMY_STAFF` / `DUMMY_RULES` in `src/lib/rota/types.ts` (the same 8 people as Test Kitchen).

## 2. Forecast: `getWeekAhead(restaurantId, weekStart)`

`src/lib/forecast/week-ahead.ts`; types and dummy data in `week-ahead-rules.ts`.

```ts
type WeekAhead = { restaurantId; weekStart; source: "forecast" | "dummy" | "none"; unvalidated: boolean; days: DayAhead[] }; // always 7
type DayAhead  = { date; weekday; orders: number | null;                       // likely orders, whole
                   sales_low; sales_mid; sales_high: number | null;            // pence, before VAT
                   orders_by_hour: { hour: number; orders: number }[] };       // London hour; empty past 14 days
```

Built on the nightly forecast through `loadForecast` (the same run the 9am brief uses: the 07:00 refresh for days 0 to 2, the 05:35 run for the rest, only runs that passed, unless the builder's demo override is on, then `unvalidated: true`). Hourly orders come from the same run (or the 05:35 run a refresh was based on), through `forecastHoursFromRun` in `lib/ops/models.ts`, still the only place the app reads model outputs. Days before today are null. `weekStart` must be a Monday.

## 3. Calendar: `getUpcomingEvents(restaurantId, from, to)`

`src/lib/upcoming-events.ts`; types, effects and dummy data in `upcoming-events-rules.ts`.

```ts
type UpcomingEvent = { date; title; type: CalendarType | "restaurant"; expected_effect: "busier" | "quieter" | "neutral";
                       source: "gov.uk" | "builder" | "feed" | "owner" | "dummy" };
```

From the local calendar that applies to the restaurant (`calendarFor`: bank holidays, religious dates, school holidays, sport, local events) plus the restaurant's own events (`restaurant_events`: closures, offers...), one entry per day, soonest first, `from` and `to` inclusive. `expected_effect` is a first guess from the kind of date (`expectedEffect`): bank holidays, sport, local events, Eid and similar are busier; Ramadan and closures are quieter; the rest neutral. The forecast's own reasons are the real measure.

## 4. Brief and report sections: the registry

`src/lib/sections/`. A feature adds itself without editing the brief, the report, or any other feature:

1. Write its definition in its own file (a `BriefSectionDef`, a `ReportSectionDef`, or both; types in `sections/types.ts`).
2. Add one line to `BRIEF_SECTIONS` or `REPORT_SECTIONS` in `sections/index.ts`.

```ts
type BriefSectionDef  = { id; order; block({ restaurant, now }): Promise<string | null> };
type ReportSectionDef = { id; order; build({ restaurant, period }): Promise<{ title; stats (max 3); lines; footnote? } | null>;
                          facts?(section): string };
```

- **Brief**: blocks appear after the forecast, in `order`, word for word, in both briefs (today's and the GM's; the GM's composer never sees or rewords them). A block counts as something to send, so a brief can go out with just a block.
- **Report**: each section is saved as `{ id: "feature", key: <def id>, ... }` and drawn by one shared renderer on the web page and in the PDF. Its `facts` go to the AI that writes the headline and 3 actions.
- A block or section that throws is left out, the rest still go, and the builder is alerted (never the owner).

## Test Kitchen (demo restaurant)

`supabase/seed/test-kitchen.sql`, after `043_pilot_rota.sql` (paste into Supabase > SQL Editor). Id `7e57c0de-0000-4000-8000-000000000000`, slug `test-kitchen`, `is_demo`, **not active** (scheduled jobs skip it until switched on and a WhatsApp number is linked). Google stays in dummy mode (4 dummy reviews; nothing reaches Google). 12 months of daily and hourly sales up to yesterday (Fri and Sat busiest, the same pattern as the dummy forecast), 8 staff (4 kitchen, 3 front of house, 1 both) with pay, hours caps and availability, and the two rota rules. Safe to run again; refuses if its id or slug belongs to any other restaurant. Remove with `delete from restaurants where id = '7e57c0de-0000-4000-8000-000000000000' and is_demo;`.

## Tests

`tests/pilot-contracts.test.ts` (the three functions, real and dummy paths, and the registry) and `tests/pilot-schema.test.ts` (043, its rollback and the seed on the full migration chain in PGlite).
