@AGENTS.md

# Naila (working name)

## What this is
An AI marketing assistant for independent single-site restaurants. The owner runs everything through WhatsApp: the AI drafts the work, the owner taps Approve, Edit or Skip, and nothing goes out unless it passes plain-code safety rules. The user is not a developer, so explain things simply and give exact click paths when you need something from them.

Right now it's being built to test alone with dummy data. No real customers, no live Google connection.

## Stack
Next.js (TypeScript) on Vercel, Supabase (database), GitHub, Claude API (Sonnet), Twilio WhatsApp sandbox (owner channel only), Resend (customer emails, test mode). All keys are Vercel environment variables, never in code.

## Built so far
1. Skeleton app with dummy data: one restaurant (halal grill in East London), customers and Google-style reviews, plus a page showing the data.
2. WhatsApp assistant: the owner chats with Claude, which has the restaurant profile and data as context. All messages logged.
3. Approval loop: drafts sent with Approve, Edit, Skip. Edits and skip reasons saved and used to learn the restaurant's tone. "NEW REVIEW" test command.
4. Safety rules in code: nothing sends without approval, 9am to 9pm UK send window, discount cap per restaurant, no duplicate sends, PAUSE/RESUME, blocked sends logged. A separate Claude checker reviews each draft. "TIME hh:mm" test command.
5. Customer sign-up by email (not WhatsApp): QR code to a branded form, unticked consent box, consent saved with timestamp and wording, privacy notice. Owner sets the sign-up reward via WhatsApp. Welcome email with a one-time redemption page: "Redeem now" turns the screen green with a live clock, expires after 10 minutes, then shows "Already used". Owner notified on WhatsApp. Unsubscribe link in every email.
6. Email campaigns: owner texts e.g. "Thursday is quiet", gets a drafted offer to approve, sent to a segment (everyone, birthdays in next 7 days, unredeemed new sign-ups). Weekly birthday draft. Only consented customers. Real email to the owner, dummy customers marked "simulated sent". Tracks sends, opens, clicks, redemptions.
7. Google: all actions behind a "Google connector" module with dummy and live modes. Hourly review check: 4 to 5 stars to the approval queue (held for the morning brief since step 8), 1 to 3 stars trigger an instant alert. Pasted real reviews get a copy-paste reply. 2 drafted posts a week, WhatsApp photos captioned into posts. "RUN REVIEWS" and "RUN POSTS" test commands. Google-style preview page.
8. Morning brief and Monday report: drafts the system makes on its own (review replies, posts, birthday emails) are held quietly; only 1 to 3 star alerts and things the owner asks for arrive straight away. 9am brief: numbered list of everything waiting, each item with its own Approve/Edit/Skip buttons, "APPROVE ALL" (or "APPROVE 2" etc.), plus a one-line "done for you" tally; tally only if nothing to approve, nothing at all on a quiet day. If the owner hasn't messaged in 24 hours (WhatsApp rule) the brief waits and arrives with their next message. Monday report replaces the Sunday round-up: mobile-first web page (headline, reputation, customers and campaigns, Google visibility, next week's 3 actions with "Start in WhatsApp" buttons), last week vs the week before with small charts, modular sections, "Download PDF" with the same content, two-line WhatsApp headline with the link. "RUN BRIEF" and "RUN REPORT" test commands. Two weeks of removable dummy activity (`scripts/seed-two-weeks.mjs`).
9. Hardening and tidy-up: only the registered owner WhatsApp number can use the assistant (others ignored); duplicate Twilio deliveries ignored; test-data dashboard behind a password; the morning job retries each step hourly and tells the owner if it fails; scheduled jobs always use the real clock; all Claude calls on Sonnet 5.5 with refusal fallback; `bot.ts` split into `lib/bot/`; shared date/text helpers; `setup.sql` can't wipe an existing database; every SQL file records itself in `schema_migrations`. "REPORT" renamed "CAMPAIGN RESULTS".

## Design rules to keep following
- Every message to the owner carries a decision or a result. No "just checking in".
- Do the work before asking: arrive with a finished draft so approval is one tap.
- Batch, don't drip. Real-time only for urgent things.
- Nothing reaches a customer unchecked.
- Every feature gets a test command so the owner can trigger it without waiting.

## Working notes (for Claude)
- Update the "Built so far" list above at the end of every step.
- Live site: https://nailiarestaurantmanager.vercel.app (auto-deploys from `main` on GitHub). Background Claude sessions can't push to `main`: each step ends on a branch the user merges on GitHub.
- Security: the WhatsApp webhook checks Twilio's signature, then only accepts the number in `restaurants.owner_whatsapp` (a fixed setting, never taken from a message; change it in Supabase's Table Editor). The dashboard `/` needs `DASHBOARD_PASSWORD` (`src/proxy.ts`). Customer, offer and report pages use unguessable tokens. The app uses Supabase's secret key, which bypasses row-level security.
- Schedulers: Supabase pg_cron + pg_net calls `/api/cron?job=hourly` at 5 past every hour (`supabase/007b_hourly_schedule.sql`, secret in Supabase Vault): review check, and from 9am UK time the once-a-day morning job (`src/lib/morning.ts`: release held sends, Monday birthday email, Mon/Thu Google post, Monday report, then the brief). Each step is marked done only after it succeeds; a failed run retries next hour (10-minute lock, owner told on the 1st failure, gives up after 3). `restaurants.last_brief_on` = the day's brief is done. Vercel cron `/api/cron?job=daily` (09:00 UTC, `vercel.json`) is only a backup. Both use the `CRON_SECRET` bearer token. (Vercel's free plan: daily jobs only, timing within the hour, UTC.)
- Claude: model and settings in `src/lib/claude.ts` (`claude-sonnet-5-5`, `MAX_TOKENS`, server-side refusal fallback via the beta endpoint). Prompts in `src/lib/assistant.ts`; the checker (`src/lib/checker.ts`) uses the same model for now (Haiku to be tested).
- Morning brief: `src/lib/brief.ts`. Draft modes in `createDraft`: present / hold (for the brief) / urgent. Brief items use a second Twilio template whose button ids carry the draft id (`approve:<uuid>`). Known limit: outside WhatsApp's 24h window a real launch needs a Meta-approved template message to open the conversation; for now the brief waits (`brief_waiting_since`).
- Weekly report: `src/lib/report/` (numbers in plain code, words from Claude, saved as a JSON snapshot in `reports`), page `src/app/report/[token]`, PDF via `@react-pdf/renderer` at `/report/[token]/pdf`. To add a section (Sales etc.): a type in `report/types.ts`, a builder in `DATA_SECTIONS` in `report/build.ts` (with `connected()`), a renderer in `sections.tsx` and in `pdf.tsx`.
- Database changes are numbered SQL files in `supabase/` that the user pastes into Supabase > SQL Editor. Every file is safe to re-run and ends by recording its name in `schema_migrations`; `scripts/check-schema.mjs` shows which haven't been run. `setup.sql` refuses to run on an existing database (delete its SAFETY GUARD block to really start again). A file that removes something the live code still uses must run only after the new code is live (e.g. `010_drop_unused.sql`).
- WhatsApp: inbound webhook `src/app/api/whatsapp/route.ts` (signature, owner number, duplicate check) → `handleMessage` in `src/lib/bot/index.ts`. `bot/parse.ts` reads commands, buttons and item numbers (no imports, unit-tested); `commands.ts` runs commands and holds the HELP text; `decisions.ts` Approve/Edit/Skip; `conversation.ts` edits, skip reasons and chat; `flows.ts` writes, checks and shows each kind of draft. Buttons via the Twilio Content templates in `src/lib/whatsapp.ts`; typed 1/2/3 also works.
- Drafts and the approval queue: `src/lib/drafts.ts` (`createDraft` modes present/hold/urgent; one draft "on screen" at a time via `waiting_for`). Every send goes through `attemptSend` in `src/lib/send.ts`.
- Shared helpers: London dates in `src/lib/clock.ts` (`londonYmd`, `londonLongDate`, `londonWeekday`, `startOfLondonDay`); text in `src/lib/text.ts` (`plural`, `clip`, `shorten`).
- Test clock: TIME sets `restaurants.fake_now`; owner-triggered code uses `restaurantNow()`. Scheduled jobs pass `loadRestaurantContext({ realTime: true })` so they always use the real time.
- Local helpers in `scripts/` run with `node --env-file=.env.local scripts/<name>.mjs` (e.g. `brief-state`, `check-schema`, `seed-two-weeks [--remove]`). Local WhatsApp tests: `settings-snapshot test <file>` (saves settings and registers the fake test number as owner), dev server with APP_URL, `test-webhook`, `show-conversation`, then always `settings-snapshot restore <file>`. `npm test` runs unit tests in `tests/`.
- On Windows, don't write JSON/.env files with PowerShell `Set-Content -Encoding utf8` (adds a BOM that breaks them).

## Known limits (to fix before real restaurants)
- One restaurant only: `loadRestaurantContext()` loads the first restaurant, and database access uses the secret key, so separating restaurants depends entirely on the code.
- No owner login on web pages; report links never expire.
- WhatsApp sandbox: outside the 24-hour window the 9am brief waits for the owner's next message (needs a Meta-approved template and a real sender).
- Email: sent from onboarding@resend.dev (lands in spam); no double opt-in; no rate limit on the sign-up form.
- Test commands (TIME, NEW REVIEW, TEST SEND, RUN …) and dummy data are always on.
- Tests cover pure code only (clock, discounts, parsing, report maths); the safety rules, consent filter and brief need tests against a test database. No CI.
- Every chat message sends Claude the full customer list and reviews.
- Live Google connector is a stub.
