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

**Dev project only.** `supabase/seed/test-kitchen.sql`, after `043_pilot_rota.sql` (paste into the dev project's Supabase > SQL Editor). It refuses any database not marked as the dev project (its description starts "dinerai-dev", set by `analytics/generator/apply_migrations.py`), so it can never run on the live database. Id `7e57c0de-0000-4000-8000-000000000000`, slug `test-kitchen`, `is_demo`, **not active** (scheduled jobs skip it until switched on and a WhatsApp number is linked). Google stays in dummy mode (4 dummy reviews; nothing reaches Google). 12 months of daily and hourly sales up to yesterday (Fri and Sat busiest, the same pattern as the dummy forecast), 8 staff (4 kitchen, 3 front of house, 1 both) with pay, hours caps and availability, and the two rota rules. Safe to run again; refuses if its id or slug belongs to any other restaurant. Remove with `delete from restaurants where id = '7e57c0de-0000-4000-8000-000000000000' and is_demo;`.

## Rota suggester (prompt 2, 26 Oct)

A basic weekly rota, not an optimiser. Built on `getRotaInputs` and `getWeekAhead`; migration `045_rota_suggester.sql` (rollback in `supabase/rollback/rota_suggester_rollback.sql`).

- **Team**: `/staff` (logged in; "Team" in the menu) or WhatsApp: `add Ali, kitchen, £13, weekdays` (also `Fri-Sun`, `5pm-11pm`, `evenings`, `max 20 hours`, `manager/front`; adding the same name again changes them), `remove Ali from the team`, `TEAM`. Pay is a new `staff_pay_rates` row from today; availability replaces the pattern from today (`staff_availability`).
- **Rules** (per restaurant, `/staff`): `rota_rules` per role (defaults in `lib/rota/rules.ts`: kitchen 1 + 1 per 12 orders an hour, front of house 1 + 1 per 15, delivery 0 + 1 per 10, manager 0; a default only applies to a role someone on the team has) and `restaurants.rota_settings` (shifts 4 to 10 hours, flag over 48 hours a week, flag under 11 hours' rest).
- **When**: Thursday from 10am UK, the hourly job queues `rota_week` for each active restaurant with a WhatsApp number (once a week: a week that already has a draft is left alone). `RUN ROTA` (test tools) does it now, from scratch. `ROTA` shows where next week's is up to.
- **Fill** (`lib/rota/fill.ts`): busiest forecast day first; for each role and each half hour short of people, the cheapest person who has the role, is free for the shift, isn't already on that day and stays within their cap, 48 hours and 11 hours' rest. Someone who worked that weekday in 2+ of the last 8 weeks of approved rotas counts as 50p an hour cheaper (the history). Part shifts (at least the minimum) when nobody can do all of it; what's left becomes open shifts.
- **Basis**: with 8+ weeks of sales (`sales_days`, first day to today) and an hourly forecast, staffed to forecast orders; otherwise opening hours and minimums only, and the draft says so.
- **Money**: hours x hourly rate to the penny, per shift, day and week; open shifts at the role's average rate; labour % of forecast sales (`sales_mid`, before VAT) per day and for the week (over days with a forecast).
- **WhatsApp**: who's on each day (plain message), then the card with Approve / Edit / Skip. Typed edits while it's on screen, or after Edit: `Ali can't do Friday`, `swap Sara and Bilal on Sunday`, `Mo can do Sunday 5pm-11pm`, `give Priya the weekend off`, `take Ali off the rota on Wednesday`. Plain code reads them; after Edit, Claude reads what plain code can't (first names only). Each edit re-runs the whole fill with all the week's edits (`rota_weeks.adjustments`) and resends.
- **Approve**: `rota_weeks.status = published`, an 18-byte random link `/rota/<token>` (public, read-only, who works when, no pay) and `/rota/<token>/pdf` (A4 landscape), sent on WhatsApp as a document to forward. UNDO switches the link off again (back to a draft); UNDO after an edit puts the earlier edits back.
- **Test Kitchen**: the seed now has 4 weeks of past approved rotas (the usual pattern), so the history counts. Run `045` then the seed again on dev.

## Tests

`tests/pilot-contracts.test.ts` (the three functions, real and dummy paths, and the registry) and `tests/pilot-schema.test.ts` (043, its rollback and the seed on the full migration chain in PGlite, including its refusal without the dev mark). `tests/seed-guards.test.ts`: every `scripts/seed-*.mjs` stops with live settings. Rota suggester: `tests/rota-fill.test.ts` (the fill, swaps, cost maths, flags, wording, Test Kitchen's dummy week), `tests/rota-edits.test.ts` (edits, staff commands, rules), `tests/rota-flow.test.ts` (team, draft, edits, approve, link, PDF, UNDO, under 8 weeks, on the in-memory database), `tests/rota-wiring.test.ts` (commands, the Thursday job, UNDO plans, logins, 045 and its rollback).

## Notes for later

- `tests/queue.test.ts` failed to start once (25 Oct) during a full run while the machine was busy, then passed on its own and in a rerun. It builds a whole database in PGlite before its tests, so it's probably a slow start, not a bug. Look at it only if it fails again.
