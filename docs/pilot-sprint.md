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
type WeekAhead = { restaurantId; weekStart; source: "forecast" | "history" | "dummy" | "none";
                   status: "ok" | "not_enough_history" | "held_back" | "past"; show_ranges: boolean; unvalidated: boolean;
                   history_weeks; aov_pence; accuracy: { method; error_pct; range_hit_pct; weeks; limit_pct } | null; days: DayAhead[] }; // always 7
type DayAhead  = { date; weekday; orders; orders_low; orders_high: number | null;  // whole orders
                   normal_orders: number | null;                               // a normal day of that weekday (to see what moves it)
                   sales_low; sales_mid; sales_high: number | null;            // pence, before VAT: orders x average order value
                   orders_by_hour: { hour: number; orders: number }[] };       // London hour
```

Real data only (changed 27 Oct, see "Finance forecast and calendar" below): under 8 whole weeks of sales, no numbers (`not_enough_history`), never dummy ones. Otherwise each day comes from the nightly forecast through `loadForecast` where it has that day (the same run the 9am brief uses; `unvalidated: true` under the builder's demo override), else from the sales history (`lib/forecast/baseline.ts`). Sales are always the orders range x the average order value of the last 8 weeks. `show_ranges` is false (`held_back`) when the measured error is over the restaurant's limit: the numbers stay for the rota's staffing, but nothing shows them to the owner. Hourly orders: from the model run (through `forecastHoursFromRun` in `lib/ops/models.ts`, still the only place the app reads model outputs), else each hour's share of that weekday in the last 8 weeks of `sales_hours`. Days before today are null. `weekStart` must be a Monday. `dummyWeekAhead` is for tests only.

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

## Finance forecast and calendar (prompt 3, 27 Oct)

Migration `046_finance_calendar.sql` (rollback in `supabase/rollback/finance_calendar_rollback.sql`).

- **Forecast** (`lib/forecast/baseline.ts`, `week-ahead.ts`): the same weekday over the last 8 weeks (middle = likely, 10th to 90th percentile = the range, never narrower than ±10%), times an event effect learnt from the restaurant's own history (a kind of date seen on 2+ past days, typically 8%+ off a normal day); sales = orders x average order value. The nightly model's day wins where it has one.
- **Back-test**: the history method over the last 12 whole weeks, each week knowing only the sales before its Monday; WAPE on sales and how many days fell inside the range, saved once a day in `forecast_backtests`. Ranges show only at or under the limit: `restaurants.forecast_error_limit_pct` (the builder sets it on /log, under "Forecast in today's brief"; empty = 20%). Over it, the owner reads "Forecast held back: tested on your past weeks it was off by X% on average, over the Y% limit."
- **Labour** (`lib/finance/`): the week's rota, approved or published if there is one, else the draft; its own costs if the suggester made it, else shifts x each person's rate that day. As a % of forecast sales against `restaurants.labour_target_pct` (the owner texts `LABOUR TARGET 28%` or `LABOUR TARGET OFF`; UNDO works; STATUS shows it).
- **Brief** (registry, both brief paths): `finance` (Mondays: "💷 This week", sales range and labour vs target, or the upload line) and `calendar` (every day: the next 3 days; Mondays the whole week and the school-holiday note).
- **Calendar lines** (`lib/calendar-lines/`): an event shows only on a day the forecast moves 10%+ off a normal day of that weekday ("Sat: West Ham v Fulham, expect busier (+17%)"); Ramadan, Eid, bank holidays and school holidays always show. The owner's own events (closures, offers) never. A date over several days is one line. `getUpcomingEvents` now includes dates that started before the window and run into it (`end_day`), one entry per day.
- **School holidays**: the council comes from the postcode (postcodes.io, saved on the restaurant); covered = a `councils` row with term dates past today. Otherwise, on Mondays: "we don't have Tower Hamlets' term dates yet, so they aren't included here" (or "add your postcode").
- **Campaign ideas**: at most one a morning, for an event 3 to 7 days ahead, saved in `calendar_suggestions` (one per event, ever), sent after the brief with the "Draft an offer" / "Not now" buttons. The tap runs the usual campaign flow (Growth when live) with the idea's request, then the draft has its own Approve.
- **Report** (registry): `last_week` (replaces "How the forecast did"), `google_week` (replaces Reputation, What customers said, Google visibility; dummy calls, directions and views for a demo restaurant with test tools on, labelled), `next_week`; sections can suggest actions, used after the AI's. The WhatsApp message is the report in short (each section's title and numbers on one line, its first lines, the 3 actions, the link), never over 25 lines.
- **Data sources**: `docs/data-sources.md`.
- **Test Kitchen**: run 046 on dev; no reseed needed. `tests/test-kitchen-week.test.ts` runs the real seed (plus a few home matches and a draft rota) through the Monday brief and report.

## Agents live (prompt 4, 27 Oct)

The five agents (Reputation, Visibility, Growth, Insights, the GM) and the checker go live per restaurant, and the old single assistant is retired there. Migration `047_agents_live.sql` (rollback in `supabase/rollback/agents_live_rollback.sql`) only adds two block reasons (`checker`, and `google_error`, which the old list was silently dropping).

- **The switch** (`lib/agents/assistant-mode.ts`, same rule in `scripts/lib/assistant-modes.mjs`): `node --env-file=.env.local scripts/assistant-mode.mjs <slug> agents` sets all five and the checker live; `... <slug> old` puts every one back in shadow, so the old assistant answers everything again from the next message (no deploy). Without a mode it shows where the restaurant is. Logged on /log as the builder. An agent set live still needs `AGENTS_LIVE_ALLOWED=true` and its own readiness check (settings, builder controls, shows any that aren't ready and why).
- **Retired** (`gm-live.ts oldAssistantRetired`): on "agents" the old assistant's `chat()` never runs. What the GM can't handle gets one honest line ("Sorry, I couldn't do that one just now...") and the builder is alerted with the switch-back command. On "old" or a mix, everything works as before.
- **Routing** (`gm.md` 0.4): rota and team changes go to the rota code (`team`); the week ahead, expected sales, staff costs and labour against target go to Insights; a typed change to the draft on screen is its own route (`edit`: the same rewrite as after tapping Edit, the rota re-filled, a fact card read again); the router also reads a pasted review's name, stars and words. Reviews: a pasted review gets Reputation's checked reply to copy; "reply to the 3 star review" / "answer Tom" finds that Google review (`gm-review-rules.ts pickReview`) and puts its reply on screen (the existing draft if there is one); "which reviews still need a reply?" gets a plain list from code. General chat is answered by the composer from the profile and short summaries (review and customer counts, the latest reviews, first names of birthdays this week, never contact details), checked by the checker.
- **Insights reads the week ahead** (`insights.md` 0.3): `query_metrics` has `sales_forecast` (this week or next: the likely sales and range per day, from `getWeekAhead`; none under 8 weeks of history or when the forecast is held back, with why) and `labour_cost` (the rota's cost per day from `labourForWeek`, as a % of actual sales for days gone and forecast sales for days ahead, with the owner's target), and the period `next_week`.
- **Google writes** (`gate-rules.ts googleCheckerStep`, `send.ts`): with the checker live, a review reply or a Google post only goes out once the checker passed that exact version. An owner's edit makes a new version, so it's checked again (in the background as soon as it's edited, or at Approve if that hasn't finished); a fail is blocked with the checker's reason ("Not posted: ..."). Hours and menu updates are code's own wording and don't need it. All the other gate rules are unchanged.
- **Agent questions**: when Growth or Insights asks the owner something during a conversation, the question is put on screen, so the typed answer goes back to that agent with the original request.
- **Growth** (`growth.md` 0.3): halal and allergen statements word for word or not at all; a date the owner names is a fact to use (cited as `request:owner`), not a question. The halal word rule no longer flags "West Ham" or "East Ham".
- **Test Kitchen** (seed section 7): the profile details every agent's go-live check needs, 5 sample photos (`public/samples/test-kitchen/`) and 6 dummy customers who opted in (`.example` addresses, never emailed). Re-run the seed on dev.

### Evals and what they cost

- **Spend cap** (`tests/agents-live/spend.ts`): every Claude call any live test makes is metered; at the budget (`--budget`, default $40) the next call fails before it goes out. The total carries on across runs (`tests/agents-live/.results/spend.json`) until `npm run test:agents -- --reset-spend`.
- **The old assistant against the agents** (`tests/agents-live/compare.eval.ts`, cases `agents/tests/compare/cases.json`): 17 owner messages (finance questions, Google replies and posts, calendar campaigns, rota edits, chat), each run through the real WhatsApp handling twice on Test Kitchen's seed (old assistant, then agents), scored by the same plain-code rules (`tests/agents/support/compare-cases.ts`; figures worked out from the data), including Approve on a review reply, a rota and a campaign. Each case is saved as it finishes (`.results/compare/`), so it can run a few cases at a time (`npm run test:agents -- compare -t finance`). About $1 for all 17 both ways.
- **New saved cases**: 16 router cases (rota edits, finance, reviews, calendar campaigns, typed edits with a draft on screen, a pasted review), Insights 20 to 22 (staff cost next week, next week's sales, a held-back forecast).
- **Costs per agent per restaurant per month**: `node --env-file=.env.local scripts/agent-costs.mjs [slug] [months]` (read-only, from `agent_jobs`; shadow runs count, as they're the same agents on real messages; a part month is also scaled to a full one). The old assistant's own calls aren't recorded per call.

## Tests

`tests/pilot-contracts.test.ts` (the three functions, real and dummy paths, and the registry) and `tests/pilot-schema.test.ts` (043, its rollback and the seed on the full migration chain in PGlite, including its refusal without the dev mark). `tests/seed-guards.test.ts`: every `scripts/seed-*.mjs` stops with live settings. Rota suggester: `tests/rota-fill.test.ts` (the fill, swaps, cost maths, flags, wording, Test Kitchen's dummy week), `tests/rota-edits.test.ts` (edits, staff commands, rules), `tests/rota-flow.test.ts` (team, draft, edits, approve, link, PDF, UNDO, under 8 weeks, on the in-memory database), `tests/rota-wiring.test.ts` (commands, the Thursday job, UNDO plans, logins, 045 and its rollback).

## Notes for later

- `tests/queue.test.ts` failed to start once (25 Oct) during a full run while the machine was busy, then passed on its own and in a rerun. It builds a whole database in PGlite before its tests, so it's probably a slow start, not a bug. Look at it only if it fails again.
