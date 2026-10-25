# DinerAI synthetic data generator

Realistic restaurant data, with **known effects baked in**, for building and testing the
statistical models (forecasting, rota, menu engineering, finance, deal uplift) before
there is real restaurant data. The same data doubles as test fixtures for the
data-collection features (POS import, Z-report photos, invoice photos, rota uploads,
till item matching).

The outside world is **real**: London weather (hourly, and forecasts as they were
issued), gov.uk bank holidays, the East London Mosque's Ramadan and Eid dates, prayer
times, Redbridge, Newham and Waltham Forest school holidays, Premier League and England
fixtures with kick-off times, and real London Stadium and ExCeL events. Only the
restaurants' behaviour is made up.

## The four datasets

| Key | Restaurant | Where | What's special |
|---|---|---|---|
| `halal_ilford` | Saffron Lane Kitchen (halal South Asian) | Ilford Lane, Redbridge | Evening heavy; Friday lift after Jummah; Ramadan daytime drop, iftar surge and late peak (moving with each day's maghrib); big Eid peaks; family groups at weekends; 25% delivery |
| `cafe_walthamstow` | Fern and Fold Cafe | Hoe Street, Waltham Forest | Morning and weekend brunch peaks; sunshine and warmth lift trade; school holidays lift; closes at 17:00; mostly dine-in |
| `takeaway_stratford` | Broadway Late Grill | The Broadway, Newham (1.2 km from London Stadium) | Open till 01:00 (02:00 Friday and Saturday); rain lifts delivery; matches on TV and stadium or ExCeL crowds lift orders (scaled by distance); payday weekends; 70% delivery |
| `halal_ilford_messy` | The same restaurant and random numbers as `halal_ilford`, plus trouble | Ilford | 2-week refit closure (recorded); a 12% price rise in January 2026; a new dish (Lamb Nihari) that builds up and takes orders from Lamb Karahi; one bad week with no explanation; 4% of days missing; duplicated item lines; the till reprogrammed (new item names) plus typos; broken and repeated rows in the POS exports |

Each is a demo restaurant (`is_demo = true`, `active = false`, so no job, brief or
email ever touches it) with a fixed id: `33333333-...` to `66666666-...`.

## Commands

All from `analytics/generator/` (outside OneDrive, in the git worktree). One-off setup:

```
py -m venv .venv
.venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt
```

| What | Command |
|---|---|
| Refresh the real outside data (only to move the end date) | `.venv\Scripts\python fetch_outside.py --end 2026-10-16` |
| Generate all four (24 months ending yesterday, seed 42) | `.venv\Scripts\python generate.py` |
| Generate one, with a seed and end date | `.venv\Scripts\python generate.py --dataset cafe_walthamstow --seed 7 --end 2026-10-16` |
| Faster, without the input files | add `--no-inputs` |
| Charts showing the effects | `.venv\Scripts\python sanity_plots.py` |
| Build a fresh dev Supabase database | `.venv\Scripts\python apply_migrations.py --env C:\Users\miraa\dev\synth.env` |
| Load all four into it (check first with `--dry-run`) | `.venv\Scripts\python load.py --env C:\Users\miraa\dev\synth.env --dataset all` |
| Reload one dataset (replaces it) | `.venv\Scripts\python load.py --env ... --dataset takeaway_stratford` |
| Clear one dataset | `.venv\Scripts\python load.py --env ... --dataset takeaway_stratford --clear` |
| Tests | `.venv\Scripts\python -m pytest -q tests` and, from the repo root, `npx vitest run tests/synthetic-data.test.ts` (`SYNTH_FULL=1` for the full 24 months) |

A run takes about a minute per dataset (four with the input files). `cache/` holds the
real outside data (committed, so runs are the same offline and forever);
`fixtures/` holds a 3-week slice (2 to 22 March 2026: Ramadan and Eid) of each dataset,
committed for CI. `output/` is not committed.

### The env file and the safety rules

`load.py` and `apply_migrations.py` read credentials **only** from the file passed with
`--env` (no default, and a file inside OneDrive is refused). It needs:

```
DATABASE_URL=postgresql://postgres.<dev-project-ref>:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
TEST_TOOLS=true
```

- The production project (`gfrkcvcqmdhdhpcytlkc`) is always refused, fixture or not: demo
  data stays on dev. `apply_migrations.py` never runs there either.
- `TEST_TOOLS` must be on (the app's own switch rules, including the deprecated `TEST_MODE`).
- A restaurant with a dataset's id that is not a demo restaurant is never touched; a
  slug clash with another restaurant is refused.
- Each dataset loads in one transaction: its older-table rows (sales, Z reports, POS
  files, drafts and campaigns, daily weather) are deleted by restaurant id, then
  `clear_ops_dummy_data(false, <restaurant>)` (migration 038) clears the rest, then the
  rows are inserted. `--dry-run` does all of it and rolls back.
- The database size is printed before and after. All four datasets add about 140 MB.
- `apply_migrations.py` runs `setup.sql` and every numbered file in order, refuses a
  database that already has the app's tables (unless `--resume`), and then removes the
  scheduled jobs the migrations create, so a dev project never calls the live app.

## What each dataset fills

Money is whole pence in the new tables and pounds in the older sales tables.

- **Sales**: `sales_days` (with covers), `sales_hours` (till hours of the trading day, with
  covers), `sales_channel_splits` (per day and per hour), `sales_items` (per dish per day,
  under realistic till names such as `CHKN TIKKA MASALA`, `CHICKEN TIKKA LGE`), with
  `till_item_matches` (all confirmed for the clean datasets; only exact names for the messy
  copy). Every total is a sum of the same simulated orders, so items, hours, channels,
  cash plus card, and net plus VAT all add up to the day exactly (the messy copy excepted,
  by design).
- **Menu**: `menu_sections`, 39 to 45 `dishes`, `dish_prices` (with the price rises),
  `ingredients`, `recipe_versions` and `recipe_lines`, `ingredient_prices` (from the
  invoices, drifting with inflation). `restaurants.menu` is remade from the dishes.
- **Staff**: 12 to 15 people across roles and minimum-wage bands, `staff_pay_rates` (the
  real April 2025 and April 2026 minimum wage rises), `staff_availability`,
  `staff_time_off` (holidays, sickness, a declined and a pending request), `cover_rules`.
- **Rotas**: `rota_weeks`, `rota_shifts` (planned from expected demand; some left open),
  `shift_actuals` (late starts, staying on when busy, sent home when quiet, sick days),
  plus planted working-time cases: an under-18 working over 8 hours, under 11 hours'
  rest, no break on a long shift, shifts across the October clock change, over 48 hours a week.
- **Costs**: 4 `suppliers`, weekly `invoices` and `invoice_lines` (use plus waste plus
  stock change, in whole packs; extra cash and carry runs when stock runs out),
  `fixed_costs`, `targets`, `channel_fees` (delivery apps 30%, 32% from July 2025).
- **Deals**: 10 past `campaigns` (with their `drafts`) with structured offers in
  `offer_details`, and a `promotion` row in `restaurant_events`. The true effect is only in
  the ground truth: `deal_outcomes` is left for the model.
- **Outside**: `weather_hours`, `weather_days`, `weather_forecasts`, `local_calendar`
  (each restaurant's own copy), `calendar_relevance` (distance, and what the builder marked
  relevant), `football_fixtures`, shared `venues`, `restaurant_teams`, `prayer_times`.
- **The restaurant's own events**: Christmas closures, price changes, the menu change,
  the refit, short-staffed days, promotions.

New-table rows have `source = 'synthetic'`. The older tables can't say that: their rows
have `is_dummy = true` and `source = 'seed'` (`'archive'` for `weather_days`), with
`covers_source = 'synthetic'`.

## Outputs per dataset

```
output/<dataset>/
  load/NN_<table>.jsonl     rows in insert order (what load.py and the PGlite test load)
  ground_truth.json         every parameter and the answers (below)
  ground_truth_daily.csv    each day: every multiplier, the weather used, expected and actual orders
  inputs/                   the messy files, with inputs/answers.json
  plots/                    the sanity charts
```

`ground_truth.json` holds: all parameters; each deal's true uplift (incremental orders and
sales, the discount given to customers who would have come anyway, and the net uplift, by
day); each dish's prices, recipe and true cost per portion over time; each ingredient's
purchases, use, prep waste, spoilage and opening and closing stock (`bought = used +
spoilage + closing - opening`, exactly); labour cost per week; the working-time cases; the
unexplained shock days; every football and venue lift with its distance; closed days; and
for the messy copy every problem planted (missing days, typos, duplicates, the till-name
answer key).

`inputs/`:
- `pos/`: item-level till exports for the last 3 months, one file a month: Epos Now style
  (South Asian), Square style (cafe), Lightspeed style (takeaway, semicolons). The messy
  copy's files include broken lines (cut short, `#VALUE!`, missing date) and repeated lines;
  their line numbers are in `answers.json`.
- `z_reports/`: a photo-like till report (tilted, uneven light, slight blur) for each of the last 8 weeks' days.
- `invoices/`: photo-like supplier invoices for the last 8 weeks.
- `rotas/`: the last 4 weeks as CSV and as a photo of the printed sheet.

## Every parameter

Effects multiply expected orders. Where it says "log", the multiplier is `exp(coefficient x value)`.

### Demand (`datasets.py`, per dataset)

| Parameter | Meaning | Ilford | Cafe | Takeaway |
|---|---|---|---|---|
| `base_orders` | expected orders on a plain Wednesday at the start | 62 | 72 | 88 |
| `trend_per_year` | growth, compounding daily | 5% | 3% | 7% |
| `dow` | Monday to Sunday multipliers | 0.80 to 1.42 (Sat) | 0.80 to 1.60 (Sat) | 0.78 to 1.38 (Sat) |
| `season_amplitude`, `season_peak_doy` | yearly cosine | 4%, 11 Dec | 6%, 19 Jul | 7%, 20 Jan |
| `noise_sigma` | daily log-normal noise | 0.07 | 0.08 | 0.09 |
| `shock_rate_per_year`, `shock_sigma` | unexplained one-day shocks (Poisson), their log size | 2, 0.25 | 2, 0.25 | 3, 0.30 |
| `channels` | dine-in / takeaway / delivery shares | 52/23/25 | 86/12/2 | 6/24/70 |
| `party` | mean party size: dine-in, weekend dine-in, takeaway, delivery | 2.6, 3.6, 2.2, 2.3 | 1.8, 2.6, 1.2, 1.6 | 1.6, 1.9, 1.5, 1.8 |
| `hourly` | weights per till hour, weekday and weekend profiles | see file | see file | see file |
| `hours` | opening hours per weekday (hours after 24 belong to the trading day) | 12 to 23 (24 Fri, Sat) | 8 to 17 (Sun 9 to 16) | 16 to 01 (02 Fri, Sat; 14 at weekends) |
| `trading_day_cutoff` | till hours before this are on the next calendar date | 05:00 | 05:00 | 05:00 |

### Effects (`effects` in `datasets.py`)

| Parameter | Meaning | Ilford | Cafe | Takeaway |
|---|---|---|---|---|
| `weather.rain[channel]` | log per mm of rain in opening hours (capped at 10 mm) | dine-in -0.025, takeaway -0.010, delivery +0.030 | -0.030, -0.040, +0.040 | -0.030, -0.020, +0.045 |
| `weather.temp[channel]` | log per degree away from 15 C | 0 | +0.008, +0.010, 0 | delivery -0.004 |
| `weather.temp_hot` above `temp_hot_above` | log per degree above a hot threshold | dine-in -0.03 above 26 C | -0.02 / +0.02 above 28 C | delivery -0.02 above 26 C |
| `weather.sun[channel]` | log per hour of sunshine above the month's normal | 0 | +0.025, +0.030, 0 | delivery -0.010 |
| `bank_holiday` | whole day | 1.15 | 1.30 | 1.08 |
| `closed_days` | closed every year | 25 Dec | 25, 26 Dec, 1 Jan | 25 Dec |
| `christmas_eve`, `new_years_eve` | | 0.80, 1.25 | 0.90, 0.70 | 0.85, 1.10 |
| `jummah` | Friday 13:00 to 15:00 hour weights x (1 + lift) | +60% | none | none |
| `ramadan.day_total` | the whole day in Ramadan | 1.12 | none | 1.06 |
| `ramadan.daytime` | hours before maghrib | x0.30 | | x0.55 |
| `ramadan.iftar_surge` | the maghrib hour and the next | x2.6 | | x1.8 |
| `ramadan.late_peak` | 21:00 to close | x1.8 | | x1.3 |
| `ramadan.late_close_extra_hours`, `dine_in_share_shift` | open an hour later; dine-in share up (from takeaway) | 1, +0.08 | | 0, 0 |
| `chand_raat` | the evening before Eid al-Fitr (and 20:00 onwards x1.4) | 1.30 | | 1.15 |
| `eid_fitr`, `eid_adha` | first, second, third day | 1.90, 1.45, 1.20; 1.55, 1.25 | | 1.20, 1.05; 1.10 |
| `school_holiday` | whole day | 1.05 | 1.14 | 1.00 |
| `school_holiday_lunch` | weekday 12:00 to 15:00 in school holidays | x1.25 | | |
| `football.team` | match of a followed team (West Ham, Arsenal, Tottenham): extra orders around kick-off | | | 1.12 |
| `football.england` | England match evenings (less than 1: fewer dine-in diners) | 0.92 | | 1.35 |
| `venue.max_lift`, `venue.scale_m` | crowds: lift = max_lift x exp(-distance / scale) x crowd / 60,000, in the hours around the end | | | 0.45, 2,000 m |
| `payday` | payday (last working day) to the Sunday after | 1.04 | 1.02 | 1.10 |
| `price_rises` | day, %, sections | 7 Apr 2025 +5% mains and grills | 3 Mar 2025 +6% coffee and brunch | 12 May 2025 +7% chicken and burgers |
| `elasticity` | dish choice: weight x (price / first price) ^ elasticity | -0.9 | -0.7 | -1.2 |
| `order_elasticity` | visits: orders x (menu price index) ^ order_elasticity | -0.4 | -0.3 | -0.6 |
| `cash_share` | cash share of dine-in and takeaway payments, start to end | 22% to 14% | 12% to 6% | 10% to 5% |

Messy copy: as Ilford, plus `price_rises` 12 Jan 2026 +12% (mains, grills, biryani),
`elasticity` -1.1, `order_elasticity` -0.5, `new_dishes` Lamb Nihari from 15 Sep 2025
(35-day build-up, takes 35% of Lamb Karahi's demand), `closures` 4 to 17 Aug 2025 (refit),
`unexplained` 1 to 7 Jun 2026 x0.70, and `mess`: missing days 4%, duplicate item lines
1.5%, till reprogrammed from 3 Nov 2025, typos 2%, 6 broken and 4 repeated rows per POS file.

### Orders (`sales.py`)

`ORDER_RULES`: dishes per person by role (Poisson): Ilford main 0.95, starter 0.30, bread
and rice 1.05, side 0.22, drink 0.70, dessert 0.14, kids meal 0.12 per order of 2 or more;
cafe drink 1.05, main 0.62 (brunch dishes until 12:00, 15:00 at weekends), side 0.10,
pastry 0.28; takeaway main 0.82, meal deal 0.20, side 0.75, drink 0.40, dessert 0.12.
`REFUND_RATE` 3% of days have one partial refund. VAT is 20% on everything.

### Deals (`deals.py`)

Ten offers per menu: name, type (percent off, money off, free item, kids eat free, 2 for 1),
target weekdays, hours (lunch, evening, all), channels, **true uplift** (8% to 35% more
orders in the target slots) and **redemption** (the share of orders that would have come
anyway that use it, 5% to 15%). Percent-off and 2-for-1 deals run 4 weeks, others 2; the
Ramadan offer runs in the first Ramadan; none overlap or fall in a closure.

### Staff (`staff.py`)

`ROSTERS` (name, roles, skills, contracted hours, wage band, pay above the minimum, start,
end), `TEMPLATES` (shift patterns per role, scaled by expected orders), `PAY_RAISE` 4% a
year above the minimum each April, 4 sick days and 2 weeks' holiday a year. Actual hours:
start a few minutes late (normal, mean 2, sd 4), overrun 1.2 minutes per % the day beat its
forecast (plus noise, sd 8), and on quiet days (under 80%) half the front staff go home 30
to 90 minutes early.

### Costs (`costs.py`, `menus.py`)

`INFLATION` per category a year (poultry 5%, meat 6%, dairy 6%, veg 4%, dry 3%, coffee 14% ...)
plus `PRICE_JUMPS` (dairy +8% Feb 2025, poultry +7% Mar 2025, coffee +10% Jun 2025, meat
+5% Jan 2026), changed at supplier price reviews every 4 to 9 weeks with small noise;
`PRICE_LEVEL` per menu (1.32, 1.38, 1.12) sets food cost near 30% of net sales;
`TARGET_DAYS` 9 days of stock after each delivery; spoilage % per ingredient (in `menus.py`).
Fixed costs, targets and channel fees are listed in `costs.py`.

## Approximations (also in each ground_truth.json)

- VAT is 20% on all sales. `sales_days.card` includes delivery-app payments.
- Open-Meteo gives no issue time for archived forecasts: `issued_at` is the target hour (or
  the London midnight starting the target day) minus 1 to 7 days. Forecasts have no weather
  code or rain chance (the archive of forecasts has none). Hourly forecasts are kept for 1
  and 2 days ahead, daily ones for 1 to 7.
- Item sales are per dish per day; receipt-level detail is only in the POS exports.
- Prayer times are calculated (Moonsighting Committee, Hanafi asr), not a mosque's timetable.
- Newham's autumn 2026 term dates weren't published where we could find them: the London pattern is used.
- Ramadan and Eid follow the East London Mosque; communities following UK moon sighting
  were a day later in 2026 (marked `date_uncertain`, with the alternative in the notes).
- Venues and fixtures are shared tables (no restaurant): each dataset has its own copy of
  the calendar and fixtures; a venue is reused if one with the same name already exists.
- Waste and stock counts are only in the ground truth (no tables for them yet).
