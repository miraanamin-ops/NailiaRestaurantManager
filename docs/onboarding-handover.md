# Onboarding with Dina: handover

Written 29 Oct 2026, at the end of phase 4, so the work can carry on in a fresh session.
Branch `onboarding-dina` (worktree `C:\Users\miraa\dev\naila-dina`), pushed to GitHub, **not merged**: today's onboarding is still the one live on main.

Read with:
- `docs/onboarding-spec.md`: the original brief, word for word.
- `docs/onboarding-audit.md`: the phase 0 audit, the decisions, and the phase table.
- `CLAUDE.md`, step 37 and the "Onboarding with Dina" working notes: file by file.

## 1. Phases done

| Phase | What | Commits |
|---|---|---|
| 0. Audit | `docs/onboarding-audit.md`: what existed, what to change, the plan, nine questions | 029ec45 |
| 1. Foundation | The 12 steps as pure code (`src/lib/onboarding/flow.ts`), saved per restaurant (`sessions.ts`, `startOnboarding(siteId)` the one way in), setup gaps (stored; nudges later), the test-site wall, migration 048 with RLS | 40f792a |
| 2. Sign-up and entry | No paywall (`ONBOARDING_REQUIRES_PAYMENT` off), invite code required, DPA in the tick box with versions saved, straight-in login for brand-new owners (limited to their restaurant), "You're in" page, WhatsApp linked by the sign-up number, strangers get no reply, migration 049 | e638c3f |
| Between 2 and 3 | Local work on the dev project by default, live only on purpose; setup-hook timeout for the PGlite test files; migrations 046 to 050 applied to dev | 8bda1dd, b9e68dc |
| 3. Dina | `agents/dina.md` and `agents/dina.config.json`, `dinaTurn` (one turn for both channels), checked tools, coded reply checks, data kept as data, cost per run (migration 050) | c16d40b, dd0fd5d |
| 4. Web chat | Components (each tested), the look signed off from screenshots, the streaming endpoint, the real `/onboarding/chat`, then fixes from the first real browser run on dev | b6c3adb, 80fd7a6, 6364a1d |
| Next.js fix (30 Oct) | 16.4.0 to 16.4.3 (three advisories, one of which we were exposed to: Server Actions denial of service), on its own branch, merged to main as PR #29 and live; this branch rebased onto it | d20e626 |
| After your browser test (30 Oct) | Sign-up goes straight into the web chat, with "Continue on WhatsApp" in its header; Dina introduces herself on her own (the opening had failed on a too-long button label); no "I'm an AI" unless asked | 255cc05 |
| Speed (31 Oct) | One Claude call per turn (notes in the reply), the router only when needed, the hour-long cache: a WhatsApp reply's Claude time from 4 to 6 s to 1.3 to 2 s | 55a2230 |
| 6. Steps 1 to 3 | Hello's Google Maps pre-fill; Google (three questions, steps card with screenshots, forward message, Connect Google behind a switch, invited, simulated or builder acceptance, the 24-hour nudge, email the steps); tone (config file, real reviews, replies written and checked, taps saved by code, write my own, skip = warm, queue replies as held drafts); migration 052 | see git log |
| 7. Steps 4 to 6 | Making it right (offers within the cap), menu (read from photos or a PDF on both channels, checked card, allergens dish by dish with code's own cards, no accept-all), hours and FAQs (halal in the owner's words), web uploads straight to the private bucket, notes as a list (API limits), the "saved" check, the Places daily cap, builder commands locked to the builder's number; migration 053 | see git log |
| 8. Summary and test controls | Finishing (WhatsApp linked, both setup records closed, switched on by the access rule), the summary card with Change links, `/onboarding/admin` test controls incl. Mark Google accepted, the full real run ($0.18), the Vercel test-mode build fix, the preview bypass, `docs/phone-test.md`, `docs/merge-checklist.md` | see git log |
| 5. WhatsApp | Dina on WhatsApp through the same turn: buttons, lists and the numbered fallback, replies read back, photos/PDF/CSV/Excel into a private bucket (16 MB, checked by content), one reply per burst of photos, linking hands over to Dina at the exact step, the sandbox check script, migration 051 | see git log |

| Previews on dev (1 Nov) | Every Vercel Preview uses the dev database (the `SUPABASE_*` settings split; Production unchanged), with its own safe switches; a preview only sends WhatsApp to `BUILDER_WHATSAPP` (`whatsAppSendAllowed` in `switches.ts`). Checked: a test sign-up on the preview landed in dev, not live | d275d61 |
| "Not answered" is a gap (1 Nov) | A common question Dina notes "(not answered)" makes Hours and FAQs half done, with a gap line naming those questions; answering later closes it. A half-done step can carry its own gap line (`gap_unlock`) | 9541075 |
| 9. Steps 7 to 10 and 12 (1 Nov) | Sales history (the existing POS importer, "Got it: 11 months of sales…", under 8 weeks half done), team and labour (rota team, cover rules, 30% default flagged), rewards and the cap, the QR codes (email and WhatsApp), approvals and timing (brief hour 7 to 11, sending hours). Per-restaurant brief hour in the morning job and the late-brief alert; migration 054 | 49eb9dc |

Milestone A (pilot-usable Dina) is built, and milestone B's phase 9. Before merging: your phone test (`docs/phone-test.md`) and the merge checklist (`docs/merge-checklist.md`).

## 2. Every decision you made

### The nine audit answers (28 Oct)

| # | Question | Your answer |
|---|---|---|
| 1 | Stripe was already built | Approved: kept in the code, switched off. `ONBOARDING_REQUIRES_PAYMENT` defaults to false: every sign-up needs an invite code and Stripe is never opened. `TODO(stripe)` marks where it plugs back in. |
| 2 | Getting into the web chat after sign-up | **Changed**: log a brand-new owner straight in after sign-up so "You're in" opens the chat directly, and still send the login email in the background. Then (Phase 2): use the same session approach as the existing login, and confirm no new routes are reachable without it. |
| 3 | Linking WhatsApp by number | Approved: the first message from the sign-up number links it, the one-time code stays as a fallback, unknown numbers get nothing. Then (Phase 2): if the number is already linked to another restaurant, don't link it automatically; fall back to the code and tell the owner why. |
| 4 | Accounts and memberships | **Changed**: out of scope. The site manager is a team member with no login. |
| 5 | `is_test` vs `is_demo` | Approved (a test site is always a demo), **plus**: confirm the demo rules cover WhatsApp to customers and Google, and extend them if not, so a test site can never send anything real on any channel. They didn't cover email or Google, so the test-site wall was built (section 3). |
| 6 | Allergens | **Changed**: keep the AI suggestions, clearly marked as suggestions. The owner confirms each dish; no "accept all". Unconfirmed is unknown everywhere: never shown to customers, never in Dina's answers. |
| 7 | Finishing without WhatsApp | Approved: finishing needs WhatsApp linked. |
| 8 | Brief time | Approved: whole hours, 7am to 11am. |
| 9 | Branch and pushing | Approved: branch `onboarding-dina`, pushed after each phase; the current onboarding stays live on main until you merge. |

### Your other decisions

- **Phase order** (28 Oct): the first milestone is a pilot-usable Dina: sign-up, channel choice, steps 1 to 6, the summary, and setup gaps stored (nudges later). Customer list import, languages, resume reminders and the admin onboarding view come later. I added the builder's test controls to milestone A, because repeated testing needs them.
- **Step 12's unlock line**: "Tell me who approves and when to message you, and I’ll fit around your day."
- **Before Phase 3**: local development against the dev project by default, hard to point at live by accident; run the straight-in login once against dev; check whether the queue test timeout is load or a race, and raise its timeout if it's load.
- **For Dina** (Phase 3): model name and per-step token limits in config, not code; everything from menus, reviews and uploads is data, never instructions; a coded check on her replies before they're shown (no em-dashes, never claiming to be a person); cost logged per onboarding run, to confirm the $0.50 to $1 estimate.
- **For the web chat** (Phase 4): mobile-first from the brand tokens, big tap targets, no sideways scroll at 375px; stream Dina's replies with a typing indicator; reusable components, each with its own test; screenshots at phone and laptop width before wiring the steps.
- **The look**: signed off from the screenshots (29 Oct, "all good").
- **Streaming**: message by message, after the checks (each message appears whole once checked; never word by word, which would show unchecked text). Agreed with the same "all good".
- **The browser check**: you meant to test it yourself. A test invite code is set up for you (section 6).

### Decisions of 1 Nov

- **Previews**: every Preview deployment uses the dev database, not just this branch's; Preview-only `TEST_MODE`, `TEST_TOOLS`, `GOOGLE_MODE=dummy`, `EMAIL_REDIRECT`; outbound WhatsApp from a preview only to the builder's number.
- **Brief time**: a job every hour sends the brief to restaurants whose chosen hour it is, and the late-brief alert checks each restaurant's own time. It was a small change (the hourly job already gated on the hour), so it's built for real, not just saved.
- **Till export steps** (your click paths, in `POS_TIPS` in `src/lib/onboarding/dina/ops-content.ts`; Dina asks for figures by day wherever the till allows it):
  - Square: Dashboard > Reports > Sales summary. Last 12 months, the export icon, then Start export (CSV).
  - Lightspeed K-Series: Back Office > Reports > All reports > Monthly Turnover. The period with the calendar icon, then Export CSV.
  - Epos Now: Back Office > Reporting > Sales Report. Report type "Time Period", the date range, Show by Time Interval: daily, Apply, then CSV or Excel.
- **Daily takings are imported** (these reports have no items): a file with a date and a takings column but no item column is saved as each day's totals (what the forecasts use), never as dish sales. Item files keep working as before and still feed dish-level data. If only daily figures came, the sales step is done and a low-priority "Item sales" gap is kept (`EXTRA_GAPS.sales_items` in `flow.ts`: the lowest nudge priority, never a blocker); Dina mentions in one line that an item export can unlock dish-level insights later. Tested with a sample in each till's usual layout plus a messy one (`tests/fixtures/sales/`, `tests/daily-sales.test.ts`); the real Claude column reader recognised all four as daily takings (`tests/e2e/daily-sales.e2e.ts`, about $0.02). The samples are hand-made, not real exports: a real file from each till is still worth trying.
- **Rewards**: once per customer, as built. Fine for the pilot.
- **Cover rules by day**: kept as notes on the step, as built. Fine for the pilot.
- **Test tools on Production**: only for a demo restaurant whose owner number is `BUILDER_WHATSAPP`; new sign-ups are never demo restaurants on Production (`testToolsFor`, `signupsAreDemo` in `switches.ts`). `/onboarding/admin` was already builder-only.
- **clear-dummy-data**: only touches test sites (`is_demo` and `is_test`); any other demo restaurant (Ember & Spice, Cardamom Corner) is listed as skipped and nothing of it is touched.
- **Live's demo restaurants** (read-only check, 1 Nov): 7 restaurants on live, all demo, none a real customer: Ember & Spice and Cardamom Corner (active, your demo pair), Tayyabs, Dishoom Shoreditch and Mangal 2 (inactive, example.com emails, test sign-ups), Test 1 and Test 2 (inactive, your Gmail).
- **Merge checklist** additions: switch Production `EMAIL_REDIRECT` off when the first real pilot goes live; check test tools are builder-only on Production; check no real restaurant is marked demo.
- **Takings are net sales** (excluding VAT, tips and service charge, after refunds and discounts) on every till: Square "Net Sales", Lightspeed K-Series "Turnover excl. VAT" (or its net turnover column), Epos Now "Net Sales". The column reader picks the net column for daily files and records it (`PosMapping.amount_basis`: "net"); that figure is saved as `sales_days.net_sales` as it is (`net_estimated` false). Files with amounts including VAT (item lines, or a daily file with no net column) still have the VAT taken off (estimated). The column check page has "The amounts are… net / including VAT". Dina says in one line which column she used. Labour % in the brief and report already divides by net sales (`sales_days.net_sales`, through the forecast and last week's actuals), so it uses the same figure.
- **Forecasts from takings alone** (your call, 1 Nov): the week-ahead forecast (brief, report, labour %) works without order counts: the same weekday's net takings over the last 8 weeks (middle and 10th to 90th percentile), times the recent trend (half the change of the last 4 weeks against the 4 before, at most 10%), times the time of year when there's a year of history (last year's days around the date against its 8 weeks before, at most 25%), times event effects learnt from takings (`baselineSales`, `recentTrend`, `timeOfYear` in `src/lib/forecast/baseline.ts`; tests in `tests/takings-forecast.test.ts`). Where a day's history has order counts, orders × average spend still decides (sharper; `dayRange` picks). The same back-test judges both, so the ranges only show when the error is within the limit. The nightly Python model still needs order counts; without them the week ahead uses this method.
- **Orders each day**: daily files map an orders column (transactions, receipts) into `quantity`; a file with one row per payment counts the different transaction ids each day (refunds lower the takings but aren't orders). A daily file with takings but no order counts completes the sales step and logs a low-priority "Order counts" gap (`EXTRA_GAPS.order_counts`, priority 80: after every step gap, before "Item sales"); Dina says in one line that order counts make forecasts more accurate.
- **Square's Transactions export** (one row per payment) imports: each day's net sales (refunds included) and its number of orders. It's now the first option in the Square tip, the Sales summary second. Tested only with a hand-made sample (`tests/fixtures/sales/square-transactions.csv`; the real column reader recognised it, about $0.01): **check against a real export** (the menu path, column names, and whether 12 months export in one go).
- **The five test restaurants are deleted from live** (1 Nov, `scripts/delete-restaurants.mjs ... --live --yes`): Tayyabs, Dishoom Shoreditch, Mangal 2, Test 1, Test 2, with their 93 rows and 13 photos; the 11 Stripe test events were kept without the link. Live now has only Ember & Spice Grill and Cardamom Corner Café.

## 3. The test-site wall

A test site is `restaurants.is_test = true`, which the database only allows on a demo restaurant (`restaurants_test_is_demo`). Whatever the switches (EMAIL_REDIRECT, GOOGLE_MODE) say:

| Channel | What stops it | Where |
|---|---|---|
| Customer email | Always redirected to the builder; the owner and builder still get their own | `redirectEmails` in `src/lib/gate-rules.ts`, used by `sendCustomerEmail` |
| Google (send gate) | A Google send on a test site is "simulated": logged, never posted | `simulationStep({ testSite })` in `gate-rules.ts`, used by `attemptSend` |
| Google (every API call) | Any write (POST, PUT, PATCH, DELETE) for a test site is refused before Google is called; a write that doesn't name its restaurant is refused too. Reads are fine. | `googleWriteRefused` in `gate-rules.ts`, checked in `gbp()` (`src/lib/google/api.ts`) |
| Google (mode) | A linked test site counts as "simulated", never "live" | `googleModeFor` in `src/lib/google/index.ts` |
| WhatsApp to customers | Off for every restaurant until Meta verification | `simulationStep` |

Tests: `tests/gate.test.ts`, `tests/google-live.test.ts` (test site section), `tests/switches.test.ts` (email). Ember & Spice is a demo restaurant but not a test site, so its planned live Google test isn't affected.

## 4. Local dev and live setup

**Worktree**: `C:\Users\miraa\dev\naila-dina` (outside OneDrive). The OneDrive copy of `naila-app` is old (127+ commits behind) and still has `.env.local` pointing at live: don't work there.

**Settings files in the worktree** (git ignores both):
- `.env.local`: the **dev** project (dinerai-dev, `nfphswknczyovnmnxjfa`). The default for `next dev`, the scripts and the e2e runs. Has the dev publishable and secret keys (you pasted them on 29 Oct), Anthropic, Twilio and Resend keys copied from live, `TEST_TOOLS=true`, `EMAIL_REDIRECT=true`, `GOOGLE_MODE=dummy`.
- `.env.live.local`: a copy of the **live** settings (`gfrkcvcqmdhdhpcytlkc`). Only used on purpose.

**Guards**:
- The app on this computer stops before any database call if its settings point at live (`src/lib/live-guard.ts`, in `getSupabase`, the login client and the proxy), unless `ALLOW_LIVE=true`. Vercel is unaffected.
- Every script that connects refuses live unless run with `--live`, then warns loudly: `node --env-file=.env.live.local scripts/<name>.mjs ... --live`. Seeds and dev-only checks (`check-signup-login.mjs`) never run on live. Tests: `tests/live-guard.test.ts`, `tests/seed-guards.test.ts`.

**Commands** (from the worktree):
- Dev server: `npx next dev -p 3123`. Next.js 16.4.0 stops the first start with a security-upgrade reminder when an AI agent runs it; starting it again straight away works: `(npx next dev -p 3123 || npx next dev -p 3123)`.
- Look of the chat: `http://localhost:3123/dev/chat-preview?scene=hello|google|tone|menu|summary` (local copies only).
- Dev migrations: `analytics/generator` folder, `C:\Users\miraa\dev\naila-synth\analytics\generator\.venv\Scripts\python.exe apply_migrations.py --env C:\Users\miraa\dev\synth.env --resume`. Dev has every migration up to 050.
- Straight-in login check against dev's real Supabase Auth: `node --env-file=.env.local scripts/check-signup-login.mjs` (passed all 7 checks on 29 Oct).
- Cost per onboarding run: `node --env-file=.env.local scripts/onboarding-costs.mjs [slug or id]`.
- Dina with real Claude on the in-memory database (about $0.05 to $0.10): `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina.e2e.ts`.
- Schema on live (read only): `node --env-file=.env.live.local scripts/check-schema.mjs --live`.

**Memory**: the laptop had about 1 GB free on 29 Oct. Claude Code stopped the dev server once for low memory, and long test runs time out under load. Close other apps before long runs.

**Live (app.dinerai.co.uk)**: unchanged by this branch until it's merged. Vercel's environment needs nothing new: `ONBOARDING_REQUIRES_PAYMENT` is off when unset. After merging, the live `/start` is invite-only and goes into Dina's onboarding.

## 5. Migrations still to run on live

Checked on live on 29 Oct (`check-schema --live`): 046 and 047 ran on 27 Oct; these three haven't run yet. Each only adds things, so run them before merging, in order (Supabase > live project > SQL Editor > paste > Run):

1. `supabase/048_onboarding_dina.sql`
2. `supabase/049_signup_sessions.sql`
3. `supabase/050_onboarding_ai_usage.sql`
4. `supabase/051_onboarding_uploads.sql` (phase 5: the private bucket for setup files)
5. `supabase/052_setup_nudges.sql` (phase 6: the hourly setup nudges job)
6. `supabase/053_restaurant_faqs.sql` (phase 7: the answers to common questions)
7. `supabase/054_brief_hour.sql` (phase 9: each owner's brief hour; applied to dev 1 Nov)

Rollback for all of them: `supabase/rollback/onboarding_dina_rollback.sql`.

## 6. Open items

- **A real export from each till** (Square, Lightspeed K-Series, Epos Now): the daily-takings import is tested on hand-made samples in their usual layouts. Send a real file from any pilot's till and Claude can check it reads.
- **Square: check against a real export (before the first Square pilot)**. Both Square imports and the Square tip are built from hand-made samples (`tests/fixtures/sales/square-transactions.csv`, `square-sales-summary.csv`), not real files. With a real Square account (a pilot's, or a free test account):
  1. Dashboard > Transactions: does that path exist as written, does Export > Transactions CSV give one row per payment, and can the last 12 months be exported in one go (or only in shorter ranges)?
  2. In that file: is there a "Net Sales" column (excluding VAT and tips), a "Transaction ID", and how do refunds appear (their own rows with negative amounts, or a "Partial Refunds" column)?
  3. Dashboard > Reports > Sales summary: can it show one row per day, and does it have "Net Sales"?
  4. Upload both files to a test onboarding: the sales step should say "Got it: …", name the "Net Sales" column, and (Transactions only) have order counts with no "Order counts" gap. Then correct `POS_TIPS.Square` in `src/lib/onboarding/dina/ops-content.ts` and the samples if anything differs.
- **The brief and the Monday report can show different forecast numbers for the same day** (found 1 Nov, fix proposed, waiting for your decision): both work the forecast out separately (a 60-second memory only), so a forecast run (05:35, or the 07:00 refresh, close to a 7am brief) or a sales upload landing between the report step and the brief step changes the second; and the report's "Last week" recomputes last week's forecast with the history method, while last Monday's brief may have shown the nightly model's numbers. Fix: save each restaurant's week forecast once a day (a snapshot table, migration 055) and have the brief, the report and the rota read it; "Last week" reads the snapshot made last Monday (what the owner was actually told).
- **The nightly Python forecast** still needs order counts; restaurants with takings only get the app's own takings method in the brief and report. Teaching the Python model the same is a later job if pilots mostly send takings only.
- **Rewards once per customer** and **cover rules by day kept as notes**: fine for the pilot (1 Nov); revisit after.
- **Production EMAIL_REDIRECT** stays on until the first real pilot goes live (merge checklist, "When the first real pilot restaurant goes live").
- **Customer list import** (the rest of step 10) and **languages and key dates** (step 11) come in milestone C.

- **Google screenshots**: placeholders in `public/onboarding/google/` (phone-1.png to laptop-4.png). Replace with real screenshots, same names. A short video slot is ready (`VIDEO_SLOT` in `src/lib/onboarding/dina/google-content.ts`).
- **GOOGLE_MANAGER_EMAIL**: set it on Vercel (and in the dev settings) so the steps show our manager email; without it they fall back to the manager login's email, or say it's being set up.
- **Marking Google accepted (real mode)**: WhatsApp `BUILDER GOOGLE ACCEPTED <link name>` until phase 8's admin page.
- **Allergen suggestions' cost** isn't in the per-run cost log yet (they use the older menu helper).
- **Menu dietary flags** (vegetarian, vegan, halal per dish) aren't stored: the menu tables have no column for them; halal is the restaurant's own statement.

- **Your own test of the web chat** (in progress): `http://localhost:3123/start?invite=TRY-DINA-2SOSX` (up to 5 sign-ups, a made-up email each time, a made-up 07700 900xxx number). Only Hello is fully built; steps 2 to 6 say they aren't ready.
- **Next.js security upgrade**: Next.js reports a known vulnerability in 16.4.0 (live too). You haven't answered whether to run the upgrade, on its own branch.
- **Steps 2 to 6 are placeholders**: Dina says she'll leave them, but doesn't always call `skip_step`; the "Skip for now" button always works. This goes away when phases 6 and 7 build the steps.
- **WhatsApp sandbox check on your phone** (phase 5): run `node --env-file=.env.local scripts/whatsapp-sandbox-check.mjs +44…` from the worktree, then the switch test from web to WhatsApp. Run `supabase/051_onboarding_uploads.sql` on live before merging (dev has it).
- **The data processing agreement is a draft** (`/dpa`): have someone qualified check it with the terms and privacy notice before the first real restaurant (also in `docs/before-launch.md`).
- **The sandbox join phrase** isn't in the dev settings (`TWILIO_SANDBOX_JOIN`), so "You're in" on a local copy doesn't show the join step. Live has it.
- **The login email at sign-up** goes through Supabase's built-in email: a few an hour, and only to team members on the dev project. Signing in doesn't depend on it (the owner is already logged in).
- **RLS protects owner logins, not the app**: the app uses Supabase's secret key, as everywhere else (known limit).
- **Test data on dev**: restaurants "Dina Test Grill" and "Saffron Test Kitchen" (demo, not `is_test`), invite codes `DINA-E2E-MVSTU4PI`, `DINA-E2E-MVU2LOZ4` (used up) and `TRY-DINA-2SOSX` (yours). Fine to leave; the phase 8 test controls will make proper test sites.
- **Later, by plan**: steps 7 to 12, gap nudges in the brief, customer list import, languages and key dates, resume reminders, the admin onboarding view, retiring the old onboarding (milestones B and C in the audit).

## 7. Phase 5 plan: WhatsApp

Goal: the same Dina, the same progress, on WhatsApp. An owner can start on the web and carry on on WhatsApp, or the other way round.

1. **Routing**: in the webhook (`src/app/api/whatsapp/route.ts`), a restaurant with an unfinished Dina session (`onboarding_sessions`, flow version 2) goes to a new `handleDinaWhatsApp`, on the job queue like owner messages (one at a time per restaurant, the Twilio message id as the job key and as Dina's `externalId`, so a repeat delivery is answered once). Old-flow restaurants keep the old flow.
2. **First message after linking**: Dina's `start` (or `resume`, if they began on the web) turn instead of the fixed "Linked!" line, so the chat carries on from the exact step.
3. **Rendering** (`src/lib/onboarding/dina/whatsapp.ts`, pure and unit-tested; `whatsapp-send.ts` sends):
   - Plain messages as text, one WhatsApp message each.
   - Quick replies: up to 3 as Twilio quick-reply buttons (the existing per-message title templates in `src/lib/whatsapp.ts`); 4 to 10 as a list message (`twilio/list-picker`); always with "Reply 1, 2 or 3" text as the fallback.
   - Choice cards (tones): one message per card with its number, then the choice as buttons or a list.
   - The confirmation card: its rows as text, then "Looks right" / "Change something" buttons.
   - The summary: as text, with a link to the web summary.
   - Upload: plain instructions ("Send me a photo of each page, or the PDF").
   - "Skip for now": a button or number on skippable steps, the same as the web's.
   - Messages under WhatsApp's limits (1,024 characters with buttons, 1,600 without).
4. **Reading replies** (pure, unit-tested): a button tap's payload, or "1", "2", "3", or the option's own words, back to the option of the last Dina message that asked; "skip", "go back to the menu" and the like through the same paths as the web (code skips; the router moves).
5. **Photos and files**: saved like today's onboarding (several at once), passed to Dina as data. Reading menus comes in phase 7; until then she says she's got them.
6. **The 24-hour window**: inside it, everything as above. Outside it, sends fall back to waiting (as the brief does now). The Meta templates to request later stay as listed in the audit (resume, gap nudge, Google nudge).
7. **Sandbox check, by hand on your phone**: buttons, list messages and the numbered fallback on the real Twilio sandbox, then switching from web to WhatsApp and back mid-step.
8. **Tests**: rendering and reply parsing (pure), the webhook routing (old flow vs Dina, a repeat delivery answered once, a stranger silent), and a scripted Dina run over WhatsApp on the in-memory database.

Effort: about one session, plus your phone check.
