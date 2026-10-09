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
7. Google: all actions behind a "Google connector" module with dummy and live modes. Hourly review check: 4 to 5 stars to the approval queue, 1 to 3 stars trigger an instant alert. Pasted real reviews get a copy-paste reply. 2 drafted posts a week, WhatsApp photos captioned into posts. "RUN REVIEWS" and "RUN POSTS" test commands. Google-style preview page.

## Design rules to keep following
- Every message to the owner carries a decision or a result. No "just checking in".
- Do the work before asking: arrive with a finished draft so approval is one tap.
- Batch, don't drip. Real-time only for urgent things.
- Nothing reaches a customer unchecked.
- Every feature gets a test command so the owner can trigger it without waiting.

## Working notes (for Claude)
- Update the "Built so far" list above at the end of every step.
- Live site: https://nailiarestaurantmanager.vercel.app (auto-deploys from `main` on GitHub). Public, no login yet: add auth before any real customer data.
- Schedulers: Vercel crons in `vercel.json` (`/api/cron?job=daily` 09:00 UTC, `?job=weekly` Sunday 17:00 UTC; Vercel's free plan allows daily jobs only) and Supabase pg_cron + pg_net for `?job=hourly` (`supabase/007b_hourly_schedule.sql`, secret in Supabase Vault). All three hit `src/app/api/cron/route.ts` with the `CRON_SECRET` bearer token. Vercel cron times are UTC, so 09:00 UTC is 10am UK in summer time.
- Database changes are numbered SQL files in `supabase/` that the user pastes into Supabase > SQL Editor. Re-running `setup.sql` wipes all data.
- WhatsApp: inbound webhook `src/app/api/whatsapp/route.ts` → `handleMessage` in `src/lib/bot.ts` (typed commands in `parseCommand`, HELP text alongside). Buttons via the Twilio Content template in `src/lib/whatsapp.ts`; typed 1/2/3 also works.
- Drafts and the approval queue: `src/lib/drafts.ts` (`createDraft` modes present/queue/urgent; one draft "on screen" at a time via `waiting_for`). Every send goes through `attemptSend` in `src/lib/send.ts`; the Claude checker is `src/lib/checker.ts`.
- Test clock: TIME sets `restaurants.fake_now`; use `restaurantNow()`. Scheduled jobs always use real time.
- Local helpers in `scripts/` run with `node --env-file=.env.local scripts/<name>.mjs`. `npm test` runs unit tests in `tests/`.
- On Windows, don't write JSON/.env files with PowerShell `Set-Content -Encoding utf8` (adds a BOM that breaks them).
