# DinerAI: current state of the codebase

Audit date: 14 Oct 2026. Code audited: `origin/main` at `5cee9f8` (PR #17, "the GM"), read from the `gm` worktree at `C:\Users\miraa\dev\naila-agents` (identical files). The OneDrive copy (`Naila Restaurant Owner\naila-app`) is 84 commits behind and stops at step 14, so it was not used.

How statuses were decided: from the code path, not the docs. LIVE and DUMMY mean the code is wired end to end to that service and covered by unit tests that use stand-ins. No live service was called during this audit. Per your definitions, the Twilio WhatsApp sandbox counts as a sandbox, so any flow that only reaches the owner over WhatsApp is at best DUMMY. Agents that can only go live with TEST_MODE on are not live in production, so they are PARTIAL at best.

## A. Summary

- The owner runs a restaurant over the Twilio WhatsApp sandbox: chat with Claude about their data, Approve/Edit/Skip on every draft, a 9am brief of everything waiting, 1 to 3 star alerts, PAUSE/RESUME, UNDO, and about 35 typed commands (`src/lib/bot/`).
- Customer email is the most real part: QR sign-up, double opt-in, one-time rewards, campaigns to 3 segments, "How was your visit?" emails, unsubscribe, delete and export, all sent through Resend from mail.dinerai.co.uk (`src/lib/email/`, `src/lib/signups.ts`, `src/lib/campaigns.ts`).
- Google is dummy only. `src/lib/google/live.ts` throws on every method, so review replies, posts and hours/menu updates only reach a Google-style preview page. The paste-in fallback works without Google.
- Sales data comes in from till report (Z-report) photos read by Claude and from POS CSV/Excel files, with daily weather from Open-Meteo. It feeds a Sales section in the Monday report and the Insights agent. There is no forecasting, rota, costs, P&L or stock code at all.
- There is a full agent organisation (GM, Reputation, Visibility, Insights, Growth, checker) with prompts in `/agents`, schema checks, a checker loop, saved test cases and cost tracking. In production all of it runs in shadow mode except Reputation: Visibility, Insights, Growth and the GM can only go live when TEST_MODE is on.
- The safety gate in code is solid and tested: approval required, 9am to 9pm window, discount cap (including structured offers), consent and unsubscribe re-checked at send time, no double sends (atomic claim plus a unique index), 7-day campaign gap, trust levels with "never Auto" tasks, and TEST_MODE as a gate step (`src/lib/send.ts`, `src/lib/checks/money.ts`, `src/lib/trust.ts`).
- Multi-restaurant isolation, onboarding (web and WhatsApp), the audit log, job-run recording and builder alerts are all built. Isolation is enforced only by the code: RLS is switched on for 39 tables, but no policies exist and the app uses the secret key.
- Type-check, lint and all 48 test files pass (717 passed, 1 skipped), with TEST_MODE both off and on.

## B. Checklist

### 1. Owner experience

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 1.1 | WhatsApp assistant that answers questions on the restaurant's data | DUMMY | Owner chats with Sonnet, which gets profile summaries and look-up tools for reviews and customers, and can create drafts and campaigns | `src/app/api/whatsapp/route.ts` POST > `src/lib/bot/index.ts` handleMessage > `bot/conversation.ts` > `src/lib/assistant.ts` (tools look_up_reviews, look_up_customers, create_draft, create_email_campaign) | Twilio sandbox, Anthropic live | Sandbox only; number questions go to Insights only in shadow (live needs TEST_MODE) |
| 1.2 | 9am morning brief (forecast, yesterday's numbers, approvals) | PARTIAL | Numbered approvals with per-item buttons, APPROVE ALL, "done for you" tally, good private feedback, missing till report nudge | `src/lib/morning.ts` runMorning, `src/lib/brief.ts` sendBrief/composeBrief, `src/lib/sales/z-reports.ts` zNudgeFor | Twilio sandbox | No forecast; no yesterday's sales figures; waits for the owner's next message outside WhatsApp's 24h window (`canMessageFreely`) |
| 1.3 | Urgent alerts (1 to 3 star review, quiet night forecast, cash warning) | PARTIAL | 1 to 3 star Google reviews and 1 to 3 star private feedback alert at once with a drafted reply | `src/lib/google-jobs.ts` runReviewCheck, `src/lib/feedback.ts` submitFeedback, `src/lib/agents/gm-brief.ts` gmAlert (test mode) | Dummy Google, Twilio sandbox | No quiet night forecast alert; no cash warning; reviews only come from dummy data or NEW REVIEW |
| 1.4 | Monday report | DUMMY | Web page and PDF: sales, reputation, Reputation's themes, customers and campaigns, Google, headline, 3 actions, with last week vs the week before | `src/lib/report/build.ts` createReport/DATA_SECTIONS, `src/app/report/[token]/page.tsx`, `src/app/report/[token]/pdf/route.ts`, `src/lib/report/pdf.tsx` | Anthropic live (words), Google dummy, Twilio sandbox | Google views, calls and directions only when Google is live (never today); Insights' words only in test mode |
| 1.5 | Monthly sales report (what, why, 3 actions) | NOT PRESENT | Nothing; only the weekly report | grep "monthly": only `src/lib/agents/costs.ts` monthlyCosts (agent spend) | none | Not built |
| 1.6 | Trust ladder per task (Draft only, Approve, Auto), manual switch | PARTIAL | Per-task Draft only / Approve / Auto stored per restaurant and enforced at send time | `src/lib/trust.ts` gateApproval/trustLevel/NEVER_AUTO/ALWAYS_APPROVE, `src/lib/checks/money.ts` moneyAndRisk, `src/app/settings/actions.ts` (builder controls), `supabase/019_trust_levels.sql` | none | Only the builder can switch it, not the owner; Auto needs a live checker pass, so only Reputation live (or Visibility live in test mode) drafts can qualify |
| 1.7 | Trust ladder auto-promotion from approval history | NOT PRESENT | Nothing | grep auto-promot: none | none | Not built |
| 1.8 | Learning from approvals, edits and rejections (tone, dropping ignored suggestions) | PARTIAL | The last 15 edits and skip reasons plus the last 5 approved drafts go into the prompts; Reputation sees the last 5 reply edits | `src/lib/drafts.ts` getLearningContext, `src/lib/assistant.ts` (feedback block ~line 115), `src/lib/agents/tools.ts` reviewHistory, `draft_feedback` table | Anthropic live | Prompt stuffing only; no rule or profile learning; nothing drops suggestions the owner keeps ignoring; profile-keeper agent not wired |
| 1.9 | "What I did for you" tally | DUMMY | One line in the brief counting replies, posts, emails, sign-ups and redemptions in the last 24h | `src/lib/brief.ts` doneTally/tallyLine | Twilio sandbox | Counts dummy Google activity as "replied" and "published" |
| 1.10 | Onboarding (web and WhatsApp): brand voice from website/socials, menu photo to dish list, Google connect, customer import, staff list and pay rates, 12-month till history import | PARTIAL | 6 skippable steps on web or WhatsApp sharing one engine: Google Places look-up, menu photos to dishes, allergens, voice from website or pasted Instagram captions, reward and cap, finish with QR pack | `src/lib/onboarding/steps.ts` STEPS, `engine.ts`, `ai.ts`, `places.ts`, `website.ts`, `whatsapp-flow.ts`, `src/app/onboarding/*` | Anthropic live, Google Places live (if key set), Twilio sandbox | "Google connect" is a Places search, not a Business Profile login; no customer import; staff = WhatsApp numbers only (ADD STAFF), no pay rates; till history only via the later POS upload, capped at 4 MB / 50k rows |
| 1.11 | Web app for setup, settings, reports | LIVE | Magic-link login; onboarding wizard, settings (profile cards, brand, menu, allergens, export), /sales, /report, /log | `src/proxy.ts`, `src/lib/auth.ts`, `src/app/settings/page.tsx`, `src/app/sales/page.tsx`, `src/app/log/page.tsx`, `src/app/onboarding/setup/page.tsx` | Supabase Auth live | Supabase's built-in login email is rate-limited to a few an hour |
| 1.12 | Manager logins and second approver | NOT PRESENT | Only the restaurant's `owner_email` or BUILDER_EMAIL can log in; staff numbers can only send till reports and sales files | `src/lib/auth.ts`, `src/lib/sales/staff.ts` | none | No manager role, no second approver |
| 1.13 | Multi-language messages (English, Urdu, Bengali, Arabic) | PARTIAL | Owner language field; the GM detects English, Urdu script or Roman Urdu and has a fixed "on it" line in each | `src/lib/agents/gm-rules.ts` languageOf/expectedLanguage/ON_IT_LINES, `src/lib/profile/fields.ts` language, `supabase/022_owner_preferences.sql` | Anthropic live | Only via the GM, which is live only in test mode; no Bengali or Arabic; legacy messages and fixed text are English only |

### 2. Forecasting

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 2.1 | Covers and sales by day and hour, shown as a range | NOT PRESENT | No forecast; historic sales by day and hour exist | `src/lib/agents/insights-metrics.ts` (history only) | none | Covers aren't recorded ("covers" metric returns unavailable) |
| 2.2 | Inputs: till history, bookings, weather, local events, holidays, Ramadan and Eid, football, school holidays | PARTIAL | Inputs are collected but no forecast uses them. Till history: built (Z-report, POS). Bookings: not present. Weather: built (Open-Meteo, 12-month backfill). Local events, Ramadan/Eid, football, school holidays: only as manual builder entries in `local_calendar`. Bank holidays: built (gov.uk) | `src/lib/sales/weather.ts` runWeather, `src/lib/sales/z-reports.ts`, `src/lib/sales/pos-import.ts`, `src/lib/local-calendar-rules.ts` (types religious, school_holiday, sport, local_event, bank_holiday), `src/lib/bank-holidays.ts` | Open-Meteo live, gov.uk live | No bookings; no automatic event, match, school or Ramadan feeds; Growth uses the calendar, nothing forecasts from it |
| 2.3 | Back-testing before showing to owners | NOT PRESENT | Nothing | grep "backtest": only unrelated hits in reputation-rules.ts and feedback-rules.ts | none | Not built |
| 2.4 | Forecast feeding rota, specials, deals, quiet-night offers, stock | NOT PRESENT | Nothing; Growth reads quiet days from the last 8 weeks of actual sales instead | `src/lib/agents/quiet-times.ts` quietTimes (history, not forecast) | none | No forecast exists |

### 3. Rota and staff costs

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 3.1 | Suggested rota from forecast (roles, skills, contracted hours, availability, rates, cover rules, UK working time rules) | NOT PRESENT | Nothing | `insights-metrics.ts` labour_cost returns "Labour cost isn't recorded yet" | none | Not built; Insights is told never to advise on staffing (`insights-rules.ts` ADVICE) |
| 3.2 | Rota cost shown before approval | NOT PRESENT | Nothing | none | none | Not built |
| 3.3 | Daily staff cost % vs target | NOT PRESENT | Nothing | none | none | Not built |
| 3.4 | Actual vs planned hours from rota photo or rota-app export | NOT PRESENT | Nothing | none | none | Not built |

### 4. Menu, pricing and deals

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 4.1 | Dish cost from recipe | NOT PRESENT | Nothing; dishes have a price only | `src/lib/onboarding/profile-data.ts` (menu: name, price, section, allergens) | none | Not built; "dish margins" metric returns unavailable |
| 4.2 | Menu engineering (popularity x profit categories, push/reprice/pull) | NOT PRESENT | Only top 5 items by sales in the report | `src/lib/sales/report-section.ts` | none | No cost data, so no profit axis |
| 4.3 | Price suggestions vs nearby rivals | STUB | `get_public_rivals` is listed in Insights' tools but has no code | `agents/insights.md` tools line; not in `src/lib/agents/tools.ts` runTool | none | Declared only |
| 4.4 | Deal checker (break-even covers vs forecast uplift) and deal tracking | PARTIAL | Tracking only: each campaign records sent, opened, clicked and redeemed; offers checked against the discount cap | `src/lib/campaigns.ts` campaignStats/statsText, `src/lib/offers.ts` offerCap | Resend live | No break-even or uplift maths; no revenue |
| 4.5 | Weekly "what staff should recommend" | NOT PRESENT | Nothing | none | none | Not built |

### 5. Specials, stock and waste

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 5.1 | Specials from stock in hand with margin | PARTIAL | Growth suggests up to 2 "special ideas" on Mondays from menu dishes, draft only, never priced | `src/lib/agents/growth.ts` mondayGrowth (special_ideas), `growth-rules.ts` | Anthropic live | Shadow in production (live needs TEST_MODE); no stock or margin input |
| 5.2 | Trend ideas matched to the kitchen | STUB | `get_trends` tool returns an empty list | `src/lib/agents/tools.ts` runTool case get_trends | none | No trend source |
| 5.3 | Waste and use-by tracking | NOT PRESENT | Nothing | none | none | Not built |
| 5.4 | Order suggestions and supplier emails | NOT PRESENT | Nothing for orders; a supplier email can only be asked for as a one-off (see 9.1) | none | none | Not built |

### 6. Books and finance

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 6.1 | Data in: Z-report photos, till/POS exports, supplier invoice photos, fixed costs | PARTIAL | Z-report photos: built (Claude reads, code checks it adds up, asks YES/REPLACE/KEEP). Till/POS exports: built (CSV/Excel, AI column mapping confirmed once per layout). Supplier invoices: not present. Fixed costs: not present | `src/lib/sales/z-reports.ts`, `z-check.ts`, `ai.ts`, `pos-import.ts`, `pos-table.ts`, `src/app/sales/upload/route.ts` | Anthropic live, Supabase storage | Rows over 50,000 are silently dropped (`pos-table.ts` toTable MAX_ROWS); 4 MB file cap |
| 6.2 | Daily figures: sales vs forecast, staff cost %, food cost % | PARTIAL | Daily net/gross/VAT/transactions stored and shown on /sales | `src/lib/sales/store.ts`, `src/lib/sales/page-data.ts`, `src/app/sales/page.tsx` | none | No forecast, staff cost or food cost |
| 6.3 | Full finance: prime cost, weekly P&L, cash warnings | NOT PRESENT | Nothing | none | none | Not built |
| 6.4 | Xero or QuickBooks sync | NOT PRESENT | Nothing | none | none | Not built |
| 6.5 | "Information, not financial advice" framing | LIVE | Footnote on the report and /sales; the assistant prompt and Insights' rules block advice on staffing, pay, loans and tax | `src/lib/report/types.ts` SALES_FOOTNOTE, `src/app/sales/page.tsx`, `src/lib/assistant.ts` (~line 732), `src/lib/agents/insights-rules.ts` ADVICE | none | The legacy assistant relies on the prompt only, with no code check |

### 7. Reviews, Google and social

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 7.1 | Google review replies in house voice within 24h (auto for 4 to 5 star when trusted, approval and alert for 1 to 3) | DUMMY | Hourly check drafts a reply per new review: 4 to 5 star held for the brief, 1 to 3 star alerted at once; Reputation can write them (live allowed in production once its checklist passes) | `src/lib/google-jobs.ts` runReviewCheck, `src/lib/agents/reputation.ts` liveReputation/reputationMode, `src/lib/trust.ts` gateApproval | Dummy Google | Live Google is a stub; nothing enforces 24h (4 to 5 star waits for next 9am plus a tap); Auto only with a live checker pass |
| 7.2 | Google profile: posts, photos, Q&A, holiday hours, menu and hours updates, AI search visibility | PARTIAL | Posts: dummy (Mon/Thu drafts, WhatsApp photos to posts). Photos: dummy (photo library, Visibility photo checks). Q&A: not present. Holiday hours: partial (bank holiday questions save special hours, Google update only logged). Menu and hours updates: partial (drafts, approval only logs "would have updated"). AI search visibility: not present | `google-jobs.ts` runPostJob/createPostDraft, `src/lib/bot/flows.ts` photoPost, `src/lib/agents/visibility.ts` mondayVisibility, `src/lib/send.ts` (hours_update/menu_update branch) | Dummy Google | Visibility live needs TEST_MODE; no Google write path exists |
| 7.3 | Paste-in fallback while Google API is pending | DUMMY | Owner pastes a real review and gets a copy-paste reply (Reputation shadow beside it) | `src/lib/assistant.ts` tool draft_pasted_review_reply | Anthropic live, Twilio sandbox | Only the WhatsApp sandbox; owner posts it by hand |
| 7.4 | Tripadvisor and delivery app reviews | NOT PRESENT | Nothing; only a mention in `agents/reputation.md` and dummy review text | `src/lib/dummy-reviews.ts` | none | Not built |
| 7.5 | Weekly complaint and praise themes | PARTIAL | Reputation names up to 3 praise and 3 complaint themes a week; code counts them; shown in the Monday report | `src/lib/agents/reputation-themes.ts`, `src/lib/report/build.ts` (section "themes"), `review_themes` table | Anthropic live, dummy Google reviews | Only over dummy or pasted reviews; skipped if Reputation is off |
| 7.6 | Social: shoot briefs, captions, content calendar, Instagram/Facebook posting, TikTok briefs | PARTIAL | Visibility writes a Monday content brief (3 shoot briefs, platform Instagram/TikTok/Google) | `src/lib/agents/visibility.ts` contentBriefText, `visibility-rules.ts` VisibilityDraft (platform enum) | Anthropic live | Shadow in production (live needs TEST_MODE); no content calendar; no Instagram or Facebook posting; no Meta API |
| 7.7 | Growth: local events calendar, competitor watch, creator outreach, website and SEO check | PARTIAL | Local calendar entered by the builder plus gov.uk bank holidays; Growth drafts 2 to 3 weeks ahead of each date | `src/lib/local-calendar.ts`, `local-calendar-rules.ts`, `src/app/settings/profile-cards.tsx` CalendarCard, `src/lib/agents/growth.ts` | gov.uk live | No competitor watch, creator outreach or SEO check; the website is only read at onboarding |

### 8. Customers, offers and loyalty

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 8.1 | QR sign-up by email, reward per restaurant, double opt-in, one-time redemption page | LIVE | QR to branded form, unticked consent, confirm email, then welcome email with a 10-minute one-time redemption screen; owner told on WhatsApp | `src/app/r/[slug]/page.tsx`, `src/app/api/signup/[slug]/route.ts`, `src/lib/signups.ts` signUp/confirmEmail/redeemReward, `src/app/reward/[token]/*`, `src/app/api/confirm/[token]/route.ts` | Resend live, Turnstile live, Twilio sandbox (owner note) | If TEST_MODE is on in Vercel, every customer email is redirected to the builder |
| 8.2 | Segments: regulars, lapsed, birthdays | PARTIAL | Segments are everyone, birthdays in the next 7 days, and unredeemed new sign-ups | `src/lib/campaigns.ts` SEGMENTS/segmentRecipients | none | No regulars or lapsed: there's no per-customer visit history |
| 8.3 | Email campaigns | LIVE | Owner asks, gets a drafted campaign with a picture of the email, approves, then each consented customer gets a unique offer link | `src/lib/campaigns.ts` createCampaignDraft/deliverCampaign, `src/lib/email/index.ts` sendCampaignEmail, `src/lib/send.ts` attemptSend | Resend live | Resend free plan is 100 emails a day; Growth campaigns live only in test mode |
| 8.4 | Post-visit feedback | LIVE | About 3h after a redemption: email with the Google link for everyone plus a private form; 1 to 3 stars alert the owner, 4 to 5 go in the brief | `src/lib/feedback.ts` scheduleFeedback/runFeedbackJob/submitFeedback, `src/lib/feedback-rules.ts`, `src/app/feedback/[token]/page.tsx` | Resend live | Google link goes to the Maps search unless a place id is set |
| 8.5 | Quiet-night filler (detect, offer, report uplift) | PARTIAL | Offer: owner texts "Thursday is quiet" and gets a campaign. Detect: Growth works out quiet days from 8 weeks of sales (shadow) | `src/lib/assistant.ts` create_email_campaign, `src/lib/agents/quiet-times.ts`, `src/lib/agents/growth.ts` mondayGrowth | Resend live | No automatic detection in production; no uplift report |
| 8.6 | Revenue per campaign (unique codes, repeat-visit matching) | PARTIAL | Each recipient gets a unique one-time offer token; opens, clicks and redemptions are counted | `campaign_sends.token`, `src/lib/campaigns.ts` redeemOffer/markOpened/markClicked/campaignStats, `src/app/api/t/open/[token]/route.ts` | Resend live | No revenue figure; no matching to till data or repeat visits |
| 8.7 | WhatsApp loyalty stamp card | NOT PRESENT | Nothing | none | none | WhatsApp to customers is blocked in the gate (`gate-rules.ts` testModeStep) |
| 8.8 | Customer export and delete; opt-out handling; CAPTCHA | LIVE | CSV export (signed 1-hour link or settings), "Delete my data" anonymises, unsubscribe in every email, Turnstile plus rate limits on forms | `src/lib/customer-data.ts` deleteCustomerData/exportCustomers, `src/lib/customer-csv.ts`, `src/app/delete/[token]`, `src/app/unsubscribe/[token]`, `src/lib/turnstile.ts`, `src/lib/rate-limit.ts` | Resend live, Turnstile live | Turnstile check is skipped if its keys aren't set |

### 9. Admin and operations

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 9.1 | Job ads, supplier emails, notices on request | DUMMY | The assistant writes a one-off as an "other" draft; the GM routes "one_off" to Visibility (test mode) | `src/lib/assistant.ts` create_draft (kind other), `src/lib/agents/gm-live.ts` dispatch case one_off | Anthropic live, Twilio sandbox | Approving an "other" draft logs a simulated WhatsApp send ("WhatsApp to customers is off"), which is confusing for a job ad |
| 9.2 | Hiring (post ads, screen applicants, shortlist) | NOT PRESENT | Nothing | none | none | Not built |
| 9.3 | Compliance reminders and allergen matrix synced to menu | PARTIAL | Allergens per dish, suggested by AI, never shown to customers until the owner confirms each | `src/lib/onboarding/profile-data.ts` customerSafeMenu, `allergens_confirmed`, `src/lib/onboarding/ai.ts` | Anthropic live | No compliance reminders; no printable allergen matrix |
| 9.4 | AI phone answering | NOT PRESENT | Nothing | none | none | Not built |
| 9.5 | Delivery apps (listing optimisation, then direct push) | NOT PRESENT | Nothing | none | none | Not built |
| 9.6 | Local benchmarks | NOT PRESENT | Nothing; a mention in `agents/insights.md` only | none | none | Not built |

### 10. Trust and safety

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 10.1 | GM/head chef agent with specialist agents (list them, with model used) | PARTIAL | GM (router Haiku 5.5, composer Sonnet 5.5); Reputation, Visibility, Insights, Growth (Sonnet 5.5); profile-keeper (Sonnet, defined, never called) | `agents/*.md` front matter, `src/lib/agents/definition.ts`, `src/lib/claude.ts` MODELS, `src/lib/agents/gm.ts` gmMode | Anthropic live | GM, Visibility, Insights, Growth are live only with TEST_MODE (`gmMode`, `visibilityMode`, `insightsMode`, `growthMode`); Reputation is the only one that can go live in production |
| 10.2 | Separate checker agents (list them) | LIVE | Every draft: AI facts check and AI tone check (Sonnet), compliance and money checks (code); checker agent (Sonnet, v0.3) shadow on every draft, blocking inside live specialist loops; plain-code price check; per-agent rule files | `src/lib/checks/index.ts` runAll, `checks/ai.ts`, `checks/compliance.ts`, `checks/money.ts`, `src/lib/agents/checker.ts`, `checker-rules.ts`, `src/lib/prices.ts` | Anthropic live | Checker agent's own mode is only off/shadow; misleading-claims check is a word list |
| 10.3 | Code release gate: discount cap, 9am to 9pm window, consent, no double sends | LIVE | Discount cap: LIVE (wording and structured offers). Window: LIVE (per restaurant, queued until it opens). Consent: LIVE (re-checked at send, unsubscribe link required, 7-day gap). No double sends: LIVE (atomic claim, unique index on sent_log and campaign_sends) | `src/lib/checks/money.ts` moneyAndRisk, `src/lib/offers.ts` offerCap, `src/lib/send.ts` attemptSend, `src/lib/checks/compliance.ts` emailComplianceProblems, `src/lib/gate-rules.ts` weeklyLimit | none | Tested in `tests/gate.test.ts`, `tests/rules.test.mts`, `tests/offers.test.ts` |
| 10.4 | Escalate to owner when unsure; never commits money without a yes | PARTIAL | Money: campaigns, offers, hours, menu and profile changes can never go on Auto, and offer-like text is blocked from Auto. Escalation: question cards for risky reviews, Insights asks about odd till figures, GM asks "which did you mean?" | `src/lib/trust.ts` NEVER_AUTO/looksLikeOffer, `src/lib/agents/reputation.ts` (review_question), `src/lib/agents/gm-live.ts` | none | Default (legacy) review path only flags in the message, it does not stop to ask; escalation cards need Reputation/GM live |
| 10.5 | Audit log, UNDO, PAUSE | LIVE | Every action logged with actor and time; UNDO reverses the last owner action where possible; PAUSE holds all sends until RESUME | `src/lib/audit.ts` logAction, `src/lib/undo.ts`, `src/lib/undo-plan.ts`, `src/app/log/page.tsx`, `src/lib/bot/parse.ts` (pause, resume, undo) | none | UNDO can't recall sent emails |
| 10.6 | Watchdog alerting the founder on failed jobs | LIVE | Every cron run recorded; failures, stuck runs, late briefs and agent job failures alert the builder by email and WhatsApp, deduplicated for 6 hours | `src/lib/job-runs.ts` startRun/finishRun/checkJobHealth, `src/lib/job-health.ts`, `src/lib/builder-alerts.ts` alertBuilder, `src/app/api/cron/route.ts` briefIsLate | Resend live, Twilio sandbox | Builder WhatsApp alerts may not arrive outside the 24h window; no external uptime check if the cron itself never fires (only the Vercel daily backup notices) |
| 10.7 | Prompt changes tested against saved real examples (eval set) | PARTIAL | 88 saved cases (checker 15, GM 2 files with 40 routing and 11 composer cases, Growth 18, Insights 20, Reputation 18, Visibility 17); recorded answers replayed offline on every push; live runs by hand | `agents/tests/*`, `tests/agents/cases.test.ts`, `tests/agents-live/*.eval.ts`, `.github/workflows` (Agent tests: workflow_dispatch only) | Anthropic (by hand) | Cases are built on dummy data, not real examples; legacy prompts in `assistant.ts` and `checks/ai.ts` have no eval set; profile-keeper has 0 cases; 1 Reputation case skipped pending a decision |
| 10.8 | Data protection in code: consent records, retention, deletion | PARTIAL | Consent stored with wording, timestamp and confirmation time; deletion anonymises customer rows, consents, sends, events, feedback and WhatsApp log mentions | `consents` table, `src/lib/signups.ts` confirmEmail, `src/lib/customer-data.ts` deleteCustomerData | none | No retention: nothing is ever purged except `rate_limits` rows over 2 days (`rate-limit.ts` clearOldRateLimits) |

### 11. Behind the scenes

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 11.1 | Admin console (health, failed jobs, cost per restaurant, impersonate) | PARTIAL | Builder-only sections on /log (scheduled jobs, builder alerts, agent comparisons) and settings (builder controls, calendar, monthly agent cost); the builder can switch to any restaurant's pages | `src/app/log/page.tsx`, `src/app/log/agent-compare.tsx`, `src/app/settings/page.tsx` BuilderCard/CalendarCard/CostCard, `src/lib/agents/costs.ts`, `src/lib/auth.ts` pickRestaurantId | none | No cross-restaurant overview; cost covers agent jobs only, not legacy Claude calls (assistant, AI checks, Z-report and menu reading); no WhatsApp impersonation |
| 11.2 | Multi-restaurant (tenancy and data isolation) | LIVE | Restaurant found by owner number; every query filtered by restaurant_id; jobs loop active restaurants with their own try/catch; tests fail on unscoped queries | `src/app/api/whatsapp/route.ts`, `src/lib/send.ts` (draft/restaurant match), `src/app/api/cron/route.ts` runJob, `tests/isolation.test.ts` | Supabase | RLS enabled on 39 tables with 0 policies; app uses the secret key, so the database itself doesn't separate restaurants |
| 11.3 | TEST_MODE | LIVE | Turns on test commands and the test clock, redirects customer email to the builder, simulates live Google, gates agent live modes | `src/lib/test-mode.ts` TEST_COMMANDS, `src/lib/email/route.ts` routeEmail, `src/lib/gate-rules.ts` testModeStep | none | Same flag both protects customers and unlocks agents, so you can't run agents live without also redirecting customer email |
| 11.4 | Stripe billing and tiers | NOT PRESENT | Nothing | grep stripe: none | none | Not built |
| 11.5 | Growth tools: free Google health check, referral credits, marketplace listings | NOT PRESENT | Nothing; dinerai.co.uk is a one-page holding site | `src/app/site/page.tsx` | none | Not built |

### 12. Built but not in the spec

| ID | Item | Status | What it does today (one line) | Evidence (files/functions) | Integration (live/dummy/none) | Gaps or issues |
|---|---|---|---|---|---|---|
| 12.1 | Staff WhatsApp numbers for sales data | DUMMY | ADD STAFF registers a number that can only send till reports, sales files and photos | `src/lib/sales/staff.ts`, `src/lib/sales/whatsapp.ts` handleStaffMessage | Twilio sandbox | Each staff member must join the sandbox |
| 12.2 | Profile v1 with versions and per-field Revert | LIVE | Sign-off, complaint contact, halal and allergen statements, recovery offers, words to avoid, emoji limits; each change versioned | `src/lib/profile/fields.ts`, `src/lib/profile/versions.ts`, `src/app/settings/profile-cards.tsx`, `profile_versions` table | none | None found |
| 12.3 | Shadow mode and side-by-side agent comparisons | LIVE | Every agent's output saved next to today's for builder review, with checker verdict, timings and email pictures | `shadow_drafts` table, `src/app/log/agent-compare.tsx`, `src/app/log/growth-preview/[id]/route.ts` | Anthropic live | Doubles Claude spend on every review, post, offer ask and brief while in shadow |
| 12.4 | Agent job queue with idempotent keys, schema checks and retry | LIVE | Each piece of agent work is a job with a unique key; invalid output gets one retry, then fails and alerts the builder | `src/lib/agents/jobs.ts`, `schema.ts`, `loop.ts`, `run.ts`, `agent_jobs` table | Anthropic live | Runs inside the webhook's `after()` and the hourly cron, so it shares their time limit |
| 12.5 | Email previews and branded templates | LIVE | React Email templates per restaurant colour, logo and tone; a picture of each campaign email on WhatsApp; EMAIL PREVIEWS command | `src/lib/email/templates.tsx`, `preview-image.tsx`, `previews.ts`, `src/app/api/email-preview/[subject]/route.ts` | Resend live | Preview is a drawing, not a screenshot |
| 12.6 | Printable QR pack | LIVE | PDF with four table cards and a counter sign in the restaurant's colours | `src/lib/onboarding/qr-pack.tsx`, `src/app/r/[slug]/qr-pack/route.ts` | none | None found |
| 12.7 | Change details by message with UNDO | DUMMY | "Change Friday hours to 11pm", "add lamb chops, £14" saved through one path; GM turns facts into confirm cards (test mode) | `src/lib/onboarding/profile-changes.ts`, `src/lib/profile-edits.ts` saveProfileFields, `assistant.ts` change_restaurant_details | Twilio sandbox | None found |
| 12.8 | Holding site and domain routing | LIVE | dinerai.co.uk holding page, privacy and terms; old vercel.app links redirect | `src/proxy.ts`, `src/lib/hosts.ts`, `src/app/site/*` | Vercel | None found |
| 12.9 | Onboarding as a sign-up funnel (/start) | LIVE | Public restaurant sign-up behind Turnstile and rate limits; restaurant inactive until onboarding finishes | `src/app/start/*`, `src/lib/onboarding/store.ts` | Turnstile live | Anyone can create inactive restaurants (max 5 unfinished per email per day) |
| 12.10 | Dummy data and seeding scripts | DUMMY | Two demo restaurants, two weeks of activity, 12 months of sales, sample till photos and POS CSV; one script clears it | `scripts/seed-two-weeks.mjs`, `seed-sales.mjs`, `clear-dummy-data.mjs`, `public/samples/` | none | None found |

## C. Integrations

| Service | Mode | What uses it | Env vars needed |
|---|---|---|---|
| Twilio WhatsApp | Sandbox (owner and staff channel only; customer WhatsApp blocked in `gate-rules.ts`) | Webhook, all owner messages, Content templates for buttons, builder WhatsApp alerts | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER (default +14155238886), TWILIO_SANDBOX_JOIN, BUILDER_WHATSAPP, BUILDER_WHATSAPP_FROM |
| Resend | Live, verified domain mail.dinerai.co.uk (EU); TEST_MODE redirects to builder | Customer emails, builder email alerts | RESEND_API_KEY, EMAIL_FROM_DOMAIN, EMAIL_FROM_ADDRESS (fallback), BUILDER_EMAIL, TEST_EMAIL_ALLOW |
| Google Business Profile | Dummy only; `src/lib/google/live.ts` throws "isn't set up yet" on every method | Reviews, posts, replies, insights | GOOGLE_MODE (dummy default; setting it to live breaks every Google call) |
| Google Places API | Live if key set, else the onboarding step is skipped | Onboarding "Is this you?" look-up | GOOGLE_PLACES_API_KEY |
| Anthropic | Live; Sonnet 5.5 everywhere except the GM router (Haiku 5.5); server-side refusal fallback on Sonnet | Assistant, AI checks, agents, Z-report and menu reading, report words | ANTHROPIC_API_KEY (read by the SDK) |
| Supabase | Live; Postgres with secret key, Auth magic links with publishable key, Storage for photos; pg_cron + pg_net | Everything | SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY |
| Vercel | Live; app.dinerai.co.uk, build runs `npm test && next build`, one daily cron | Hosting, backup cron | APP_URL, CRON_SECRET, TEST_MODE, LINK_SECRET (optional), CONTACT_EMAIL (optional) |
| Cloudflare Turnstile | Live when keys set, skipped otherwise | Customer sign-up and /start | TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY |
| Open-Meteo (weather) | Live, no key | Daily weather per restaurant, 12-month backfill | none |
| gov.uk bank holidays | Live, cached in `cached_data` | Visibility hours questions, local calendar | none |
| Restaurant websites | Live fetch, public addresses only | Onboarding voice samples, logo and colour | none |
| POS systems | None; file upload only (CSV/Excel) | /sales and WhatsApp files | none |
| Xero, QuickBooks, Stripe, Meta (Instagram/Facebook), Tripadvisor, delivery apps, bookings | Not present | none | none |

## D. Data model

| Table | One line |
|---|---|
| restaurants | One row per restaurant: owner number and email, profile, menu, voice, caps, window, trust levels, agent modes, job state flags |
| customers | Email sign-ups and seeded dummies, with confirm, unsubscribe and delete tokens |
| reviews | Google-style reviews (dummy or pasted), with reply and handled state |
| drafts | Everything the AI writes for approval, with status, checks, agent check, versions and brief numbering |
| sent_log | One row per sent draft (unique per draft), real or simulated |
| messages | Every inbound and outbound WhatsApp message; unique Twilio id stops duplicates |
| draft_feedback | Owner edits and skip reasons, used as learning context |
| blocked_sends | Every blocked or held send with its reason |
| consents | Every consent decision with the exact wording and timestamps |
| rewards | One-time sign-up rewards with redemption and expiry |
| customer_events | Sign-ups, emails, redemptions, unsubscribes |
| campaigns | One email campaign per draft: segment, copy, dates, structured offer, send time |
| campaign_sends | One row per recipient with its own token, delivery state, open, click and redemption |
| google_posts | Drafted and "published" Google posts (dummy publishes into this table) |
| reports | Weekly report snapshots (JSON) behind a private token |
| schema_migrations | Which SQL files have run |
| audit_log | Every action with actor, time, old value and batch id for UNDO |
| job_runs | Every cron run with its real outcome |
| builder_alerts | Alerts sent to the builder, for 6-hour deduplication |
| onboarding | Onboarding progress per restaurant, shared by web and WhatsApp |
| rate_limits | Hashed rate-limit attempts, cleared after 2 days |
| feedback_requests | One "How was your visit?" email per redemption |
| feedback | Private feedback ratings and comments |
| staff_numbers | WhatsApp numbers allowed to send sales data for one restaurant |
| z_reports | Till report photos and what was read from them |
| sales_days | Daily sales totals per restaurant from a till report, POS file or seed |
| sales_hours | Sales by hour |
| pos_layouts | Saved column mappings per POS export layout |
| pos_imports | Each uploaded POS file and its status |
| sales_items | Item-level sales with a fingerprint to skip duplicates |
| weather_days | Daily weather per restaurant (archive, recent, forecast) |
| agent_jobs | Agent work items with unique keys, status, tokens and cost |
| profile_versions | Every profile field change, for Revert |
| shadow_drafts | Agent outputs saved beside what the owner got, with checker verdicts |
| review_themes | Reputation's weekly praise and complaint themes |
| cached_data | Fetched data kept for a while (gov.uk bank holidays) |
| local_calendar | Dates to plan campaigns around, for all restaurants or one |
| owner_alerts | Alerts the GM holds for quiet hours or the one-an-hour limit |

## E. Scheduled jobs

| Name | Schedule | Purpose | Failure behaviour |
|---|---|---|---|
| naila-hourly-reviews (pg_cron > `/api/cron?job=hourly`) | 5 past every hour (`supabase/015_app_domain.sql`) | Per active restaurant: review check, release held GM alerts (test mode), feedback emails, release queued and scheduled sends, weather, then the morning job, then queued agent jobs; clear rate limits | Answers at once and works in `after()`; each step has its own try/catch per restaurant; run recorded in `job_runs`; failures, stuck runs and late briefs alert the builder |
| Morning job (inside hourly and daily) | First run from 9am UK, once a day | Release held sends, Monday birthday email, Mon/Thu Google post, Monday report, Monday Visibility and Growth steps, then the brief | 10-minute lock; each step marked done only after it works; retries next hour; builder told on failure 1 and when it gives up after 3; owner never told |
| Vercel cron (`/api/cron?job=daily`) | 09:00 UTC daily (`vercel.json`) | Backup for the morning job, checks the hourly job is still running | Same recording and alerts; synchronous, so bound by the function time limit |
| Feedback emails (inside hourly) | Hourly, about 3h after redemption | "How was your visit?" emails in sending hours | Failed sends count as a job failure and alert the builder |
| Weather (inside hourly) | Once a day per restaurant, first run backfills 12 months | Open-Meteo daily weather | Error recorded in the run summary |
| Agent job runner (`runQueuedAgentJobs`) | After every owner message and every cron run (max 4 per restaurant per cron run) | Shadow and live agent work | Invalid output retried once, then failed and builder alerted |

## F. Test results

Run on 14 Oct 2026 in `C:\Users\miraa\dev\naila-agents`, no network, Supabase and Claude replaced by stand-ins.

| Check | Result |
|---|---|
| Type-check (`next typegen` + `tsc --noEmit`) | Pass, 0 errors |
| Lint (`eslint`) | Pass, 0 problems |
| `npm test` with TEST_MODE unset | 48 files passed; 717 tests passed, 1 skipped, 0 failed (about 30s) |
| `npm test` with TEST_MODE=true (as on Vercel) | 48 files passed; 717 tests passed, 1 skipped, 0 failed |
| Skipped test | `tests/agents/reputation-cases.test.ts`, case `agents/tests/reputation/13-stars-only-five.json`: marked `pending_decision` (the checker fails Reputation's one-line thanks on a stars-only review in 2 of 3 runs) |
| Not run | Live agent evals (`tests/agents-live/*.eval.ts`, real Claude, by hand only) and end-to-end runs (`tests/e2e/onboarding.e2e.ts`, `tests/e2e/sales.e2e.ts`, real database, Claude and Google), because they call real services |

Untested areas:
- Nothing runs against a real database, so SQL migrations, unique indexes, the atomic claim in `attemptSend` and pg_cron are not exercised by tests.
- No test of real Twilio delivery, Content templates or the 24h window against Twilio.
- No test of real Resend delivery, bounces or deliverability.
- Web pages and server actions (settings, sales upload, onboarding wizard UI, report page) have no rendering or browser tests.
- Legacy prompts (`src/lib/assistant.ts`, `src/lib/checks/ai.ts`, Z-report and menu reading) have no saved eval cases.
- No load or timing test of the hourly cron with many restaurants.
- POS import above 50,000 rows (silent truncation) is not covered.

## G. Top 10 risks and tech debt at pilot scale

1. Google is not connected. `src/lib/google/live.ts` is a stub that throws, so the main promise (review replies, posts, hours) cannot reach a real listing. Pilots get the paste-in fallback only.
2. The hourly cron runs every restaurant one after another in one function with `maxDuration = 300` (`src/app/api/cron/route.ts`). At 9:05 that includes each restaurant's morning job (Claude writes drafts and, on Mondays, the report) plus up to 4 agent jobs each. With 10 to 20 restaurants it will run out of time, and the restaurants later in the list will be late or skipped every day.
3. WhatsApp is the Twilio sandbox. Every owner must join it, there's no approved template, so the 9am brief waits until the owner messages, and builder WhatsApp alerts can silently fail. This needs a Meta-verified sender before a real pilot.
4. TEST_MODE does two jobs. It protects customers (redirects email) and it is the only way to switch on GM, Visibility, Insights and Growth live. You cannot pilot those agents without also redirecting every pilot customer's email to yourself.
5. Two systems run side by side. The legacy assistant and the agents in shadow both run on every review, post, offer ask and brief, which roughly doubles Claude spend and doubles the code to maintain. Cost tracking (`src/lib/agents/costs.ts`) only counts agent jobs, so real cost per restaurant is under-reported.
6. No database-level isolation: 39 tables have RLS on but no policies, and the app uses the secret key. One missed `.eq("restaurant_id", ...)` in new code leaks data between restaurants; only `tests/isolation.test.ts` guards it.
7. No data retention. Messages, drafts, audit log, WhatsApp logs, Z-report photos and feedback are kept forever (only `rate_limits` is purged). This is a UK GDPR problem once there are real customers.
8. Resend free plan (100 emails a day, 3,000 a month) and Supabase's built-in login email (a few an hour). One campaign to a single restaurant's list can exhaust the daily email quota.
9. POS import silently drops rows past 50,000 (`src/lib/sales/pos-table.ts` toTable) under a 4 MB cap. A 12-month item-level export from a busy site will either be refused or partly imported with a wrong final day.
10. The webhook does all its work in `after()` inside one function, including onboarding, Claude calls and then `runQueuedAgentJobs`. A slow Claude call or a backlog of agent jobs can hit the 300s limit, with no retry for the owner's message beyond "Sorry, something went wrong".

## H. Open questions to check by hand

1. Is TEST_MODE set to `true` in Vercel Production right now? If so, every customer email goes to the builder and agents can go live. Check: Vercel > project > Settings > Environment Variables > TEST_MODE (Production).
2. Which Vercel plan is the project on, and is Fluid Compute on? This decides whether `maxDuration = 300` is honoured for the webhook and cron. Check: Vercel > project > Settings > Functions.
3. Has every SQL file up to `024_gm.sql` run on the live database? Run `node --env-file=.env.local scripts/check-schema.mjs` in the worktree.
4. Is the pg_cron job still firing at 5 past every hour? Check: Supabase > Integrations > Cron, or the "Scheduled jobs (builder only)" section on /log.
5. What `agent_modes` are set per restaurant in the live database? In particular, is any restaurant on Reputation live (the one agent that can be live outside test mode)? Check: Supabase > Table Editor > restaurants > agent_modes.
6. Are the Turnstile keys and GOOGLE_PLACES_API_KEY set in Production? Without them CAPTCHA and the Google onboarding step are quietly skipped.
7. Resend: which plan, and how many emails were sent in the last month? Check: resend.com > Usage.
8. The OneDrive copy of the repo (`Naila Restaurant Owner\naila-app`) is on `main` 84 commits behind, and its CLAUDE.md stops at step 14. Do you want it pulled up to date or treated as archive, so future sessions don't read the wrong code?
9. The skipped Reputation case (`13-stars-only-five.json`) is waiting for a wording decision in `agents/checker.md` or `agents/reputation.md`.
10. profile-keeper is defined in `agents/profile-keeper.md` with no code and no test cases. Is it still planned?
