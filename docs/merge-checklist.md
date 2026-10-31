# Merging onboarding with Dina: checklist

Everything to do, in order, to put the `onboarding-dina` branch live, how to check
each part worked, and how to go back quickly if something breaks.

The branch changes how **new** restaurants sign up and set up: invite-only sign-up
straight into the chat with Dina, on the web and WhatsApp. Running restaurants
(their assistant, briefs, reviews, campaigns) are not changed. Restaurants part way
through the older setup carry on with it.

---

## Before merging

### 1. Database: migrations 048 to 053, in this order

Supabase > the **live** project (gfrkcvcqmdhdhpcytlkc) > **SQL Editor** > **New
query**. Paste each file, click **Run**, and wait for "Success" before the next.
Each one only adds things (tables, columns, a storage bucket, a job type), so the
site as it is now keeps working with them.

| # | File | What it adds |
|---|---|---|
| 1 | `supabase/048_onboarding_dina.sql` | setup sessions, steps, the conversation, setup gaps, test sites, invite types |
| 2 | `supabase/049_signup_sessions.sql` | the login made at sign-up, limited to that restaurant |
| 3 | `supabase/050_onboarding_ai_usage.sql` | the cost of every Claude call during setup |
| 4 | `supabase/051_onboarding_uploads.sql` | the private bucket for setup files (16 MB, photos, PDF, CSV, Excel) |
| 5 | `supabase/052_setup_nudges.sql` | the hourly setup nudges job |
| 6 | `supabase/053_restaurant_faqs.sql` | the answers to common questions |

**Check:** in the SQL Editor, run:

```sql
select name from schema_migrations
where name between '048' and '054'
order by name;
```

Six rows, 048 to 053. Or ask Claude to run
`node --env-file=.env.live.local scripts/check-schema.mjs --live` (read only).

### 2. Vercel: production settings

Vercel > **nailiarestaurantmanager** > **Settings** > **Environment Variables**.

**Add** (tick only **Production**):

| Name | Value | Why |
|---|---|---|
| `GOOGLE_MANAGER_EMAIL` | `dina@dinerai.co.uk` | the email owners invite on Google; without it the steps say it's "being set up" |

**Optional** (only if you want something other than the default):

| Name | Default | What it does |
|---|---|---|
| `PLACES_DAILY_MAX` | 100 | our daily cap on Google Places calls |
| `ONBOARDING_GOOGLE_CONNECT` | off | `true` offers "Connect Google" (sign in with Google) instead of the manager steps; needs Google sign-in set up |
| `DINA_FILE_BURST_MS` | 6000 | how long WhatsApp waits for more photos before answering once |

**Leave unset:** `ONBOARDING_REQUIRES_PAYMENT` (off = invite code only, no Stripe).

**Already there; check they're set for Production:** `TWILIO_SANDBOX_JOIN`,
`BUILDER_WHATSAPP`, `BUILDER_EMAIL`, `GOOGLE_PLACES_API_KEY`, `EMAIL_FROM_DOMAIN`,
`APP_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`. In Google Cloud, restrict
live's Places key the same way as dev's: Places API (New) only, low per-minute
quotas, a budget alert.

**Strongly recommended:** previews currently share the live database (the
`SUPABASE_*` settings are set for Production *and* Preview). Give **Preview** its
own dev values (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`
from `.env.local`), so no preview of any branch can touch live data.

### 3. Invite codes for your pilots

Sign-up is invite-only. Make a code per pilot (or one with several uses):

```
node --env-file=.env.live.local scripts/make-invite.mjs PILOT-NAME 1 "who it's for" --live
```

### 4. Green lights

- GitHub > the `onboarding-dina` branch > the latest **Tests** run is green.
- Vercel > **Deployments** > the latest `onboarding-dina` preview is **Ready**.
  (Until 31 Oct every preview build failed, because Vercel ran the tests in
  production mode. That's fixed; a Ready build is the proof.)
- Your phone test on the preview went well (`docs/phone-test.md`).

### 5. Twilio

Nothing to change on live. The live sandbox's webhook stays
`https://app.dinerai.co.uk/api/whatsapp`. Dina's button and list layouts
(`dina_buttons_N_v1`, `dina_list_N_v1`) make themselves in the Twilio account the
first time they're used (two already exist from the sandbox check).

---

## Merging

GitHub > **Pull requests** > **New pull request**: base `main`, compare
`onboarding-dina` > **Create pull request** > wait for the checks > **Merge pull
request** > **Confirm merge**. Vercel deploys main to app.dinerai.co.uk (about 5
minutes; the tests run first).

---

## After the deploy: checks

1. **Deployed:** Vercel > **Deployments**: the newest Production one is **Ready**,
   and its commit is the merge.
2. **Sign-up is invite-only:** open https://app.dinerai.co.uk/start: no invite
   field filled means no sign-up (it asks for a code).
3. **A test setup works end to end:** https://app.dinerai.co.uk/onboarding/admin
   (log in as the builder) > **Start a test onboarding**. The chat opens and Dina
   says hello on her own. Do a step or two. A test restaurant never reaches anyone
   real on any channel.
4. **WhatsApp:** on the test restaurant, **Link my WhatsApp**, then send
   `Hi Dina` from your phone. She carries on at the same step.
   (If your number is already the owner number of a real restaurant, the button
   says so: use another phone, or unlink it there first.)
5. **Running restaurants are unchanged:** from an owner's number (e.g. the Ember &
   Spice demo phone), send an ordinary message. The assistant answers as before.
6. **Scheduled jobs:** after the next hour (5 past), `/log` > the queue shows a
   `setup_nudges` job, done.
7. **Clean up:** on `/onboarding/admin`, **Delete** the test restaurant.

---

## Rollback: back to the older onboarding fast

If something is wrong on live after the merge:

1. **Within a minute:** Vercel > **Deployments** > find the Production deployment
   from **before** the merge > **⋯** > **Instant Rollback** (or **Promote to
   Production**). The site is back on the older code straight away, including
   the older sign-up and setup.
   - The database stays as it is. Migrations 048 to 053 only added things, and
     the older code ignores them (it ran with them before the merge).
   - Restaurants that signed up with Dina meanwhile keep their details. Their
     sign-up also made the older setup record, so with the older code they carry
     on in the older setup.
2. **Then on GitHub:** open the merged pull request > **Revert** > merge the
   revert PR, so `main` matches what's live. (Or fix forward on the branch and
   merge again.)
3. **Don't** run `supabase/rollback/onboarding_dina_rollback.sql` unless you're
   giving up on Dina altogether: it deletes every restaurant's setup progress and
   conversation with her.
4. Tell Claude what went wrong (a screenshot, or Vercel > the deployment > Logs).
