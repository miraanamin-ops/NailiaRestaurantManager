# Founder dashboard (/admin, step 52)

The plan (with the owner's comments) is the Claude Doc "DinerAI founder dashboard plan":
https://claude.ai/artifact/5WWsfpq4YPe8aC48Jqgw3W

## Who gets in

Only `FOUNDER_EMAIL` (default `miraan@dinerai.co.uk`), logged in with email and password.
Anyone else, the builder and owners included, gets "Not found" and no header. A login made by
a restaurant sign-up never counts, even with that email, and sign-up refuses that email.
The founder has no builder powers: "Their activity log" and "Their dashboard" links need the
builder login.

First login on any database: /login > "Forgot your password, or never set one?" with the
founder email; the emailed link sets the password.

## Pages

- `/admin`: needs attention, headline numbers (each with its definition on the i), 12-month
  charts, setup funnel, trials ending, engagement, referrals, FOUNDER code, system, Claude by use.
  "Show test sites" includes demo, test and Pilot Zero restaurants (left out by default).
- `/admin/clients`: search (name, email, phone, referral code), filters, sorting, CSV download.
- `/admin/clients/<id>`: key facts, health, problems (30 days; Retry on dead jobs), usage, Claude
  costs by use, setup, billing history, recent conversation (logged: `founder_viewed`, hidden
  from owners), activity, quick links, and Delete their account (the same two steps and 24-hour
  cooling-off as the builder's close-account page, `lib/closure.ts`).
- `/admin/costs`: running costs by month, fixed bills, the prices used for estimates.
- Monday 8am UK: an email to the founder with the headline numbers (hourly cron).

## Where the numbers come from

- `ai_usage`: every Claude call (`lib/claude.ts` wraps the client; `claude("<purpose>")`;
  restaurant from `lib/ai-context.ts`, set by the queue worker, the app API and Dina's chat).
  Before it started, `agent_jobs.cost_usd` and `onboarding_ai_usage` stand in (never both).
- `billing_history`: standing changes and payments from the Stripe and RevenueCat webhooks and
  account closing. 070 writes one "backfill" line per restaurant (where it stands today).
  `scripts/founder-backfill-stripe.mjs` replaces those with Stripe's real dates and payments.
- No foreign key to restaurants on either table: a closed account's anonymous numbers stay.
- Sums in plain code: `lib/founder/metrics.ts` (tests: `tests/founder-metrics.test.ts`).

## Turning it on (live)

1. Run `supabase/070_founder_dashboard.sql` in Supabase > SQL Editor (live project).
2. Merge the branch; check Vercel deployed.
3. Log in at app.dinerai.co.uk/login with "Forgot your password" (see above), then open /admin.
4. Stripe history, once: `node --env-file=.env.live.local scripts/founder-backfill-stripe.mjs --live`
   (dry run), then again with `--apply --live`. Needs the live Stripe key in STRIPE_SECRET_KEY.
5. Cancellation reasons: Stripe Dashboard > Settings > Billing > Customer portal >
   Cancellations > turn on "Ask for a cancellation reason". They then show on the client page.
6. Costs page: add the fixed monthly bills (Vercel, Supabase, Railway, Apple developer account,
   domains, Resend, Twilio).

Rollback: `supabase/rollback/founder_dashboard_rollback.sql` (loses the cost and billing history).
