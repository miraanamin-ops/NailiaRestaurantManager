# Testing Dina on your phone, without touching live

Full Dina conversations on your own phone, against the `onboarding-dina` preview,
before merging. Live (app.dinerai.co.uk, its database and its Twilio sandbox) is
never involved.

How it fits together:

```
your phone ──WhatsApp──► a SEPARATE Twilio sandbox (a Twilio subaccount)
                              │  webhook, with Vercel's bypass key
                              ▼
          the onboarding-dina preview on Vercel ──► the DEV database (dinerai-dev)
```

Three things matter:

1. **Previews use the dev database** (for every branch, since 1 Nov), with the test
   switches on, and a preview only ever sends WhatsApp to `BUILDER_WHATSAPP` (your
   number). Step 3 only adds this branch's own Twilio test sandbox.
2. **Previews are behind Vercel's login**, which Twilio can't pass. Vercel's
   "Protection Bypass for Automation" key goes on the webhook link (step 2). The
   app adds it itself to the pictures Twilio fetches and to its own worker calls
   (`src/lib/preview-bypass.ts`).
3. **Your phone can only be in one sandbox at a time.** Joining the test sandbox
   takes your phone out of the live one until you rejoin it (step 9).

The preview's address for this branch (it stays the same for every push):
`https://nailiarestaurantmanager-git-onbo-933b37-miraanamin-ops-projects.vercel.app`

---

## 1. A separate Twilio sandbox (a subaccount)

1. Go to https://console.twilio.com and sign in.
2. Top right, click **Admin** > **Account management** > **Subaccounts** >
   **Create new subaccount**. Name it `DinerAI preview`, then **Create**.
3. Switch to it (the account menu, top left, now lists it).
4. Go to **Messaging** > **Try it out** > **Send a WhatsApp message**. Note the
   join phrase it shows (like `join word-word`). This is the test sandbox's own.
5. Go to the subaccount's home page (**Account Dashboard**) and copy its
   **Account SID** and **Auth Token** (click **Show**).

If the subaccount has no WhatsApp sandbox, sign up for a second, free Twilio
account with another email instead, and do 4 and 5 there.

## 2. Vercel's bypass key

1. Go to https://vercel.com > project **nailiarestaurantmanager** > **Settings** >
   **Deployment Protection**.
2. Under **Protection Bypass for Automation**, click **Add a secret** (or
   **Generate**), then **Save**. Copy the secret.

Previews stay behind Vercel's login for everyone else.

## 3. Give this branch's previews the test sandbox

The dev database, Google, email and `BUILDER_WHATSAPP` settings are already set
for every preview (1 Nov; checked with a test sign-up that landed in dev, not
live). Only the Twilio test sandbox is left.

**Settings** > **Environment Variables**. For each line below: **Add New**, type
the name and value, tick only **Preview**, choose **Git branch: onboarding-dina**,
then **Save**. These only affect this branch's previews; production and other
branches are untouched.

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | the subaccount's (1.5) |
| `TWILIO_AUTH_TOKEN` | the subaccount's (1.5) |
| `TWILIO_SANDBOX_JOIN` | the test sandbox's join phrase (1.4) |

Then redeploy, because settings only reach a new build: **Deployments** > the
newest `onboarding-dina` one > **⋯** > **Redeploy**.

## 4. Logging in on the preview (for your test controls)

Login emails come from the dev Supabase project, so it has to accept the preview's
address: https://supabase.com > project **dinerai-dev** > **Authentication** >
**URL Configuration** > **Redirect URLs** > **Add URL**:
`https://nailiarestaurantmanager-git-onbo-933b37-miraanamin-ops-projects.vercel.app/**`, then **Save**.

You only need this for `/onboarding/admin` (your test controls). A new sign-up
is logged in straight away without it.

## 5. Point the test sandbox at the preview

In the subaccount: **Messaging** > **Try it out** > **Send a WhatsApp message** >
**Sandbox settings**. In **When a message comes in**, paste (one line, your
secret from 2 at the end):

```
https://nailiarestaurantmanager-git-onbo-933b37-miraanamin-ops-projects.vercel.app/api/whatsapp?x-vercel-protection-bypass=YOUR_SECRET
```

Method **POST**, then **Save**.

## 6. Join the test sandbox from your phone

On WhatsApp, send the test sandbox's join phrase (1.4) to **+1 415 523 8886**.
Twilio answers that you've joined. From now on your phone talks to the preview,
not to live.

## 7. Run a setup

Either way works:

- **As a new owner**: `<preview address>/start?invite=PHONE-TEST-DINA`, sign up
  with your real number (07463 775130) so WhatsApp links by number. In the chat,
  tap **Continue on WhatsApp**, then send `Hi Dina`.
- **From your test controls**: `<preview address>/onboarding/admin` > **Start a
  test onboarding**, then **Link my WhatsApp** on it, then send `Hi Dina`.

Worth trying:

- buttons (3 or fewer choices) and lists (4 or more); typing a number instead
- the Google steps' screenshots arriving one per message
- switching mid-step: answer one question on the web, the next on WhatsApp, and back
- a menu photo from your camera, then the allergen cards
- "skip", "go back to the menu", a voice note or video (it should be politely refused)
- finishing: the summary arrives on WhatsApp
- **Mark Google accepted** on `/onboarding/admin` while the Google step is waiting

## 8. If something doesn't answer

- **Vercel** > the deployment > **Logs**: look for `/api/whatsapp` (403 means
  the signature check failed, usually the webhook link or the Auth Token).
- **Twilio subaccount** > **Monitor** > **Logs** > **Errors**.
- Ask Claude to look at the dev database (`messages`, `onboarding_messages`, `jobs`).

## 9. Afterwards: back to live

1. On WhatsApp, send **live's** join phrase to +1 415 523 8886 (in the main Twilio
   account: **Messaging** > **Try it out** > **Send a WhatsApp message**). Your
   phone is back on live.
2. The branch's preview settings can stay. They only affect `onboarding-dina`
   previews. Delete them after the merge if you like.
