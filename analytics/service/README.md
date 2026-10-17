# DinerAI analytics service

A Python worker that runs DinerAI's statistical models outside the Next.js app.
It takes its jobs from the app's job queue (`supabase/027_job_queue.sql`), reads
clean data from the `analytics` views, and writes model outputs (forecasts now;
rotas, menu engineering, finance and deal uplift later).

Today it runs one model, `forecast_baseline`: same weekday, average of the last 4
weeks. It is a **benchmark**, the yardstick the real forecast model must beat, and
it is never shown to an owner.

## How it fits together

```
03:05 UK  the app's hourly run queues one job per model per active restaurant
          (only while ANALYTICS_JOBS=true in Vercel; the 09:00 backup catches a missed run)
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
  cutoff.py      issue time (03:05 UK) and which trading days are known by then
  backtest.py    the 12-week rolling back-test every forecast model uses
  logs.py        JSON lines (or --pretty)
  cli.py         worker | enqueue | run-one | status | check | models
  models/        one file per model, registered in models/__init__.py
scripts/dev_worker_login.py   gives queue_worker a login on the DEV database
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
- **Integration and permission tests:** a throwaway local Postgres (pgserver), built
  with setup.sql and every migration (the generator's `apply_migrations.py`), the
  3-week fixtures (`load.py --fixture`), and one restaurant with 21 weeks of plain,
  made-up sales.
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
last 12 weeks night by night at 03:05 UK, using only trading days that had ended by
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

## Deploying (Railway)

Not deployed yet: wait for the builder's go-ahead. Then, in this order:

1. **Supabase, production:** SQL Editor, paste `supabase/039_analytics_jobs.sql`, Run.
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
   (Production), then redeploy. From the next 03:05 UK, every active restaurant gets
   a nightly `forecast_baseline` job.

**To stop it:** set `ANALYTICS_JOBS` to `false` in Vercel (no new jobs), and remove
the Railway service. `supabase/rollback/analytics_rollback.sql` undoes 039.

**Scaling:** each copy runs one job at a time. Raise Railway's replica count when the
nightly batch takes too long; copies never run the same job. `job_types.max_running`
(4 for `forecast_baseline`) caps how many run at once across all copies.
