# DinerAI analytics service

A Python worker that runs DinerAI's statistical models outside the Next.js app.
It takes its jobs from the app's job queue (`supabase/027_job_queue.sql`), reads
clean data from the `analytics` views, and writes model outputs (forecasts now;
rotas, menu engineering, finance and deal uplift later).

It runs three models:
- `forecast_baseline`: same weekday, average of the last 4 weeks. A **benchmark**,
  the yardstick the real forecast must beat, never shown to an owner.
- `forecast_daily` (05:35 UK): the demand forecast, a **production** model. Shown to
  an owner only on nights its back-test passes. No AI: pure statistics.
- `forecast_refresh` (07:00 UK): days 0 to 2 of that forecast again, with the newest
  weather forecast and calendar, without re-fitting.

## How it fits together

```
05:35 UK  each active restaurant's model jobs are due: the app's 05:05 hourly run
          queues them to start at 05:35, after the 05:00 trading-day cut-off, so
          yesterday counts (only while ANALYTICS_JOBS=true in Vercel; the 09:00
          backup catches a missed run and starts it at once)
            |
            v
  jobs table (Supabase)  <-- ext_claim_jobs / ext_extend_job / ext_complete_job / ext_fail_job
            |
            v
  this worker (Railway)  reads analytics.* views, writes model_runs + forecasts
            |
            v
  a dead job  -->  the app's hourly health check alerts the builder (never the owner)
```

## The safety rules

- **One login:** it connects only as `queue_worker`. It can read the `analytics.*`
  views, add rows to the model output tables, finish its own runs
  (`finish_model_run`), and call the `ext_*` queue functions for external job types.
  It can't read any app table, change or delete an output row, or touch the app's jobs.
- **Settings come only from what you name.** That's `--env <file>` (outside OneDrive)
  or `--env process` (Railway's variables). It never reads a default file, and it
  refuses a Supabase secret key or any user other than `queue_worker`.
- **Production needs two things:** `ANALYTICS_ENV=prod` must match the production
  project, and `--allow-production` must be on the command line.
- **Narrow reads and writes:** a model only reads the views it declared. Every query
  uses quoted names and parameters.
- **Benchmarks never reach owners:** a run's role is `benchmark` or `production`.
  The app only shows outputs from production runs that succeeded and passed
  (`src/lib/ops/model-roles.ts`), and the database hides benchmark runs and their
  outputs from owner logins.

## Layout

```
src/dinerai_analytics/
  config.py      settings and the guard rails
  db.py          view reader (declared views only), output writer, finish_model_run
  queue.py       the ext_* queue functions
  registry.py    ModelSpec, Registry
  runner.py      one job: model_runs row, run, outputs + finish in one transaction
  worker.py      claim loop, a process per job, heartbeats, time budget, clean shutdown
  cutoff.py      issue time (05:35 UK) and which trading days are known by then
  backtest.py    the 12-week rolling back-test every forecast model uses
  logs.py        JSON lines (or --pretty)
  cli.py         worker | enqueue | run-one | status | check | models | forecast-report
  models/        one file (or folder) per model, registered in models/__init__.py
    forecast_daily/   the demand forecast; each module's notes say what it does
scripts/dev_worker_login.py   gives queue_worker a login on the DEV database
scripts/recovery_report.py    the forecast's estimates against the generator's known effects
tests/unit, tests/integration
```

## Running it locally against dinerai-dev

One-off set-up (from `analytics/service/`, outside OneDrive):

```
py -3.10 -m venv .venv
.venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\pip install -e .
.venv\Scripts\python scripts\dev_worker_login.py --env C:\Users\miraa\dev\synth.env --out C:\Users\miraa\dev\analytics-dev.env
```

The last command gives `queue_worker` a new random password on the **dev** project
only (it refuses production) and writes `analytics-dev.env`. Run it again to change
the password. Then:

| What | Command |
|---|---|
| Check the login and its permissions | `.venv\Scripts\python -m dinerai_analytics check --env C:\Users\miraa\dev\analytics-dev.env` |
| Queue a job for a restaurant (id or slug) | `... enqueue --env ... --restaurant demo-saffron-lane --model forecast_baseline` |
| The same for a past day (data up to then) | add `--as-of 2026-09-01`; add `--again` for a second job on the same day |
| Run the worker until the queue is empty | `... worker --env ... --exit-when-idle --pretty` |
| Run the worker for good (Ctrl+C stops it cleanly) | `... worker --env ... --pretty` |
| Follow one job | `... status --env ... <job id> --watch` |
| One job in the foreground (debugger friendly) | `... run-one --env ... --restaurant demo-saffron-lane --model forecast_baseline` |
| Compute and print, write nothing, no queue | add `--dry-run` to run-one |
| The registered models | `... models` |

The demo restaurants are inactive, so the app never queues jobs for them. Use
`enqueue`. Outputs for demo restaurants are cleared with the rest of their dummy
data (`clear_ops_dummy_data`).

## Tests

```
.venv\Scripts\ruff check .
.venv\Scripts\python -m pytest -q tests
```

- **Unit tests:** the registry, the config guards, the cut-off rule, the baseline
  maths and the back-test scoring.
- **The forecast's unit tests** (`test_forecast_features.py`, `test_forecast_model.py`,
  on a small made-up restaurant in `forecast_fixture.py`):
  - every feature builder: clock changes, the trading-day cut-off, Ramadan and
    maghrib, Jummah, distance decay, weather as issued, deals and prices as known;
  - the model as a whole: hours adding up to days and channels to all, the same
    numbers for the same seed, no look-ahead (later data is altered and the forecast
    mustn't move), uncertain dates, the refresh, the calibration, the pass bar;
  - housekeeping: the defaults files, and that the model never reads ground truth.
- **Integration and permission tests:** a throwaway local Postgres (pgserver), built
  with setup.sql and every migration (the generator's `apply_migrations.py`), the
  3-week fixtures (`load.py --fixture`), and one restaurant with 21 weeks of plain,
  made-up sales. `test_forecast_daily.py` covers the new tables' rights, a nightly
  run and its refresh end to end, and too little history.
- **GitHub:** the `analytics-service` job in `.github/workflows/ci.yml` runs them on
  every push.

## Adding a model

1. Add `models/<name>.py` with a `run(ctx) -> ModelResult` function and a `SPEC`. The
   SPEC gives the name, version, kind, **role** (`benchmark` or `production`), job
   type, the analytics views it reads, its time budget and its history window.
2. Add one line to `models/__init__.py`: `reg.register(<name>.SPEC)`.
3. Add a numbered SQL file in `supabase/` with its `job_types` row (runner `external`).
4. For a nightly model, add its job type to `NIGHTLY_MODELS` in `src/lib/queue/config.ts`.

A forecast model must score itself with `backtest.rolling_backtest`. That replays the
last 12 weeks night by night at 05:35 UK, using only trading days that had ended by
then, so its numbers are directly comparable with the baseline's.

## The baseline (benchmark)

- **Forecast:** for the issue day and the 13 days after it, likely = the average of
  the same weekday in the last 4 weeks known at issue time; low = the lowest of
  those weeks, high = the highest. It needs at least 2 usable weeks; closed days are
  left out.
- **What it forecasts:**
  - orders (transactions): `all`, plus each channel in `sales_channel_splits`;
  - covers: `all`, plus channels that record covers;
  - sales (net pence): `all` only, because channel splits include VAT.
- **Headline score:** orders/all.
  - WAPE = sum of |actual - likely| / sum of actual;
  - coverage = share of actuals between low and high (about 60% is expected from
    the lowest and highest of 4 weeks).
- **Passed:** at least 56 of the 84 back-test days were scored. That only means the
  back-test is complete enough to compare against. A benchmark is never shown,
  whatever "passed" says.

## The forecast (forecast_daily)

**What it forecasts:** orders per day for each channel (dine-in, takeaway,
delivery) and in all, 56 days ahead; hourly for the first 14 days. From those:
sales (net of VAT) and covers. Each comes as low, likely and high (P10, P50, P90).

**The model** (one per restaurant and channel), with orders as a negative binomial:

    log(expected orders) = level + trend + season + weekday + the factors + log(hours open)

- **The factors:** calendar, religious, weather, matches and crowds, deals, prices.
  The full list, and how each is built, is in the module notes
  (`models/forecast_daily/*.py`).
- **Fitting:** each weight starts from a default (its prior) and moves as far as the
  data supports. Recent days count more (26-week half-life). It is re-fitted every
  night on all history.
- **Ranges:** simulated (500 draws), then calibrated on the back-test so the 80%
  range holds about 80% of actual days.
- **Hours:** each day is split into hours by an hour profile: Ramadan follows
  maghrib, and Friday's Jummah window follows dhuhr. Hours add up exactly to the day,
  and channels add up exactly to all.

**The defaults** live in `models/forecast_daily/defaults/`: `general.json` is complete,
and `halal.json`, `cafe.json` and `takeaway.json` list only what differs. Each weight
has a written reason. The type comes from the restaurant's cuisine. To change a
default, edit the file. A test checks that every entry still has a reason and that
every factor has a default.

**Passed** (written to `model_runs.passed`, the same bar for every restaurant):
- orders/all: WAPE no worse than `forecast_baseline` on the 12-week back-test, and at
  least 10% better than it on the long back-test (which covers Ramadan, Eid and other
  special periods);
- every channel with at least 15% of the orders: WAPE no more than 5% worse than
  `forecast_baseline` on the 12-week back-test;
- for orders/all and each of those channels: 80% range coverage between 75% and 88%
  (slightly wide ranges do less harm than narrow ones), and bias under 5% either way;
- at least 8 weeks of history.

Under 8 weeks of history the run succeeds with no forecast and passed false.

**What a run writes:**
- `forecasts`, daily and hourly;
- `model_coefficients`: every weight with its sd and its prior, so you can see the
  weights change night by night;
- `forecast_drivers`: the 6 biggest reasons behind each day, as multipliers.

The run's metrics hold every score by channel and horizon, side by side with the
three benchmarks (last week, the baseline, exponential smoothing).

### Running it against dinerai-dev

From `analytics/service/` (`ENV` is `C:\Users\miraa\dev\analytics-dev.env`):

| What | Command |
|---|---|
| A nightly run, written to the database (as if at 05:35 that day) | `.venv\Scripts\python -m dinerai_analytics run-one --env ENV --restaurant demo-saffron-lane --model forecast_daily --as-of 2026-10-17` |
| The same, computed and printed only | add `--dry-run` |
| The 07:00 refresh of that run | `... run-one --env ENV --restaurant demo-saffron-lane --model forecast_refresh --as-of 2026-10-17` |
| The full report (the nightly run, the long back-test, chart data, today's weights) for every demo restaurant | `... forecast-report --env ENV --restaurant demo --as-of 2026-10-17 --out C:\Users\miraa\dev\forecast-report.json` |
| The recovery table (estimates against the generator's known effects) | `.venv\Scripts\python scripts\recovery_report.py --report C:\Users\miraa\dev\forecast-report.json --truth C:\Users\miraa\dev\naila-synth\analytics\generator\output` |

**The 12-week back-test** runs inside every nightly run, and its results are in that
run's metrics (`pass`, `series`, `benchmarks`, `hourly`, `special_days`).

**The long back-test** uses about 50 cut-offs spread over the history, and gives
Eid, Ramadan and match days separately. It takes about a minute per restaurant, so
the nightly run makes it once every 28 days (and when the model version changes) and
keeps its orders/all summary in the run's metrics (`long_backtest`, with `cached`
true on the nights that reuse it). `forecast-report` shows it in full, with every
series, horizon and weight.

`recovery_report.py` is the only code that reads the generator's ground truth. It
sits outside the model package, and a test checks that the model never reads it.

## Deploying (Railway)

Not deployed yet. The builder deploys it once the real forecast model passes its back-test. Then, in this order:

1. **Supabase, production:** SQL Editor, paste `supabase/039_analytics_jobs.sql`, Run;
   then the same with `supabase/040_forecast_model.sql` (the forecast's job types and tables).
2. **Give the worker a password.** On your computer run
   `py -c "import secrets; print(secrets.token_urlsafe(24))"` and copy the result.
   In Supabase > SQL Editor run
   `alter role queue_worker with login password '<that password>';`
3. **The connection string:** Supabase > Connect > Session pooler. Copy it, change
   the user `postgres.<ref>` to `queue_worker.<ref>`, and put the password in.
4. **Railway:**
   - railway.com > sign in with GitHub > New Project > Deploy from GitHub repo >
     the DinerAI repo;
   - in the service's Settings:
     - Source > Root Directory: `analytics/service`;
     - Config-as-code > Railway config file: `/analytics/service/railway.json` (Railway wants the full path from the repo root here);
     - Deploy > Region: EU West (Amsterdam);
   - Variables: `DATABASE_URL` (step 3) and `ANALYTICS_ENV` = `prod`. Nothing else.
     Never the Supabase secret key.
   - Deploy. The logs should show `worker.started` with `env: prod`.
   - The start command in `railway.json` adds `--allow-production`. The Docker image
     on its own refuses production.
5. **Check it from your computer:** make a file outside OneDrive with the same two
   settings and run `check --env <file> --allow-production`. Every line should say ok.
6. **Vercel:** Settings > Environment Variables > add `ANALYTICS_JOBS` = `true`
   (Production), then redeploy. From the next 05:35 UK, every active restaurant gets
   nightly `forecast_baseline` and `forecast_daily` jobs, and a `forecast_refresh` at 07:00.

**To stop it:** set `ANALYTICS_JOBS` to `false` in Vercel (no new jobs), and remove
the Railway service. `supabase/rollback/forecast_model_rollback.sql` undoes 040, then
`supabase/rollback/analytics_rollback.sql` undoes 039.

**Scaling:** each copy runs one job at a time. Raise Railway's replica count when the
nightly batch takes too long; copies never run the same job. `job_types.max_running`
(4 each for `forecast_baseline`, `forecast_daily` and `forecast_refresh`) caps how many
run at once across all copies. A `forecast_daily` run took 35 to 60 seconds per
restaurant on the builder's laptop, most of it the 12-week replay, and 65 to 95
seconds on the night every 28 days that re-makes the long back-test. Its time budget
is 10 minutes.
