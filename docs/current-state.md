# DinerAI: current state of the codebase

Audit date: 19 Oct 2026. Code audited: `origin/main` at `87d545b` (PR #24, "Outside data feeds"), in a fresh detached worktree at `C:\Users\miraa\dev\naila-audit`. No OneDrive copy was used. The previous audit (14 Oct, `5cee9f8`) is kept as `docs/current-state-previous.md`.

How statuses were decided: from the code path, not the docs. LIVE and DUMMY mean the code is wired end to end to that service and covered by tests that use stand-ins; no live service was called. The Twilio WhatsApp sandbox counts as a sandbox, so a flow that only reaches the owner over WhatsApp is at best DUMMY. Production facts (switch values, migrations, queue, feeds, model runs, row counts) come from read-only SELECT queries against the production Supabase project on 19 Oct 2026 at about 22:10 UK, with no customer personal data read out. Anything still unconfirmed is marked UNVERIFIED and listed in section J.

Production at a glance (19 Oct): 7 restaurants, 2 active (`ember-spice`, `cardamom-corner`), all 7 `is_demo`; 55 customers (28 seeded); every hourly (168) and daily (7) cron run in the last 7 days finished ok; 1 dead job (a Growth agent job, invalid output twice).

## A. Summary

- The owner side is unchanged since 14 Oct: WhatsApp sandbox chat with Claude, Approve/Edit/Skip on every draft, 9am brief, 1 to 3 star alerts, PAUSE/RESUME/UNDO, Monday report, onboarding on web or WhatsApp. Nothing new reaches an owner yet; all new work since the last audit is behind the scenes.
- Customer email (QR sign-up, double opt-in, one-time rewards, campaigns, post-visit feedback, export and delete) is still the most real part, sent through Resend from mail.dinerai.co.uk.
- Google is still dummy only: `src/lib/google/live.ts` throws on every call, and the new GOOGLE_MODE "simulated" setting uses that same stub, so it would also fail.
- A Postgres job queue now runs all scheduled and owner work per restaurant (`src/lib/queue/`, `supabase/027`, `028`), with retries, dead jobs, builder alerts and a simulated 50-restaurant Monday in tests. TEST_MODE is split into five switches (`src/lib/switches.ts`).
- A full operations schema exists (menu in dishes, recipes, staff, rotas, costs, invoices, targets, deals, model outputs, outside factors: `supabase/030` to `038`, `041`), with RLS policies on the new tables. Apart from the menu, the outside feeds and model outputs, nothing in the app writes to these tables: the helper files for recipes, staff, rotas, costs and model outputs (`src/lib/ops/recipes.ts`, `staff.ts`, `costs.ts`, `models.ts`) are imported by nothing.
- A Python analytics service (`analytics/service`) runs a benchmark forecast and a real demand forecast (`forecast_daily` 1.1.0, negative binomial, 56 days daily and 14 hourly, low/likely/high, 12-week and long back-tests, pass bar). It passes on synthetic data in dinerai-dev. In production it ran on schedule on 19 Oct for both demo restaurants (Railway worker, first attempt each) but **`passed` was false for both**. **No app code reads `forecasts`**, so no owner sees a forecast, and nothing (brief, rota, offers) uses one.
- Production switches (recorded on every cron run): EMAIL_REDIRECT on, **TEST_TOOLS on**, GOOGLE_MODE dummy, AGENTS_LIVE_ALLOWED true (all), ANALYTICS_JOBS on. `ember-spice` runs GM, Growth and Insights live. Production is set up as a test bed, not for real restaurants.
- `025_billing.sql` and `026_onboarding_v2.sql` from the unmerged branches have already been run on the production database (14 Oct).
- Outside data feeds fill themselves on the queue: Open-Meteo weather, gov.uk bank holidays, calculated Ramadan/Eid/Diwali/paydays, prayer times, football-data.org fixtures, Ticketmaster events, TfL disruption, builder-entered school terms (`src/lib/feeds/`). Several of these free tiers forbid or don't clearly allow commercial use (`docs/before-launch.md`).
- Type-check, lint and all 60 app test files pass (930 passed, 1 skipped) with switches unset and with TEST_MODE=true; analytics service ruff clean and 114 tests pass; generator 20 tests pass.

## B. Changes since last audit (14 Oct, `5cee9f8`, 717 tests)

| Area | Change | Evidence |
|---|---|---|
| Switches | TEST_MODE split into EMAIL_REDIRECT, TEST_TOOLS, GOOGLE_MODE (dummy/simulated/live), AGENTS_LIVE_ALLOWED, ANALYTICS_JOBS; each cron run records them | `src/lib/switches.ts`, `supabase/025_job_switches.sql`, `tests/switches.test.ts` |
| Old risk 4 fixed | Agents can go live (AGENTS_LIVE_ALLOWED=true) without redirecting customer email | `agentLiveAllowed`, `effectiveAgentMode` in `switches.ts` |
| Job queue | Hourly job now only queues work; workers run it with retries 1/5/15/60 min, dead jobs, concurrency keys, priorities; owner messages queued too | `src/lib/queue/*`, `src/app/api/jobs/work/route.ts`, `supabase/027_job_queue.sql`, `028_queue_schedule.sql` |
| Old risk 2 mostly fixed | One slow restaurant no longer blocks others; a simulated 50-restaurant Monday has every brief out by 9:13 (test) | `tests/queue-sim.test.ts` |
| Ops schema | 46 new tables for menu, recipes, sales detail, staff, rotas, costs, deals, model outputs, outside factors; menu moved into `dishes` behind a guard trigger | `supabase/030` to `038`, `src/lib/ops/`, `docs/data-model.md` |
| RLS | Policies now exist on the new ops and feed tables (owner-email based); the older app tables still have RLS on with no policies | `ops_apply_policies` in `030_ops_foundation.sql` |
| Synthetic data | Python generator: four demo restaurants, 24 months, known effects, messy input files, loads only into dev or demo | `analytics/generator/`, `synth/dbsafety.py` |
| Analytics service | Python worker on the queue as `queue_worker`; `forecast_baseline` (benchmark) and `forecast_daily` (production) models; Railway config | `analytics/service/`, `supabase/036`, `039`, `040` |
| Outside feeds | Weather, calendar, prayer, football, events, disruption, school terms, backfill as queue jobs; /feeds and /feeds/terms builder pages | `src/lib/feeds/`, `src/app/feeds/`, `supabase/041_outside_feeds.sql` |
| Owner chat | New `add_local_event` tool ("there's a fair on Saturday"); `rename_dish` change by message | `src/lib/assistant.ts`, `src/lib/feeds/owner-events.ts` |
| Old weather job | Now a no-op that says it moved to `feed_weather` | `src/lib/queue/handlers.ts` `weather` |
| Tests | 48 to 60 app test files, 717 to 930 tests; new Python suites in CI | `.github/workflows/ci.yml` (jobs `generator`, `analytics-service`) |
| Status moves | 2.1 NOT PRESENT to PARTIAL; 2.3 NOT PRESENT to DUMMY; 3.1 to 3.4, 4.1, 4.2, 6.3 NOT PRESENT to STUB (schema only); 11.3 renamed to switches | sections C and 13 |

## C. Checklist

### 1. Owner experience

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 1.1 | WhatsApp assistant that answers questions on the restaurant's data | DUMMY | Owner chats with Sonnet, which gets profile summaries and look-up tools, and can draft, run campaigns, change details and add local events | `src/app/api/whatsapp/route.ts` > queue `owner_message` > `src/lib/bot/index.ts` handleMessage > `src/lib/assistant.ts` | Twilio sandbox, Anthropic live | Sandbox only; owner_message has 1 attempt (`027` job_types), so a failure is "Sorry" with no retry |
| 1.2 | 9am morning brief (forecast, yesterday's numbers, approvals) | PARTIAL | Numbered approvals with buttons, APPROVE ALL, "done for you" tally, missing till report nudge; now the last step of a queued chain | `src/lib/morning.ts`, `src/lib/brief.ts` composeBrief, `src/lib/queue/rules.ts` MORNING_STEPS | Twilio sandbox | No forecast (forecasts exist in the database but `brief.ts` never reads them); no yesterday's sales figures; waits outside WhatsApp's 24h window |
| 1.3 | Urgent alerts (1 to 3 star review, quiet night forecast, cash warning) | PARTIAL | 1 to 3 star reviews and private feedback alert at once with a drafted reply | `src/lib/google-jobs.ts` runReviewCheck, `src/lib/feedback.ts` submitFeedback | Dummy Google, Twilio sandbox | No quiet night alert (forecast unused); no cash warning |
| 1.4 | Monday report | DUMMY | Web page and PDF: sales, reputation, themes, customers and campaigns, Google, headline, 3 actions, week vs week | `src/lib/report/build.ts` DATA_SECTIONS, `src/app/report/[token]/page.tsx`, `src/lib/report/pdf.tsx` | Anthropic live, Google dummy, Twilio sandbox | No forecast section; Google numbers never real |
| 1.5 | Monthly sales report (what, why, 3 actions) | NOT PRESENT | Nothing | none | none | Not built |
| 1.6 | Trust ladder per task (Draft only, Approve, Auto), manual switch | PARTIAL | Per-task levels stored and enforced at send time; builder sets them | `src/lib/trust.ts` gateApproval/NEVER_AUTO, `src/app/settings/actions.ts`, `supabase/019_trust_levels.sql` | none | Owner can't switch it; Auto needs a live checker pass |
| 1.7 | Trust ladder auto-promotion from approval history | NOT PRESENT | Nothing | none | none | Not built |
| 1.8 | Learning from approvals, edits and rejections | PARTIAL | Last 15 edits and skip reasons plus last 5 approved drafts go into prompts | `src/lib/drafts.ts` getLearningContext, `draft_feedback` table | Anthropic live | Prompt stuffing only; nothing drops ignored suggestions; profile-keeper has no code |
| 1.9 | "What I did for you" tally | DUMMY | One brief line counting replies, posts, emails, sign-ups, redemptions | `src/lib/brief.ts` doneTally/tallyLine | Twilio sandbox | Counts dummy Google activity as done |
| 1.10 | Onboarding: brand voice, menu photo to dish list, Google connect, customer import, staff list and pay rates, 12-month till history | PARTIAL | 6 skippable steps on web or WhatsApp: Places look-up, menu photos to dishes (now saved into `dishes`), allergens, voice, reward and cap, QR pack | `src/lib/onboarding/engine.ts`, `steps.ts`, `src/lib/ops/menu.ts` saveMenu | Anthropic live, Places live if key, Twilio sandbox | No customer import; staff and pay tables exist but onboarding never fills them; "last year's sales" step only on unmerged `onboarding-v2` |
| 1.11 | Web app for setup, settings, reports | LIVE | Magic-link login; onboarding, settings, /sales, /report, /log, builder-only /feeds | `src/proxy.ts`, `src/lib/hosts.ts` needsLogin, `src/app/settings/page.tsx`, `src/app/feeds/page.tsx` | Supabase Auth live | Supabase built-in login email limited to a few an hour |
| 1.12 | Manager logins and second approver | NOT PRESENT | Only `owner_email` or BUILDER_EMAIL can log in | `src/lib/auth.ts` | none | Not built |
| 1.13 | Multi-language messages (English, Urdu, Bengali, Arabic) | PARTIAL | GM detects English, Urdu script or Roman Urdu with fixed "on it" lines | `src/lib/agents/gm-rules.ts` languageOf/ON_IT_LINES | Anthropic live | Only via the GM (live in production on `ember-spice` only); no Bengali or Arabic; fixed text English only |

### 2. Forecasting

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 2.1 | Covers and sales by day and hour, shown as a range | PARTIAL | `forecast_daily` writes orders per channel, net sales and covers, 56 days daily and 14 hourly, low/likely/high, to `forecasts` | `analytics/service/src/dinerai_analytics/models/forecast_daily/` (forecast.py, hourly.py, ranges.py), `supabase/040_forecast_model.sql` | Python on Railway, production and dinerai-dev | Production: 178 forecast rows for the 2 demo restaurants (19 Oct), none from a passed run. Nothing shows it: `latestForecasts` in `src/lib/ops/models.ts` has no caller; real restaurants record no covers or channel splits, so those series only exist for synthetic data |
| 2.2 | Inputs (status per input) | PARTIAL | Till history: built (Z-report, POS). Bookings: NOT PRESENT. Weather: built (Open-Meteo feed, actuals and forecasts as issued). Local events: built (Ticketmaster 5 km, owner `add_local_event`, builder). Holidays: built (gov.uk). Ramadan and Eid: built (Umm al-Qura, builder confirms). Football: built (football-data.org). School holidays: partial (builder-entered councils, 3 seeded to Dec 2026) | `src/lib/feeds/config.ts` FEEDS, `feeds/jobs.ts`, `weather-data.ts`, `calendar-dates.ts`, `football.ts`, `ticketmaster.ts`, `school-terms.ts`, `tfl.ts` | Open-Meteo, gov.uk, football-data.org, Ticketmaster, TfL live (each succeeded in production on 19 Oct) | No bookings; school-terms check has never run; `ember-spice` is in Tower Hamlets (E09000030), which isn't one of the 3 seeded councils; no restaurant follows any team (`restaurant_teams` 0); Open-Meteo free tier is non-commercial |
| 2.3 | Back-testing before showing to owners | DUMMY | Every nightly run scores a 12-week rolling back-test and (every 28 days) a long back-test; `passed` only if it beats the baseline; app readers only keep passed production runs | `backtest.py`, `forecast_daily/evaluate.py` pass_bar, `src/lib/ops/models.ts`, restrictive policies `no_benchmark_runs` (039) | dinerai-dev synthetic data; production demo data | In production (19 Oct) both demo restaurants failed the bar (passed false), so the gate works; only proven to pass on synthetic data with effects the same author designed; pass bar was loosened on 18 Oct after two of four demo restaurants failed the first bar |
| 2.4 | Forecast feeding rota, specials, deals, quiet-night offers, stock | NOT PRESENT | Nothing reads forecasts; Growth's quiet days still come from 8 weeks of actual sales | `src/lib/agents/quiet-times.ts` | none | Not built |

### 3. Rota and staff costs

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 3.1 | Suggested rota from forecast | STUB | Tables only: staff, roles, skills, contracted hours, availability, time off, pay rates, cover rules, suggested rotas | `supabase/032_ops_sales_staff_rota.sql`, `035_ops_models.sql` suggested_rotas, `src/lib/ops/staff.ts` (imported by nothing) | none | No model, no flow, no UK working time rules in code |
| 3.2 | Rota cost shown before approval | STUB | `suggested_rotas` has total cost and labour % columns | `035_ops_models.sql` | none | Nothing computes or shows it |
| 3.3 | Daily staff cost % vs target | STUB | `targets` (labour %) and `finance_snapshots` tables exist | `033_ops_costs_deals.sql`, `035_ops_models.sql` | none | Nothing writes or reads them |
| 3.4 | Actual vs planned hours from rota photo or rota-app export | STUB | `shift_actuals` with source photo/export | `032_ops_sales_staff_rota.sql`, `ops/staff.ts` | none | No photo reader, no import |

### 4. Menu, pricing and deals

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 4.1 | Dish cost from recipe | STUB | Ingredients, recipe versions and lines, ingredient prices, `ingredient_price_on` SQL | `031_ops_menu.sql`, `033`, `src/lib/ops/recipes.ts` (imported by nothing) | none | No UI, flow or calculation in use |
| 4.2 | Menu engineering | STUB | `menu_analysis` table with star/plowhorse/puzzle/dog | `035_ops_models.sql` | none | No model; report still only shows top 5 items |
| 4.3 | Price suggestions vs nearby rivals | STUB | `get_public_rivals` named in Insights' prompt, no code | `agents/insights.md` | none | Declared only |
| 4.4 | Deal checker and deal tracking | PARTIAL | Tracking: sent, opened, clicked, redeemed per campaign; `forecast_daily` has a factor per deal; `deal_outcomes` table | `src/lib/campaigns.ts` campaignStats, `033` deal_outcomes, `ops/models.ts` recordExpectedUplift (no caller) | Resend live | No break-even maths; nothing writes `deal_outcomes` |
| 4.5 | Weekly "what staff should recommend" | NOT PRESENT | Nothing | none | none | Not built |

### 5. Specials, stock and waste

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 5.1 | Specials from stock in hand with margin | PARTIAL | Growth suggests up to 2 special ideas on Mondays from menu dishes | `src/lib/agents/growth.ts` mondayGrowth | Anthropic live | Growth is live in production only on demo `ember-spice`; no stock or margin input |
| 5.2 | Trend ideas matched to the kitchen | STUB | `get_trends` tool returns an empty list | `src/lib/agents/tools.ts` | none | No trend source |
| 5.3 | Waste and use-by tracking | NOT PRESENT | Only a waste % per recipe line in the schema | `031_ops_menu.sql` recipe_lines | none | Not built |
| 5.4 | Order suggestions and supplier emails | STUB | `suppliers`, `invoices` tables; supplier email only as a one-off draft | `033_ops_costs_deals.sql`, `ops/costs.ts` (imported by nothing) | none | No ordering logic |

### 6. Books and finance

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 6.1 | Data in (status per input) | PARTIAL | Z-report photos: built. Till/POS exports: built (CSV/Excel, AI mapping). Supplier invoice photos: STUB (tables only, no reader). Fixed costs: STUB (table and `weeklyPence`, no UI) | `src/lib/sales/z-reports.ts`, `pos-import.ts`, `033_ops_costs_deals.sql`, `ops/costs.ts` | Anthropic live | POS import drops rows past 50,000 (`pos-table.ts` MAX_ROWS); 4 MB cap |
| 6.2 | Daily figures: sales vs forecast, staff cost %, food cost % | PARTIAL | Daily net/gross/VAT/transactions on /sales | `src/lib/sales/page-data.ts`, `src/app/sales/page.tsx` | none | No forecast, staff cost or food cost shown |
| 6.3 | Full finance: prime cost, weekly P&L, cash warnings | STUB | `finance_snapshots` and `targets` tables | `035`, `033` | none | No model or screen |
| 6.4 | Xero or QuickBooks sync | NOT PRESENT | Nothing | none | none | Not built |
| 6.5 | "Information, not financial advice" framing | LIVE | Footnote on report and /sales; Insights' rules block staffing, pay, loan and tax advice | `src/lib/report/types.ts` SALES_FOOTNOTE, `src/lib/agents/insights-rules.ts` ADVICE | none | Legacy assistant relies on its prompt only |

### 7. Reviews, Google and social

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 7.1 | Google review replies in house voice within 24h | DUMMY | Hourly queued check drafts replies: 4 to 5 star held for the brief, 1 to 3 star alerted | `src/lib/google-jobs.ts` runReviewCheck, `src/lib/agents/reputation.ts` | Dummy Google | `google/live.ts` throws; no 24h enforcement |
| 7.2 | Google profile (status per item) | PARTIAL | Posts: DUMMY. Photos: DUMMY (library, Visibility checks). Q&A: NOT PRESENT. Holiday hours: PARTIAL (saved, Google update only logged). Menu and hours updates: PARTIAL (approval logs "would have updated"). AI search visibility: NOT PRESENT | `google-jobs.ts` runPostJob, `src/lib/agents/visibility.ts`, `src/lib/send.ts` | Dummy Google | GOOGLE_MODE=simulated also uses the throwing stub |
| 7.3 | Paste-in fallback while Google API is pending | DUMMY | Owner pastes a review, gets a copy-paste reply | `src/lib/assistant.ts` draft_pasted_review_reply | Anthropic live, Twilio sandbox | Owner posts by hand |
| 7.4 | Tripadvisor and delivery app reviews | NOT PRESENT | Nothing | none | none | Not built |
| 7.5 | Weekly complaint and praise themes | PARTIAL | Reputation names themes, code counts them, shown in the report | `src/lib/agents/reputation-themes.ts`, `review_themes` | Anthropic live | Only over dummy or pasted reviews |
| 7.6 | Social: shoot briefs, captions, calendar, Instagram/Facebook posting, TikTok briefs | PARTIAL | Visibility writes a Monday content brief (3 shoot briefs) | `src/lib/agents/visibility.ts` contentBriefText | Anthropic live | Visibility is in shadow on every production restaurant; no posting, no Meta API |
| 7.7 | Growth: local events calendar, competitor watch, creator outreach, website and SEO check | PARTIAL | Local calendar now filled by feeds (events, sport, religious, school) plus builder and owner entries; Growth plans around it | `src/lib/local-calendar.ts`, `src/lib/feeds/`, `src/lib/agents/growth.ts` | Ticketmaster, football-data.org, gov.uk live | No competitor watch, creator outreach or SEO check |

### 8. Customers, offers and loyalty

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 8.1 | QR sign-up, reward per restaurant, double opt-in, one-time redemption | LIVE | Branded form, unticked consent, confirm email, welcome email with a 10-minute redemption screen | `src/app/r/[slug]/page.tsx`, `src/lib/signups.ts`, `src/app/api/confirm/[token]/route.ts`, `src/app/reward/[token]/` | Resend live, Turnstile live | EMAIL_REDIRECT on (or TEST_MODE=true) sends every customer email to the builder |
| 8.2 | Segments: regulars, lapsed, birthdays | PARTIAL | Everyone, birthdays in 7 days, unredeemed sign-ups | `src/lib/campaigns.ts` SEGMENTS/segmentRecipients | none | No visit history, so no regulars or lapsed |
| 8.3 | Email campaigns | LIVE | Drafted campaign with email picture, approve, unique offer link per customer | `src/lib/campaigns.ts` deliverCampaign, `src/lib/email/index.ts`, `src/lib/send.ts` attemptSend | Resend live | Resend free plan 100 a day |
| 8.4 | Post-visit feedback | LIVE | Email about 3h after redemption; Google link for all plus private form | `src/lib/feedback.ts`, `src/app/feedback/[token]/page.tsx` | Resend live | Maps search unless place id set |
| 8.5 | Quiet-night filler (detect, offer, report uplift) | PARTIAL | Owner says "Thursday is quiet" and gets a campaign; Growth detects quiet days from history (shadow) | `assistant.ts` create_email_campaign, `src/lib/agents/quiet-times.ts` | Resend live | No forecast-based detection; no uplift report |
| 8.6 | Revenue per campaign | PARTIAL | Unique one-time token per recipient; opens, clicks, redemptions counted | `campaign_sends.token`, `campaigns.ts` campaignStats | Resend live | No revenue, no till matching |
| 8.7 | WhatsApp loyalty stamp card | NOT PRESENT | Nothing; WhatsApp to customers blocked | `src/lib/gate-rules.ts` | none | Not built |
| 8.8 | Customer export and delete; opt-out; CAPTCHA | LIVE | Signed CSV export, "Delete my data" anonymises, unsubscribe in every email, Turnstile and rate limits | `src/lib/customer-data.ts`, `customer-csv.ts`, `src/lib/turnstile.ts`, `rate-limit.ts` | Resend live, Turnstile live | Turnstile skipped if keys unset |

### 9. Admin and operations

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 9.1 | Job ads, supplier emails, notices on request | DUMMY | Assistant writes a one-off "other" draft | `assistant.ts` create_draft (kind other) | Anthropic live, Twilio sandbox | Approving logs a simulated WhatsApp send |
| 9.2 | Hiring | NOT PRESENT | Nothing | none | none | Not built |
| 9.3 | Compliance reminders and allergen matrix synced to menu | PARTIAL | Allergens per dish (now on `dishes`), never shown to customers until confirmed | `src/lib/onboarding/profile-data.ts` customerSafeMenu, `dishes.allergens_confirmed` | Anthropic live | No reminders; no printable matrix |
| 9.4 | AI phone answering | NOT PRESENT | Nothing | none | none | Not built |
| 9.5 | Delivery apps | NOT PRESENT | Only a `channel_fees` table and a delivery channel in the schema | `038_ops_data_gaps.sql` | none | Not built |
| 9.6 | Local benchmarks | NOT PRESENT | Nothing | none | none | Not built |

### 10. Trust and safety

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 10.1 | GM/head chef with specialist agents (model, live/shadow) | PARTIAL | GM: router Haiku 5.5, composer Sonnet 5.5. Reputation, Visibility, Insights, Growth, checker: Sonnet 5.5. profile-keeper: Sonnet, defined, no code. Live only per restaurant when set live, ready, and AGENTS_LIVE_ALLOWED=true (Reputation also when unset) | `agents/*.md`, `src/lib/claude.ts` MODELS, `src/lib/switches.ts` agentLiveAllowed, `src/lib/agents/go-live.ts` agentStatus | Anthropic live | Production: AGENTS_LIVE_ALLOWED true; `ember-spice` GM, Growth, Insights live, Reputation, Visibility, checker shadow; `cardamom-corner` all defaults (shadow); 1 Growth job dead on 19 Oct (invalid output twice) |
| 10.2 | Separate checker agents (list) | LIVE | AI facts and tone checks (Sonnet), compliance and money checks (code), checker agent v0.3 (Sonnet, shadow on all drafts, blocking in live loops), plain-code price check | `src/lib/checks/index.ts`, `checks/ai.ts`, `compliance.ts`, `money.ts`, `src/lib/agents/checker.ts`, `src/lib/prices.ts` | Anthropic live | Misleading claims check is a word list |
| 10.3 | Code release gate (status per rule) | LIVE | Discount cap: LIVE (wording and structured offers). 9am to 9pm window: LIVE (queued until it opens). Consent: LIVE (re-checked at send). No double sends: LIVE (atomic claim plus unique indexes) | `src/lib/checks/money.ts`, `src/lib/offers.ts` offerCap, `src/lib/send.ts` attemptSend, `checks/compliance.ts`, `gate-rules.ts` | none | Unique indexes not exercised by tests against the real app schema |
| 10.4 | Escalate when unsure; never commits money without a yes | PARTIAL | Campaigns, offers, hours, menu, profile never Auto; question cards for risky reviews; GM asks "which did you mean?" | `src/lib/trust.ts` NEVER_AUTO, `reputation.ts` review_question, `gm-live.ts` | none | Escalation cards need agents live |
| 10.5 | Audit log, UNDO, PAUSE | LIVE | Every action logged; UNDO reverses the last owner action; PAUSE holds sends; builder job retries logged | `src/lib/audit.ts`, `undo.ts`, `src/app/log/page.tsx`, `src/lib/queue/retry.ts` | none | UNDO can't recall sent emails |
| 10.6 | Watchdog alerting the founder | LIVE | Cron runs recorded; dead jobs (app and Python), backlog, stuck jobs, late briefs (9:31), stale or failing feeds alert the builder by email and WhatsApp | `src/lib/job-runs.ts`, `src/lib/queue/health.ts` checkQueueHealth/checkLateBriefs, `src/lib/feeds/status.ts` checkFeedHealth, `src/lib/builder-alerts.ts` | Resend live, Twilio sandbox | If pg_cron stops entirely only the 09:00 UTC Vercel backup notices; builder WhatsApp may not arrive outside 24h |
| 10.7 | Prompt changes tested against saved examples | PARTIAL | 90 saved cases: checker 15, GM 2 files (40 routing, 11 composer), Growth 18, Insights 20, Reputation 18, Visibility 17; replayed offline every push, live by hand | `agents/tests/*`, `tests/agents/`, `.github/workflows` Agent tests (workflow_dispatch) | Anthropic by hand | Dummy-data cases, not real examples; legacy prompts have none; profile-keeper 0; 1 case skipped |
| 10.8 | Data protection in code (incl. staff data) | PARTIAL | Consent records and customer deletion as before; staff tables hold no NI, address, bank or birth date; `forget_staff_member` and `apply_staff_retention` SQL exist; finished jobs cleared after 14 days, dead after 90 | `src/lib/customer-data.ts`, `032_ops_sales_staff_rota.sql`, `src/lib/queue/config.ts` RETENTION | none | Staff functions have no caller and no schedule; messages, drafts, audit log, photos and Ticketmaster content kept forever |

### 11. Behind the scenes

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 11.1 | Admin console (health, failed jobs, cost, impersonate) | PARTIAL | Builder sections on /log (switches, job runs, each restaurant's queue, dead jobs with Retry, agent comparisons), /feeds, settings builder controls and agent cost | `src/app/log/page.tsx`, `src/app/log/actions.ts`, `src/app/feeds/page.tsx`, `src/lib/agents/costs.ts` | none | No cross-restaurant overview; cost covers agent jobs only; no Railway or model-run view |
| 11.2 | Multi-restaurant (tenancy, isolation, RLS in force) | LIVE | Every query filtered by restaurant_id, enforced by a test that scans every `.from()` (now incl. ops tables); jobs per restaurant on the queue | `tests/isolation.test.ts`, `tests/support/owned-tables.ts`, `src/lib/send.ts` | Supabase | RLS policies exist only on the 43 ops and feed tables (plus a read policy on local_calendar) and the app bypasses them with the secret key, so no RLS is in force for the app; older tables have RLS on with no policies |
| 11.3 | Test mode and switches | LIVE | Five switches, safe defaults, test tools only act on demo restaurants, preview always redirects email | `src/lib/switches.ts`, `src/lib/test-mode.ts`, `tests/switches.test.ts` | none | TEST_MODE still read as a fallback; production has TEST_TOOLS on (safe only because every restaurant is a demo) |
| 11.4 | Stripe billing and tiers | NOT PRESENT | Nothing on main | none | none | Built on unmerged `website-billing` (Stripe trial, invite codes) |
| 11.5 | Growth tools: Google health check, referral credits, marketplace listings | NOT PRESENT | Nothing; dinerai.co.uk is a holding page | `src/app/site/page.tsx` | none | Landing page only on unmerged `website-billing` |

### 12. Built but not in the spec

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 12.1 | Staff WhatsApp numbers for sales data | DUMMY | ADD STAFF registers a number that can send till reports and files only | `src/lib/sales/staff.ts`, `src/lib/sales/whatsapp.ts` | Twilio sandbox | Each staff member must join the sandbox |
| 12.2 | Profile v1 with versions and Revert | LIVE | Versioned profile fields with per-field Revert | `src/lib/profile/fields.ts`, `profile/versions.ts` | none | None found |
| 12.3 | Shadow mode and agent comparisons | LIVE | Agent outputs saved beside today's for builder review | `shadow_drafts`, `src/app/log/agent-compare.tsx` | Anthropic live | Roughly doubles Claude spend while in shadow |
| 12.4 | Email previews and branded templates | LIVE | Per-restaurant React Email templates, picture on WhatsApp | `src/lib/email/templates.tsx`, `preview-image.tsx` | Resend live | Drawing, not a screenshot |
| 12.5 | Printable QR pack | LIVE | PDF table cards and counter sign | `src/lib/onboarding/qr-pack.tsx` | none | None found |
| 12.6 | Change details by message with UNDO (incl. rename dish) | DUMMY | "Change Friday hours", "rename X to Y" keep the dish's history | `src/lib/onboarding/profile-changes.ts`, `src/lib/profile-edits.ts`, `ops/menu.ts` saveMenu | Twilio sandbox | None found |
| 12.7 | Owner-told local events | DUMMY | "There's a fair on Saturday" becomes a confirm card and a restaurant calendar row | `assistant.ts` add_local_event, `src/lib/feeds/owner-events.ts` | Twilio sandbox | Nothing reads it except Growth and the model |
| 12.8 | Holding site and domain routing | LIVE | dinerai.co.uk holding page; old vercel.app redirects | `src/proxy.ts`, `src/lib/hosts.ts` | Vercel | None found |
| 12.9 | Public restaurant sign-up (/start) | LIVE | Turnstile, rate limits, inactive until onboarding finishes | `src/app/start/` | Turnstile live | Anyone can create inactive restaurants |
| 12.10 | Prayer times per restaurant | LIVE | Calculated (adhan) 60 days ahead, or a builder-uploaded mosque timetable that wins; 884 rows in production | `src/lib/feeds/prayer.ts`, `src/app/feeds/actions.ts` | none (local calc) | Used only by the forecast model and its hour profile |
| 12.11 | Dummy data and seed scripts | DUMMY | Demo restaurants, two weeks of activity, 12 months of sales, samples, clear-out (now incl. ops tables) | `scripts/seed-two-weeks.mjs`, `seed-sales.mjs`, `clear-dummy-data.mjs`, `clear_ops_dummy_data` (038) | none | None found |

### 13. Operations engine

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 13.1 | Switches (EMAIL_REDIRECT, TEST_TOOLS, GOOGLE_MODE, AGENTS_LIVE_ALLOWED, ANALYTICS_JOBS) | LIVE | Read only in `switches.ts`; safe defaults (redirect on, tools off, Google dummy, agents legacy/shadow, analytics off); recorded on every cron run | `src/lib/switches.ts` allSwitches/switchesRecord, `job_runs.switches` (025) | Vercel env | Production (every cron run on 19 Oct): EMAIL_REDIRECT on, TEST_TOOLS on, GOOGLE_MODE dummy, AGENTS_LIVE_ALLOWED all, ANALYTICS_JOBS on; source (setting or TEST_MODE fallback) not recorded |
| 13.2 | Job queue: dispatcher, workers, priorities, retries, dead jobs, external functions | LIVE | Dispatcher queues per restaurant; workers (3 lanes, 150s claim window) started every minute by pg_cron, by the hourly run and by webhooks; priority 0 owner, 10 morning before 9:30, 50 rest; retries 1/5/15/60 min; dead after max_attempts, builder told; `ext_enqueue_job`, `ext_claim_jobs`, `ext_complete_job`, `ext_fail_job`, `ext_extend_job`, `ext_release_job`, `ext_job_status` | `src/lib/queue/dispatch.ts`, `worker.ts`, `rules.ts`, `config.ts`, `supabase/027`, `028`, `039` | Supabase pg_cron + pg_net, Vercel | Production: 654 jobs done (finished jobs are cleared after 14 days), 1 dead, none waiting at audit time; owner_message has 1 attempt; per-type limits editable in `job_types` |
| 13.3 | Ops schema per group, and whether anything writes | PARTIAL | Menu and recipes: dishes/prices/renames/sections written by `save_menu` (45 dishes in production); recipes, ingredients, till matches nothing. Sales detail: covers and channel splits nothing. Staff and rotas: nothing. Costs: nothing. Deals: nothing. Model outputs: Python service. Outside factors: feeds. Restaurant events: nothing | `supabase/030` to `041`, writer map and production counts in section F | none | Production: every recipe, staff, rota, cost, deal, menu analysis, finance and restaurant event table has 0 rows |
| 13.4 | Menu move to dishes | LIVE | `dishes` is the source; `restaurants.menu` is a copy from `menu_json()`; all changes via `save_menu()`; trigger refuses other writes (037); new restaurants' menus copied in by trigger | `supabase/031_ops_menu.sql`, `037_ops_menu_guard.sql` ops_menu_guard, `src/lib/ops/menu.ts` saveMenu, `tests/ops-menu-app.test.ts` | Supabase | 031 ran 17 Oct 08:26 UTC, 037 at 09:20 UTC; 14 sections, 45 dishes in production |
| 13.5 | Synthetic data generator and dinerai-dev | DUMMY | Four demo restaurants, 24 months, known effects, messy POS/Z-report/invoice/rota files, `ground_truth.json`; refuses production unless `--allow-production` and the 3-week fixture | `analytics/generator/generate.py`, `load.py`, `synth/dbsafety.py` PRODUCTION_REF | dinerai-dev (Supabase, eu-west-2) | Not loaded into production (`sales_channel_splits`, `staff`, `invoices` all 0 there) |
| 13.6 | Analytics service: worker, registry, roles, hosting, deployment | LIVE | Worker claims its own job types, runs each in its own process with a time budget and heartbeats, finishes or fails via `ext_*`; registry of 3 specs; roles `queue_worker` = `analytics_reader` + `model_writer`; Dockerfile and `railway.json` | `dinerai_analytics/worker.py`, `registry.py`, `runner.py`, `models/__init__.py`, `supabase/036_ops_analytics.sql`, `analytics/service/railway.json` | Railway | Production: all 6 analytics jobs on 19 Oct claimed and finished on the first attempt; Railway plan UNVERIFIED (notes say free trial, 30 days or $5); README still says "Not deployed yet" |
| 13.7 | forecast_baseline and forecast_daily: version, pass bar, results | DUMMY | baseline (benchmark, 4-week same weekday, 14 days); forecast_daily 1.1.0 (production). Pass bar: orders/all no worse than baseline on 12 weeks and 10% better on the long back-test; big channels within 5%; 80% coverage 75% to 88%; bias under 5%; 8+ weeks of history. On dinerai-dev (17 Oct) all four demo restaurants pass | `models/forecast_baseline.py`, `forecast_daily/about.py` VERSION, `evaluate.py` pass_bar/PASS_LONG_IMPROVEMENT | dinerai-dev, production | Production 19 Oct, 12-week WAPE orders/all: `ember-spice` daily 0.0982 vs baseline 0.1028 (passed false), `cardamom-corner` 0.1124 vs 0.1152 (passed false); no production run has ever passed |
| 13.8 | Forecast refresh (07:00) and nightly schedule (05:35) | LIVE | Hourly run at 05:05 queues baseline and daily due 05:35; 07:05 run queues refresh (starts at once, days 0 to 2); 09:00 UTC backup queues missed ones; only while ANALYTICS_JOBS is on | `src/lib/queue/config.ts` NIGHTLY_MODELS, `rules.ts` plannedJobs, `dinerai_analytics/cutoff.py` | Railway, Supabase | Production 19 Oct: baseline and daily ran at 05:35 UK (8 to 26s each), refresh at 07:05 UK (about 10s); the refresh starts at 07:05, not 07:00 |
| 13.9 | Outside data feeds (source, schedule, last success, coverage) | LIVE | Weather: Open-Meteo ECMWF, 04:30 and 06:45 per 0.25 degree cell. Calendar: gov.uk plus calculated, 04:30. Prayer: adhan or timetable, 04:30 per restaurant. Football: football-data.org, 04:30. Events: Ticketmaster 5 km, 04:30 per restaurant. Disruption: TfL, 04:30. School terms: builder data check, 04:30. Backfill: on demand | `src/lib/feeds/config.ts` FEEDS/FEED_TIMES/plannedFeedJobs, `feeds/jobs.ts`, `feed_status` (041) | Each source live (keys: FOOTBALL_DATA_API_KEY, TICKETMASTER_API_KEY, optional TFL_API_KEY) | Last success (UK, 19 Oct): calendar 21:06, backfill 21:06, football 21:50, events 21:51, weather 21:51, prayer 21:51, disruption 21:51, all ok; school_terms never run. Production rows: weather_hours 18,384, weather_forecasts 43,188, weather_days 764, prayer_times 884, calendar 1,729 (283 Ticketmaster, 533 football, 39 school holidays), fixtures 533. 041 ran at 20:09, so no 04:30 scheduled run has happened yet |
| 13.10 | Feed health, /feeds page, builder confirmations | LIVE | `checkFeedHealth` alerts on failing or stale feeds; /feeds (builder only) toggles feeds, shows coverage, confirms uncertain Ramadan/Eid dates, uploads timetables, adds matches and disruption; /feeds/terms enters council term dates or has Claude read a page for the builder to tick | `src/lib/feeds/status.ts`, `src/app/feeds/page.tsx`, `feeds/actions.ts`, `feeds/terms/page.tsx`, `school_date_drafts` | Anthropic (term reader, by button) | The "Off" button label reads like a status; alert when a council's dates run out within 4 months |
| 13.11 | Which model outputs the app reads or shows | NOT PRESENT | None: `latestForecasts`, `latestFinanceSnapshot`, `dealOutcomes` in `src/lib/ops/models.ts` have no callers; `model_coefficients` (124 rows) and `forecast_drivers` (348 rows) are not read by any app code | `grep` of `src/` for `ops/models`: only `model-roles.ts` and a test | none | Forecasts, drivers and weights are written and never shown to anyone except via SQL |

## D. Unmerged branches

Every other remote branch (agent-organisation, analytics-service, cleanup-and-hardening, domains, fix-test-mode, forecast-model, gm, growth, insights, job-queue, multi-restaurant, onboarding, ops-schema, outside-feeds, real-email, reputation, sales, synthetic-data, test-mode-split, turnstile-fix, visibility, z-report-wording) has 0 commits not on main.

| Branch | Ahead / behind main | What it contains |
|---|---|---|
| website-billing | 4 ahead, 17 behind | DinerAI landing page on dinerai.co.uk, paid sign-up with Stripe free trial, pilot invite codes and access rule (`supabase/025_billing.sql`, which clashes with main's `025_job_switches.sql`, and **has already been run on production**, 14 Oct) |
| onboarding-v2 | 6 ahead, 17 behind | Everything in website-billing, plus dark owner pages, website question, review-reply picks, "last year's sales" step, functions in Dublin (`supabase/026_onboarding_v2.sql`, **already run on production**, 14 Oct); 85 files changed |

## E. Integrations

| Service | Mode | What uses it | Env vars | Commercial-use limits |
|---|---|---|---|---|
| Twilio WhatsApp | Sandbox; owner and staff only | Webhook, owner messages, buttons, builder alerts | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, TWILIO_SANDBOX_JOIN, BUILDER_WHATSAPP, BUILDER_WHATSAPP_FROM | Sandbox not for production; needs a Meta-verified sender and templates (waits on company registration) |
| Resend | Live, mail.dinerai.co.uk (EU); EMAIL_REDIRECT can divert | Customer emails, builder alerts | RESEND_API_KEY, EMAIL_FROM_DOMAIN, EMAIL_FROM_ADDRESS, BUILDER_EMAIL, TEST_EMAIL_ALLOW | Free plan 100 a day, 3,000 a month |
| Google Business Profile | Stub (throws) for simulated and live | Reviews, posts, replies, updates | GOOGLE_MODE | API access pending (case 3-5160000041906) |
| Google Places | Live if key set | Onboarding look-up | GOOGLE_PLACES_API_KEY | Paid per call beyond free credit |
| Anthropic | Live; Sonnet 5.5, Haiku 5.5 router | Assistant, checks, agents, readers, report words, term-date reader | ANTHROPIC_API_KEY | Paid per token |
| Supabase | Live production (gfrk...) and dinerai-dev (nfph...) | Everything; pg_cron, pg_net, Auth, Storage | SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY | Plan not checked |
| Vercel | Live, app.dinerai.co.uk; build runs tests | Hosting, workers, backup cron | APP_URL, CRON_SECRET, LINK_SECRET, CONTACT_EMAIL, the five switches, TEST_MODE (deprecated) | Plan not checked; worker `maxDuration` 300 |
| Railway | Analytics worker (ran every job on 19 Oct) | `dinerai-analytics worker --env process --allow-production` | DATABASE_URL (queue_worker), ANALYTICS_ENV | Free trial ends after 30 days or $5 |
| Cloudflare Turnstile | Live when keys set | Customer sign-up, /start | TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY | Free |
| Open-Meteo | Live, ECMWF IFS 0.25, archive and previous runs | Weather feed, backfill | none | **Free tier non-commercial**; needs API Professional (price unlisted) |
| football-data.org | Live | Fixtures | FOOTBALL_DATA_API_KEY | Commercial use not stated; ask |
| football-data.co.uk | Backfill history (generator, feeds backfill) | Past fixtures | none | Not checked |
| Ticketmaster Discovery | Live, 5 km, 60 days | Local events | TICKETMASTER_API_KEY | **Unclear, terms forbid deriving revenue**; 24h takedown duty; written permission needed |
| TfL Unified API | Live, key optional | Strikes and closures | TFL_API_KEY (optional) | Allowed once registered; credit required |
| postcodes.io | Live | Location, council, nation | none | Free, no SLA |
| gov.uk bank holidays | Live, cached | Calendar, Visibility | none | OGL, credit required |
| Restaurant websites | Live fetch, public addresses only | Onboarding voice, logo, colour | none | n/a |
| Xero, QuickBooks, Stripe (main), Meta, Tripadvisor, delivery apps, bookings | Not present | none | none | n/a |

## F. Data model

"Nothing writes" means no app or Python service code writes it in production; the synthetic generator may fill it in dinerai-dev or for demo restaurants.

| Group | Table | One line |
|---|---|---|
| Core | restaurants | Restaurant profile, owner number and email, menu copy, caps, trust, agent modes, location, council, weather cell |
| Core | customers | Email sign-ups with confirm, unsubscribe and delete tokens |
| Core | reviews | Google-style reviews (dummy or pasted) |
| Core | drafts | Everything the AI writes for approval, with checks and versions |
| Core | sent_log | One row per sent draft |
| Core | messages | Every WhatsApp message in and out |
| Core | draft_feedback | Owner edits and skip reasons |
| Core | blocked_sends | Blocked or held sends with reason |
| Customers | consents | Consent decisions with wording and timestamps |
| Customers | rewards | One-time sign-up rewards |
| Customers | customer_events | Sign-ups, emails, redemptions, unsubscribes |
| Customers | campaigns | Email campaigns with structured offers |
| Customers | campaign_sends | Per-recipient token and delivery state |
| Customers | feedback_requests | One feedback email per redemption |
| Customers | feedback | Private ratings and comments |
| Google | google_posts | Dummy-published Google posts |
| Reports | reports | Weekly report snapshots |
| System | schema_migrations | Which SQL files ran |
| System | audit_log | Every action with actor and UNDO data |
| System | job_runs | Every cron run with outcome and switches |
| System | builder_alerts | Builder alerts for 6-hour dedupe |
| System | onboarding | Onboarding progress |
| System | rate_limits | Hashed rate-limit hits, cleared after 2 days |
| System | cached_data | Cached outside data |
| System | job_types | Queue job kinds and limits |
| System | jobs | The queue itself |
| Sales | staff_numbers | WhatsApp numbers allowed to send sales data |
| Sales | z_reports | Till report photos and readings |
| Sales | sales_days | Daily totals (now with covers columns, which nothing writes for real restaurants) |
| Sales | sales_hours | Hourly sales (covers columns, nothing writes) |
| Sales | pos_layouts | Saved POS column mappings |
| Sales | pos_imports | Each uploaded POS file |
| Sales | sales_items | Item-level sales |
| Sales | sales_channel_splits | Sales, orders, covers per channel: **nothing writes** |
| Agents | agent_jobs | Agent work records |
| Agents | profile_versions | Profile field history |
| Agents | shadow_drafts | Agent outputs beside today's |
| Agents | review_themes | Weekly praise and complaint themes |
| Agents | owner_alerts | GM-held alerts |
| Menu | menu_sections | Menu sections, written by save_menu |
| Menu | dishes | Single source of the menu, written by save_menu |
| Menu | dish_prices | Price history, written by save_menu |
| Menu | dish_renames | Name history, written by save_menu |
| Menu | menu_json_backup | Menus before the move (031 only) |
| Menu | ingredients | **Nothing writes** |
| Menu | recipe_versions | **Nothing writes** |
| Menu | recipe_lines | **Nothing writes** |
| Menu | till_item_matches | **Nothing writes** |
| Staff | staff | **Nothing writes** |
| Staff | staff_pay_rates | **Nothing writes** |
| Staff | staff_availability | **Nothing writes** |
| Staff | staff_time_off | **Nothing writes** |
| Staff | cover_rules | **Nothing writes** |
| Rota | rota_weeks | **Nothing writes** |
| Rota | rota_shifts | **Nothing writes** |
| Rota | shift_actuals | **Nothing writes** |
| Costs | suppliers | **Nothing writes** |
| Costs | invoices | **Nothing writes** |
| Costs | invoice_lines | **Nothing writes** |
| Costs | ingredient_prices | **Nothing writes** |
| Costs | fixed_costs | **Nothing writes** |
| Costs | targets | **Nothing writes** |
| Costs | channel_fees | **Nothing writes** |
| Deals | deal_outcomes | **Nothing writes** (`recordExpectedUplift` has no caller) |
| Model outputs | model_runs | Written by the Python runner |
| Model outputs | forecasts | Written by forecast_baseline and forecast_daily; read by nothing in the app |
| Model outputs | model_coefficients | Written by forecast_daily; read by nothing in the app |
| Model outputs | forecast_drivers | Written by forecast_daily; read by nothing in the app |
| Model outputs | suggested_rotas | **Nothing writes** |
| Model outputs | suggested_rota_shifts | **Nothing writes** |
| Model outputs | menu_analysis | **Nothing writes** |
| Model outputs | finance_snapshots | **Nothing writes** |
| Outside | weather_days | Daily weather, written by the weather feed |
| Outside | weather_hours | Hourly actuals, weather feed |
| Outside | weather_forecasts | Forecasts as issued (update refused by trigger), weather feed |
| Outside | local_calendar | One calendar: feeds, builder, owner events |
| Outside | venues | Stadiums and arenas, feeds and builder |
| Outside | football_fixtures | Fixture detail, football feed and builder |
| Outside | restaurant_teams | Teams per restaurant, builder (settings, /feeds) |
| Outside | calendar_relevance | Per-restaurant distance and relevance, feeds and builder |
| Outside | prayer_times | Per restaurant per day, prayer feed or timetable |
| Outside | restaurant_events | Closures, refits, promotions: **nothing writes** (helper in `ops/outside.ts` unused) |
| Feeds | feed_status | Each feed's switch and last run |
| Feeds | councils | Council term-date sources |
| Feeds | school_dates | Confirmed terms and inset days |
| Feeds | school_date_drafts | Claude-read term dates awaiting the builder |

Production row counts (19 Oct): 0 in ingredients, recipe_versions, till_item_matches, staff, staff_pay_rates, rota_weeks, rota_shifts, shift_actuals, suppliers, invoices, fixed_costs, targets, channel_fees, deal_outcomes, suggested_rotas, menu_analysis, finance_snapshots, restaurant_events, sales_channel_splits, restaurant_teams. Non-zero: menu_sections 14, dishes 45, dish_prices 45, sales_days 678, z_reports 1, forecasts 178, model_coefficients 124, forecast_drivers 348, weather_hours 18,384, weather_forecasts 43,188, weather_days 764, prayer_times 884, local_calendar 1,729, football_fixtures 533, venues 5, councils 3, school_dates 21, calendar_relevance 995, agent_jobs 47, shadow_drafts 12.

Views: the `analytics` schema (036, extended in 038 to 041) gives the Python service read-only, pence and UTC views of the above, with no staff names, photos or contact details. Roles: `analytics_reader`, `model_writer`, `queue_worker` (036, 039).

## G. Scheduled jobs

| Name | Time (UK unless stated) | Purpose | Failure behaviour |
|---|---|---|---|
| pg_cron hourly > `/api/cron?job=hourly` | 5 past every hour (`015_app_domain.sql`) | Queues per restaurant: review check, GM alerts, feedback emails, due sends; morning chain from 9am; feeds at 04:05 and 06:05; models at 05:05 and 07:05; 9:31 health check; daily cleanup; starts workers | Recorded in `job_runs`; crash alerts the builder; queue, brief and feed health checked each run |
| pg_cron worker kick > `/api/jobs/work` | Every minute when jobs are due (`028_queue_schedule.sql`) | Starts workers (3 lanes, stops claiming after 150s, maxDuration 300) | Expired locks requeued; jobs retried 1/5/15/60 min |
| Vercel cron `/api/cron?job=daily` | 09:00 UTC (`vercel.json`) | Backup: queues the morning job, missed feeds and missed models; checks the hourly job runs | Same recording and alerts |
| Morning chain (`morning` jobs) | From 9am, once a day | release, birthday (Mon), post (Mon/Thu), report (Mon), monday (Mon), brief | 5 attempts per step; builder told on first failure and when dead; owner never told; late brief alert at 9:31 |
| review_check, gm_alerts, feedback, release_sends | Hourly | Reviews, held alerts, feedback emails, scheduled sends | 2 to 3 attempts; dead alerts the builder |
| owner_message | On each WhatsApp message | Answers the owner, one at a time per restaurant | 1 attempt; owner gets "Sorry", builder alerted |
| agent | On demand | Agent work (shadow or live) | 3 attempts; invalid output retried once inside the job |
| feed_weather | 04:30 and 06:45 | Weather actuals and forecasts per cell | 4 attempts; stale or failing feed alerts the builder |
| feed_calendar, feed_football, feed_disruption, feed_terms_check | 04:30 | Shared calendar, fixtures, TfL, school-date check | 2 to 4 attempts; a missing key is "skipped", not an alert |
| feed_prayer, feed_events | 04:30, per restaurant | Prayer times, Ticketmaster events | 3 to 4 attempts |
| feed_backfill | On demand (new or moved restaurant, historic POS import) | Archived weather, forecasts, prayer, calendar, past fixtures | 4 attempts |
| forecast_baseline, forecast_daily | 05:35 (only if ANALYTICS_JOBS) | Nightly re-fit and forecast per active restaurant (Python) | 3 attempts, 300s lock with heartbeats; dead alerted by the app's health check (Python can't alert) |
| forecast_refresh | 07:00 queued, starts about 07:05 | Days 0 to 2 again with new weather | 3 attempts, 180s lock |
| health_check | 09:31 | Late briefs, backlog, stuck and unalerted dead jobs | Alerts builder |
| cleanup | Daily | Removes done jobs after 14 days, dead after 90 | 3 attempts |
| weather (old type) | Never queued | No-op, moved to feed_weather | n/a |

## H. Test results

Run 19 Oct 2026 in the audit worktree. No real messages, emails or paid API calls. Live agent evals and e2e runs were not run because they call Claude, Google and the real database.

| Suite | Result |
|---|---|
| App type-check (`next typegen` + `tsc --noEmit`) | Pass, 0 errors |
| App lint (`eslint`) | Pass, 0 problems |
| App `npm test` (switches unset) | 60 files passed; 930 passed, 1 skipped, 0 failed |
| App `npm test` with TEST_MODE=true | 60 files passed; 930 passed, 1 skipped, 0 failed |
| Analytics service `ruff check .` | All checks passed |
| Analytics service `pytest` (unit plus integration on a throwaway local Postgres via pgserver) | 114 passed, 0 failed (88s) |
| Generator `pytest` (incl. loader end to end on a local Postgres) | 20 passed, 0 failed (91s) |
| Skipped test | `tests/agents/reputation-cases.test.ts`, case `13-stars-only-five.json` (`pending_decision`), same as last audit |
| Not run | `tests/agents-live/*.eval.ts` (real Claude), `tests/e2e/*.e2e.ts` (real database, Claude, Google), `npm run test:agents` |

Untested areas:
- App tests use a fake Supabase, so the app's own queries against the real schema (unique indexes, the atomic send claim, triggers) are not tested; the ops schema, RLS policies and analytics roles are tested in PGlite and pgserver.
- No test that any app screen shows a forecast (none does).
- `src/lib/ops/costs.ts`, `recipes.ts`, `staff.ts`, `models.ts` have no tests and no callers.
- Real Twilio delivery, templates, 24h window; real Resend deliverability.
- Worker restarts on Railway and the nightly batch time across many restaurants (production has 2).
- Web pages and server actions (settings, /feeds, /sales upload, onboarding wizard) have no rendering or browser tests.
- Legacy prompts (`assistant.ts`, `checks/ai.ts`, Z-report and menu readers) have no eval cases.
- Forecast accuracy on any real restaurant's data.

## I. Top 10 risks and tech debt at pilot scale

1. **Google is not connected.** `src/lib/google/live.ts` throws on every call, and GOOGLE_MODE=simulated uses the same stub, so switching to it breaks review checks and posts. The headline promise (review replies, posts) only reaches a preview page.
2. **WhatsApp is still the Twilio sandbox.** Every owner must join it, the brief waits for the owner's next message outside 24 hours, and Meta approval waits on company registration.
3. **The forecast is built but unused and unproven.** No app code reads `forecasts`; it has only passed on synthetic data with effects designed by the same author, the pass bar was loosened after two of four demo restaurants failed it, and on production's two demo restaurants it failed (19 Oct).
4. **Real data can't feed the model the way synthetic data does.** Nothing writes covers, channel splits, restaurant events (closures), deals outcomes, staff or costs for a real restaurant, so on real data the model sees only daily transactions, and covers and channel forecasts won't exist.
5. **Outside data licences.** Open-Meteo's free tier is non-commercial, Ticketmaster's terms forbid deriving revenue and require 24h takedowns, football-data.org is unclear. The model's back-test is calibrated on Open-Meteo ECMWF, so switching provider means re-validating.
6. **Large unused surface.** About 30 ops tables, four helper files with no callers, profile-keeper, and two parallel paths (legacy assistant and shadow agents) roughly double Claude spend and maintenance; agent cost tracking misses legacy calls.
7. **No database-level isolation for the app.** The app uses the secret key; the new RLS policies only matter for user logins, and the older ~39 tables have none. One missed `.eq("restaurant_id", ...)` leaks data; only `tests/isolation.test.ts` guards it.
8. **Production is configured as a test bed.** TEST_TOOLS is on (test commands and the test clock), EMAIL_REDIRECT is on, and AGENTS_LIVE_ALLOWED is true. That is safe only while every restaurant is a demo; the first real restaurant needs TEST_TOOLS off and EMAIL_REDIRECT off, and a decision on agents. Railway is also believed to be on a free trial (30 days or $5), with only the queue backlog alert as a signal if it stops.
9. **Retention.** Messages, drafts, audit log, photos, feedback and Ticketmaster event names are kept forever; staff retention functions exist but nothing runs them.
10. **Two unmerged branches are drifting.** `website-billing` and `onboarding-v2` are 17 commits behind, touch 52 to 85 files, and their `025_billing.sql` clashes with main's `025_job_switches.sql`. Both `025_billing.sql` and `026_onboarding_v2.sql` have already been run on the production database, so production's schema is ahead of main's code and of the repo's migration record on main. Merging after the menu move (dishes guard trigger) and queue changes will need care.

## J. Open questions to check by hand

The production queries on 19 Oct answered the earlier questions (switch values, migrations, first nightly forecasts, feed health, dead jobs, the fixture not being loaded, agent modes); those answers are in the tables above. Still open:

1. **Railway plan.** railway.com > project "heroic-playfulness" > Settings > Plan: is it still the free trial (30 days or $5)? The worker stops when the trial ends.
2. **Where do TEST_TOOLS and AGENTS_LIVE_ALLOWED come from?** Vercel > Settings > Environment Variables (Production): are they set directly, or filled in by the deprecated TEST_MODE=true? Decide what they must be before the first real restaurant.
3. **Billing and onboarding-v2 migrations on production.** `025_billing.sql` and `026_onboarding_v2.sql` ran on production on 14 Oct but aren't on main. Is that intended, and what number will billing take when merged?
4. **Why did forecast_daily fail its bar on production?** Both demo restaurants beat the baseline on the 12-week WAPE but `passed` is false; `model_runs.metrics -> 'pass'` says which check failed (likely the long back-test or range coverage).
5. **School dates for `ember-spice`.** It's in Tower Hamlets (E09000030), which isn't one of the 3 seeded councils. Add its term dates on /feeds/terms, or move the demo?
6. **The school_terms feed has never run** (`feed_status.last_run_at` empty). Check it runs at 04:30 on 20 Oct, along with the first scheduled run of every other feed.
7. **The dead Growth job** (19 Oct, 09:06 UK, invalid output twice): retry it from /log, or look at the prompt?
8. **The README.** `analytics/service/README.md` still says "Not deployed yet" and names a Railway config file that new Railway services can't use.
9. **Licences.** Have Open-Meteo, Ticketmaster and football-data.org replied about commercial use (`docs/before-launch.md`)?
