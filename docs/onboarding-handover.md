# Onboarding with Dina: handover

Updated 1 Nov 2026 so a new chat can pick up cold (first written 29 Oct, end of phase 4).
Branch `onboarding-dina` (worktree `C:\Users\miraa\dev\naila-dina`), pushed to GitHub, **not merged**: the older onboarding is still the one live on main (app.dinerai.co.uk).

Read with:
- `docs/onboarding-spec.md`: the original brief, word for word.
- `docs/onboarding-audit.md`: the phase 0 audit, the nine decisions, the phase table (milestones A, B, C).
- `docs/merge-checklist.md`: everything to do to put the branch live, the checks after, the rollback.
- `docs/phone-test.md`: the phone test against the branch preview and the dev database.
- `CLAUDE.md`: step 37 and the "Onboarding with Dina" working notes, file by file.

## Where things stand (1 Nov)

- **Built**: milestone A (sign-up with no paywall, Dina on the web and WhatsApp, steps 1 to 6, the summary, the builder's test controls) and milestone B's phase 9 (steps 7 to 10 and 12), plus the work listed in section 3. All tests pass (1,598); the latest preview build is Ready.
- **Blocking the merge**: your phone test (you're running it separately, against the `onboarding-dina` preview and the dev database).
- **While the phone test runs**: don't change Vercel settings, Twilio settings or the dev database layout without asking you first. Push when something's done and tell you, so you can re-test on the new preview.
- **Next by plan**: phase 10 (gap nudges in the brief, a gaps page), then milestone C (customer list import, languages and key dates, resume reminders, the admin onboarding view, retiring the old onboarding). A "Pilot Zero" harness is being considered: section 8 lists what it can reuse.

## 1. Phases done

| Phase | What | Commits |
|---|---|---|
| 0. Audit | `docs/onboarding-audit.md`: what existed, what to change, the plan, nine questions | 029ec45 |
| 1. Foundation | The 12 steps as pure code (`src/lib/onboarding/flow.ts`), saved per restaurant (`sessions.ts`, `startOnboarding(siteId)` the one way in), setup gaps, the test-site wall, migration 048 with RLS | 40f792a |
| 2. Sign-up and entry | No paywall (`ONBOARDING_REQUIRES_PAYMENT` off), invite code required, DPA in the tick box with versions saved, straight-in login for brand-new owners (limited to their restaurant), "You're in", WhatsApp linked by the sign-up number, strangers get no reply, migration 049 | e638c3f |
| Between 2 and 3 | Local work on the dev project by default, live only on purpose | 8bda1dd, b9e68dc |
| 3. Dina | `agents/dina.md` and `agents/dina.config.json`, `dinaTurn` (one turn for both channels), checked tools, coded reply checks, data kept as data, cost per run (migration 050) | c16d40b, dd0fd5d |
| 4. Web chat | Components (each tested), the streaming endpoint, `/onboarding/chat` | b6c3adb, 80fd7a6, 6364a1d |
| Next.js fix (30 Oct) | 16.4.0 to 16.4.3, merged to main as PR #29 and live | d20e626 |
| After your browser test (30 Oct) | Straight into the web chat; Dina introduces herself; no "I'm an AI" unless asked | 255cc05 |
| 5. WhatsApp | The same turn on WhatsApp: buttons, lists, numbered fallback, files into a private bucket (migration 051), linking hands over at the exact step | see git log |
| Speed (31 Oct) | One Claude call per turn: a WhatsApp reply's Claude time 1.3 to 2 s | 55a2230 |
| 6. Steps 1 to 3 | Hello (Google Maps pre-fill), Google (questions, steps card, invited, acceptance, 24-hour nudge; migration 052), tone | see git log |
| 7. Steps 4 to 6 | Making it right, menu (read from photos/PDF, allergens dish by dish), hours and FAQs (migration 053) | dd1ac62 |
| 8. Summary and test controls | Finishing, the summary card, `/onboarding/admin`, the full real run ($0.18), the preview bypass, phone-test and merge docs | b42ef71 |
| Previews on dev (1 Nov) | Every Vercel Preview uses the dev database with safe switches; previews only WhatsApp `BUILDER_WHATSAPP` | d275d61 |
| "Not answered" is a gap (1 Nov) | FAQs passed on make Hours and FAQs half done, with a gap line naming them | 9541075 |
| 9. Steps 7, 8, 9, 10, 12 (1 Nov) | Sales history, team and labour, rewards and the cap, the QR codes, approvals and timing; per-restaurant brief hour (migration 054) | 49eb9dc, 607d956 |
| Test tools locked (1 Nov) | Test tools on Production only for your builder number; no demo sign-ups on Production; clear-dummy-data only touches test sites | 23b7817 |
| Daily takings (1 Nov) | Files with no item column imported as daily totals; your till steps | 76632ef |
| Net sales and the delete script (1 Nov) | Takings are net sales; orders per day; `scripts/delete-restaurants.mjs` | 874be19 |
| Takings-only forecast (1 Nov) | Forecasts without order counts; order counts as a low-priority gap; Square's Transactions export | c74c1ff |
| Saved daily forecast (1 Nov) | One saved forecast a day for the brief, report, rota and Insights (migration 055) | 0d90eb6 |

## 2. Every decision you made

### The nine audit answers (28 Oct)

| # | Question | Your answer |
|---|---|---|
| 1 | Stripe was already built | Kept in the code, switched off. `ONBOARDING_REQUIRES_PAYMENT` defaults to false: every sign-up needs an invite code and Stripe is never opened. `TODO(stripe)` marks where it plugs back in. |
| 2 | Getting into the web chat after sign-up | A brand-new owner is logged straight in after sign-up (same Supabase session as a login link, limited to that restaurant); the login email still goes in the background. |
| 3 | Linking WhatsApp by number | The first message from the sign-up number links it; the one-time code is the fallback; unknown numbers get nothing. A number already linked elsewhere is never linked automatically. |
| 4 | Accounts and memberships | Out of scope. The site manager is a team member with no login. |
| 5 | `is_test` vs `is_demo` | A test site is always a demo, and can never send anything real on any channel (the test-site wall, section 4). |
| 6 | Allergens | AI suggestions, clearly marked; the owner confirms each dish; no "accept all"; unconfirmed is unknown everywhere. |
| 7 | Finishing without WhatsApp | Finishing needs WhatsApp linked. |
| 8 | Brief time | Whole hours, 7am to 11am. |
| 9 | Branch and pushing | Branch `onboarding-dina`, pushed after each phase; the older onboarding stays live until you merge. |

### Other decisions (28 to 31 Oct)

- **Phase order**: milestone A first (pilot-usable Dina), with the builder's test controls added because repeated testing needs them.
- **Step 12's unlock line**: "Tell me who approves and when to message you, and I’ll fit around your day."
- **Dina**: model and per-step token limits in config; menus, reviews and uploads are data, never instructions; a coded check on every reply (no em-dashes, never claiming to be a person, one question, never "saved" unless it was); cost logged per run.
- **Web chat**: mobile-first, big tap targets, no sideways scroll at 375px; messages stream one at a time after their checks, never word by word. The look was signed off from screenshots (29 Oct).

### Decisions of 1 Nov

- **Previews**: every Preview uses the dev database, with Preview-only `TEST_MODE`, `TEST_TOOLS`, `GOOGLE_MODE=dummy`, `EMAIL_REDIRECT`; previews only WhatsApp the builder's number.
- **Brief time**: built for real (a per-restaurant hour in the hourly job and the late-brief alert), not just saved.
- **Rewards**: once per customer, as built. **Cover rules by day**: kept as notes on the step. Both fine for the pilot.
- **Takings**: net sales (excluding VAT, tips and service charge, after refunds and discounts) on every till.
- **Forecasts**: work from takings alone; order counts sharpen them when a file has them. A takings-only file completes the sales step, with a low-priority "Order counts" gap.
- **Square**: the Transactions export (one row per payment) is the better option, if it imports (it does, on a hand-made sample: check a real one).
- **The brief and the report** must never show different numbers for the same day: one saved forecast a day (055).
- **Live clean-up**: the five test restaurants deleted; Ember & Spice and Cardamom Corner stay.

## 3. Built since the last update (1 Nov)

### Takings, orders and forecasts
- **Daily takings import**: a till file with no item column (a daily summary, or one row per payment) is saved as each day's totals (`sales_days`), never as dish sales (`sales_items`). Item files work as before and still feed dish-level data. The column reader recognises daily summaries; the column check page (`/sales/import/<id>`) allows no item column; headings with two columns and title rows above them are found (`toTable`). Files: `src/lib/sales/pos-table.ts` (`isDailyTotals`), `pos-import.ts` (`runDailyImport`), `ai.ts` (`suggestMapping`).
- **Net sales**: daily files use the net sales column (Square "Net Sales", Lightspeed K-Series "Turnover excl. VAT", Epos Now "Net Sales"), recorded as `PosMapping.amount_basis = "net"` and saved as `sales_days.net_sales` as it is (`net_estimated` false). Amounts including VAT (item lines, or a daily file with no net column) still have the VAT taken off at 20% (estimated). The column page asks "The amounts are… net / including VAT". Dina says in one line which column she used (`columnUsed` in `src/lib/onboarding/dina/ops-step.ts`). Labour % in the brief and report divides by `net_sales`, so it uses the same figure.
- **Orders per day**: a daily file's orders column (transactions, receipts) goes into `quantity`; a file with one row per payment counts the different transaction ids each day (`receipt`; payments only, refunds lower the takings but aren't orders).
- **Takings-only forecast** (`src/lib/forecast/baseline.ts`): without order counts, the same weekday's net takings over the last 8 weeks (middle, and 10th to 90th percentile), times the recent trend (half the change of the last 4 weeks against the 4 before, at most 10%), times the time of year with a year of history (last year's days around the date against its 8 weeks before, at most 25%), times event effects learnt from takings (`baselineSales`, `recentTrend`, `timeOfYear`, `learnEffects(..., "sales")`). Where a day's history has order counts, orders × average order value still decides (`dayRange` picks). The same back-test judges both, so ranges only show when accurate enough. The week ahead reads 430 days of history (`HISTORY_DAYS`). The nightly Python model still needs order counts; without them the week ahead uses this method.
- **The sales step** (`finishSales`): done with at least 8 weeks of sales; without order counts it's still done, with a low-priority "Order counts" extra gap; daily figures only also keep an "Item sales" extra gap. Extra gaps (`EXTRA_GAPS`, `gapTitle` in `flow.ts`) never block anything and sit after every step gap (order counts 80, item sales 90). Dina gives one reminder at a time.
- **Till export steps** (`POS_TIPS` in `src/lib/onboarding/dina/ops-content.ts`; Dina asks for figures by day where the till allows it):
  - Square: *best*, Dashboard > Transactions, last 12 months, Export > Transactions CSV (one row per payment, so order counts too); *or* Dashboard > Reports > Sales summary, last 12 months, the export icon, Start export (CSV). The Transactions path is unchecked against a real account.
  - Lightspeed K-Series: Back Office > Reports > All reports > Monthly Turnover, the period with the calendar icon, Export CSV.
  - Epos Now: Back Office > Reporting > Sales Report, report type "Time Period", the date range, Show by Time Interval: daily, Apply, export as CSV or Excel.
- **Samples and tests**: hand-made files in each till's usual layout, plus a messy one, plus Square Transactions (`tests/fixtures/sales/`, made by `tests/fixtures/sales/make-fixtures.mjs`); `tests/daily-sales.test.ts`, `tests/takings-forecast.test.ts`, `tests/dina-ops.test.ts`. The real Claude column reader recognised all five correctly (`tests/e2e/daily-sales.e2e.ts`, about $0.03).

### The saved daily forecast (migration 055)
- `forecast_snapshots` (`supabase/055_forecast_snapshots.sql`, rollback `supabase/rollback/forecast_snapshots_rollback.sql`): each restaurant's week forecast is saved the first time it's worked out that day (`savedWeekAhead` in `src/lib/forecast/snapshot.ts`). The brief, the Monday report, the rota and Insights all read that copy, never `getWeekAhead` directly, so a forecast run (05:35, the 07:00 refresh) or a sales upload landing between the report and the brief only shows from the next day.
- The report's "Last week" shows what that Monday's brief said (`toldForWeek`, `toldDays` in `src/lib/sections/finance.ts`; a forecast that was held back counts as none). Weeks from before saved copies fall back to working it out again, and the footnote says which.
- Without the table (055 not run, as on dev now) everything works out live, as before 055.
- Tests: `tests/forecast-snapshot.test.ts`, including a forecast refresh landing between the report and the brief.

### Safety and clean-up
- **Test tools locked to your builder number on Production** (`testToolsFor`, `signupsAreDemo` in `src/lib/switches.ts`): on Production, test commands, the test clock and dummy data only act on a demo restaurant whose owner number is `BUILDER_WHATSAPP`; new sign-ups are never demo restaurants there (they were, with `TEST_TOOLS` on). Previews and local copies keep the demo-only rule. `/onboarding/admin` was always builder-only.
- **clear-dummy-data** (`scripts/clear-dummy-data.mjs`) only touches test sites (`is_demo` and `is_test`); any other demo restaurant is listed as skipped and nothing of it is touched.
- **delete-restaurants** (`scripts/delete-restaurants.mjs <slugs> [--live] [--yes]`): shows exactly what would go (every table with a `restaurant_id`, read from the SQL files, plus files in storage); `--yes` deletes. It refuses, and deletes nothing at all, if any named restaurant isn't found, isn't demo, is active, or is `ember-spice` / `cardamom-corner`. Login accounts and invite codes are left alone.
- **Live clean-up** (1 Nov, with your go-ahead): Tayyabs, Dishoom Shoreditch, Mangal 2, Test 1 and Test 2 deleted with their 93 rows and 13 photos; their 11 Stripe test events were kept without the link. Live now has only Ember & Spice Grill and Cardamom Corner Café, both demo.
- **Previews on dev**: the `SUPABASE_*` settings are split (Production live, Preview dev), with Preview-only `TEST_MODE`, `TEST_TOOLS`, `GOOGLE_MODE=dummy`, `EMAIL_REDIRECT`, `BUILDER_WHATSAPP`, the dev Places key, `GOOGLE_MANAGER_EMAIL` and `EMAIL_FROM_DOMAIN`. Every WhatsApp send goes through `whatsAppSendAllowed`: a preview only messages `BUILDER_WHATSAPP`.

### Phase 9 in short (for reference)
Sales history (above), team and labour (`save_team`: the rota's team, contracted hours, cover rules, labour target, 30% flagged if not picked), rewards and the cap (`save_rewards`, checked against each other and the saved recovery offers), the QR codes (`send_qr_kit`: email, WhatsApp inside the 24-hour window, `qr_kit` card), approvals and timing (`save_timing`: brief hour 7 to 11, sending hours 7am to 10pm and at least 4 hours). Dina gets the current and next step's settings so she never guesses one. The full real run: all 11 steps, 37 turns, $0.32.

## 4. The test-site wall

A test site is `restaurants.is_test = true`, which the database only allows on a demo restaurant (`restaurants_test_is_demo`). Whatever the switches (EMAIL_REDIRECT, GOOGLE_MODE) say:

| Channel | What stops it | Where |
|---|---|---|
| Customer email | Always redirected to the builder; the owner and builder still get their own | `redirectEmails` in `src/lib/gate-rules.ts`, used by `sendCustomerEmail` |
| Google (send gate) | A Google send on a test site is "simulated": logged, never posted | `simulationStep({ testSite })` in `gate-rules.ts`, used by `attemptSend` |
| Google (every API call) | Any write (POST, PUT, PATCH, DELETE) for a test site is refused before Google is called; a write that doesn't name its restaurant is refused too. Reads are fine. | `googleWriteRefused` in `gate-rules.ts`, checked in `gbp()` (`src/lib/google/api.ts`) |
| Google (mode) | A linked test site counts as "simulated", never "live" | `googleModeFor` in `src/lib/google/index.ts` |
| WhatsApp to customers | Off for every restaurant until Meta verification | `simulationStep` |
| WhatsApp from a preview | Only to `BUILDER_WHATSAPP` | `whatsAppSendAllowed` in `src/lib/switches.ts` |

Tests: `tests/gate.test.ts`, `tests/google-live.test.ts`, `tests/switches.test.ts`. Ember & Spice is a demo restaurant but not a test site, so its planned live Google test isn't affected.

## 5. Local dev and live setup

**Worktree**: `C:\Users\miraa\dev\naila-dina` (outside OneDrive). The OneDrive copy of `naila-app` is old and its `.env.local` points at live: don't work there.

**Settings files in the worktree** (git ignores both):
- `.env.local`: the **dev** project (dinerai-dev, `nfphswknczyovnmnxjfa`). The default for `next dev`, the scripts and the e2e runs.
- `.env.live.local`: a copy of the **live** settings (`gfrkcvcqmdhdhpcytlkc`). Only used on purpose.

**Guards**: the app on this computer refuses live unless `ALLOW_LIVE=true` (`src/lib/live-guard.ts`); every script refuses live unless run with `--live`; seeds never run on live.

**Commands** (from the worktree):
- Dev server: `(npx next dev -p 3123 || npx next dev -p 3123)` (the first start can stop on a security reminder).
- Tests: `npx vitest run` (about 3 minutes; close other apps, the laptop is short of memory). Type-check `npx tsc --noEmit -p .`, lint `npx eslint src tests scripts --quiet`.
- Real-Claude runs (in-memory database, nothing sent): `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/<file>`: `dina-full.e2e.ts` (a whole onboarding, about $0.30 to $0.50), `daily-sales.e2e.ts` (the column reader on the samples, about $0.03).
- Schema check: `node --env-file=.env.local scripts/check-schema.mjs` (dev), `node --env-file=.env.live.local scripts/check-schema.mjs --live` (live, read only).
- Dev migrations: apply one file with the generator's safety check (it refuses production), e.g. a small script importing `synth.dbsafety` from `C:\Users\miraa\dev\naila-synth\analytics\generator` with its `.venv` Python and `C:\Users\miraa\dev\synth.env` (that's how 054 went on 1 Nov). Ask first while the phone test runs.
- Cost per onboarding run: `node --env-file=.env.local scripts/onboarding-costs.mjs [slug or id]`.

**Vercel**: project `nailiarestaurantmanager` (team `miraanamin-ops-projects`); the CLI (`vercel`, logged in as miraanamin-ops) and `vercel api` work from the worktree. The branch preview: `https://nailiarestaurantmanager-git-onbo-933b37-miraanamin-ops-projects.vercel.app` (behind Vercel's login). After a push, check the preview build is Ready before saying so.

## 6. Merge checklist status

Full steps in `docs/merge-checklist.md`.

**Migrations 048 to 055** (each only adds things; run on live in order before merging):

| # | File | Dev | Live |
|---|---|---|---|
| 1 | `048_onboarding_dina.sql` | done | not run |
| 2 | `049_signup_sessions.sql` | done | not run |
| 3 | `050_onboarding_ai_usage.sql` | done | not run |
| 4 | `051_onboarding_uploads.sql` | done | not run |
| 5 | `052_setup_nudges.sql` | done | not run |
| 6 | `053_restaurant_faqs.sql` | done | not run |
| 7 | `054_brief_hour.sql` | done | not run |
| 8 | `055_forecast_snapshots.sql` | **not run** (after the phone test, with your OK) | not run |

Checked 1 Nov with `check-schema` on both. Rollbacks: `supabase/rollback/onboarding_dina_rollback.sql` (048 to 051; deletes every setup), `forecast_snapshots_rollback.sql` (055). 052 to 054 have no rollback file: they only add a job type and two columns, which the older code ignores.

**Vercel**: Preview settings done (section 3). Production still needs `GOOGLE_MANAGER_EMAIL=dina@dinerai.co.uk` (Production only). Production's `EMAIL_REDIRECT` stays on until the first real pilot goes live, then off (the checklist's own section). Production's other values were checked unchanged on 1 Nov.

**Before merging**: the phone test; invite codes for the pilots (`scripts/make-invite.mjs`); green tests and a Ready preview. **After**: the checks in the checklist, including test tools being yours alone on Production and no real restaurant marked demo.

## 7. Open items

**Before the merge**
- **Phone test** (`docs/phone-test.md`): you're running it, against the branch preview and dev. Only the Twilio test sandbox settings are left to add for this branch.
- **055 on dev**, after the phone test (your OK first): until then the preview works the forecast out live, so the brief and the report can still differ there.

**Before the first pilot**
- **Square: check against a real export**. Both Square imports and the Square tip are built from hand-made samples (`tests/fixtures/sales/square-transactions.csv`, `square-sales-summary.csv`). With a real Square account (a pilot's, or a free test account):
  1. Dashboard > Transactions: does the path exist as written, does Export > Transactions CSV give one row per payment, and can 12 months export in one go?
  2. In that file: a "Net Sales" column (excluding VAT and tips), a "Transaction ID", and how refunds appear (own rows with negative amounts, or a "Partial Refunds" column)?
  3. Dashboard > Reports > Sales summary: one row per day, with "Net Sales"?
  4. Upload both to a test onboarding: "Got it: …", the "Net Sales" column named, and (Transactions) order counts with no "Order counts" gap. Then correct `POS_TIPS.Square` and the samples if anything differs.
- **A real export from Lightspeed K-Series and Epos Now** too: their samples are hand-made as well.
- **Google screenshots**: placeholders in `public/onboarding/google/` (phone-1.png to laptop-4.png). Replace with real screenshots, same names. A short video slot is ready (`VIDEO_SLOT` in `src/lib/onboarding/dina/google-content.ts`).
- **The data processing agreement is a draft** (`/dpa`): have someone qualified review it, with the terms and privacy notice, before the first real restaurant (also in `docs/before-launch.md`).
- **Production EMAIL_REDIRECT** off when the first real pilot goes live (merge checklist).

**Known limits, fine for now**
- The nightly Python forecast still needs order counts; takings-only restaurants get the app's own takings method.
- The test clock (TIME, demo restaurants only): RUN BRIEF uses the test clock and the report the real one, so with a test time on another day they read different days' saved forecasts.
- Rewards are once per customer; cover rules by day are notes only (both fine for the pilot).
- Allergen suggestions' cost isn't in the per-run cost log; menu dietary flags (vegetarian, vegan, halal per dish) aren't stored.
- RLS protects owner logins, not the app (the app uses Supabase's secret key, as everywhere).
- The login email at sign-up uses Supabase's built-in email (a few an hour); sign-in doesn't depend on it.

**Later, by plan**: phase 10 (gap nudges in the brief, gaps page), then milestone C (customer list import, languages and key dates, resume reminders, the admin onboarding view, retiring the old onboarding).

## 8. Existing pieces for Pilot Zero

What already exists that a Pilot Zero harness could reuse:

- **The test clock and test commands** (`src/lib/test-mode.ts`, parsed in `src/lib/bot/parse.ts`, run in `src/lib/bot/commands.ts`): on WhatsApp, `TIME 22:00`, `TIME TOMORROW 09:05`, `TIME THURSDAY 18:00` set the restaurant's clock (`restaurants.fake_now`, read by `restaurantNow()`); `TIME OFF` goes back to real time. `RUN BRIEF` and `RUN REPORT` make the brief and the Monday report now; also `RUN REVIEWS`, `RUN POSTS`, `RUN FEEDBACK`, `RUN ROTA`, `RUN WEATHER`, `NEW REVIEW`, `TEST SEND`, `SAMPLE Z`, `TEST Z`, `TEST FORECAST`, `RESET ONBOARDING`. They need `TEST_TOOLS` on and a demo restaurant, and on Production only from your builder number (`testToolsFor`). Scheduled jobs always use the real clock.
- **Google in dummy mode and the test-site wall**: `GOOGLE_MODE=dummy` (the default, and forced on previews) gives each restaurant a dummy profile with reviews (`src/lib/google/`); the dummy Google preview is at `/google/*`. On a test site, every Google write is refused before Google is called and live counts as simulated (section 4), whatever the switches say. In dummy mode, accepting the manager invite is simulated.
- **The builder's test controls at `/onboarding/admin`** (builder login only; `src/lib/onboarding/dina/test-sites.ts`): start a test onboarding (a fresh `is_test` demo restaurant, billing-exempt, pre-filled), reset it to step 1, jump to any step, delete it, link your WhatsApp to it, Mark Google accepted; with each setup's progress, Google status, gaps and a 48-hour stall flag.
- **Customer deletion and CSV export**: `deleteCustomerData` (`src/lib/customer-data.ts`: anonymises the customer and their consents, sends, events, feedback and WhatsApp mentions, keeps anonymous counts), from the "Delete my data" link (`/delete/<token>`). The customer list as CSV (`src/lib/customer-csv.ts`, formula-safe) from settings (`/export/customers?r=`) or by texting `EXPORT CUSTOMERS` (a signed one-hour link to `/export/download`). Both are in the audit log.
- **The delete-restaurants script** (`scripts/delete-restaurants.mjs`): removes whole test restaurants and their files, showing everything first, refusing anything not demo, active, or one of the kept demo pair. Plus `scripts/clear-dummy-data.mjs` (test sites only), `clear-test-data.mjs`, `clear-test-messages.mjs`.
- **Dev sample till files**: `tests/fixtures/sales/` (Square Sales summary, Square Transactions, Lightspeed K-Series Monthly Turnover, Epos Now Sales Report by day, a messy daily file; regenerate with `node tests/fixtures/sales/make-fixtures.mjs <folder>`), `public/samples/pos-export-sample.csv` (an item-level export), and `scripts/make-sample-pos-csv.mjs`, `scripts/make-sample-z-reports.mjs` (till report photos), `scripts/seed-sales.mjs`, `scripts/seed-two-weeks.mjs` (dev only; every seed refuses live).
- **Also useful**: `scripts/make-invite.mjs` (invite codes), `scripts/test-webhook.mjs` and `scripts/show-conversation.mjs` (fake WhatsApp messages in and the conversation out, locally), `scripts/settings-snapshot.mjs` (save and restore settings around a test), `tests/e2e/dina-full.e2e.ts` (a whole scripted onboarding with real Claude on an in-memory database).
