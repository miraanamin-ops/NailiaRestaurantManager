# Paying and signing in from the app: what to set up (step 50, phase 4)

Everything the owner (you) sets up by hand for sign-up, Sign in with Apple / Google and
paying in the app. Do it in this order; each part says what it unlocks. Nothing here
changes the website or Stripe: website sign-ups keep paying by Stripe.

Names used throughout (keep them exactly, the code expects them):

| Thing | Value |
| --- | --- |
| App bundle id / package | `uk.co.dinerai.app` |
| Subscription product (Apple and Google) | `dinerai_monthly` |
| Google base plan | `monthly` |
| Google offers | `free-month` (everyone), `founder` (tag `founder`) |
| RevenueCat entitlement | `dinerai` |
| RevenueCat offering | `default`, with one Monthly package |
| Webhook address | `https://app.dinerai.co.uk/api/revenuecat/webhook` |

Secrets go only in Vercel (Production) or in local files you fill in yourself. The
RevenueCat **public** app keys and the Google **client IDs** are not secrets (they ship
inside the app); they go in EAS's environment variables.

---

## 1. Apple (once the developer account is approved)

**1a. Turn on Sign in with Apple and In-App Purchase for the app**
developer.apple.com > Account > Certificates, IDs & Profiles > Identifiers >
`uk.co.dinerai.app` > Capabilities: tick **Sign in with Apple** and **In-App Purchase** >
Save. (If the identifier isn't there yet, the first EAS build creates it; then tick these.)

**1b. Create the app in App Store Connect** (if not already)
appstoreconnect.apple.com > Apps > **+** > New App > iOS, Name "DinerAI", Primary language
English (UK), Bundle ID `uk.co.dinerai.app`, SKU `dinerai` > Create.

**1c. Agreements** (no subscription works without this)
App Store Connect > **Business** (Agreements, Tax and Banking) > accept the **Paid Apps**
agreement, add the bank account and the tax forms.

**1d. The subscription**
App Store Connect > Apps > DinerAI > **Monetization > Subscriptions** >
Subscription Groups **+** > Reference name `DinerAI` > Create >
in the group, **Create** > Reference name `DinerAI monthly`, Product ID `dinerai_monthly` >
Create > Subscription Duration **1 month** > Save >
**Subscription Prices** > Add > Country **United Kingdom**, currency GBP, price **£99.00**
(or the nearest Apple offers; Apple's prices include VAT, like the website's £99) > Next >
let Apple fill the other countries > Confirm >
**Localization** > English (UK): display name `DinerAI`, description
`Your restaurant's AI manager, every month` > Save >
**Review Information**: a screenshot of the "Start your free month" screen and the note
"Subscription unlocks DinerAI for one restaurant. Demo login in App Review notes." > Save.

**1e. The free month**
Same subscription > Subscription Prices > **View all Subscription Pricing** >
**Introductory Offers** > Set up Introductory Offer > all countries > start today, no end
date > **Free** > Duration **1 month** > Confirm.

**1f. No offer code on iPhone** (your call, 12 Nov 2026): FOUNDER isn't offered on
iPhone. Everyone gets the free month, then £99 a month. Nothing to set up here.

**1g. The 15% rate (Small Business Program)**
developer.apple.com/app-store/small-business-program > **Enroll** (Account Holder only) >
list any associated developer accounts (none) > Submit. It applies from the start of the
next fiscal month after approval: enrol before the first real sale.

**1h. Keys for RevenueCat**
App Store Connect > **Users and Access > Integrations > In-App Purchase** > Generate
In-App Purchase Key > name `RevenueCat` > Generate > **Download** the .p8 file (only once)
and note the **Key ID** and the **Issuer ID** at the top of the page. Keep the .p8 in a
private folder (not OneDrive's shared folders); it goes into RevenueCat only.

**1i. Test accounts (sandbox: nothing is charged)**
App Store Connect > Users and Access > **Sandbox** > Test Accounts **+** > a new email
(e.g. miraan.amin+sandbox1@gmail.com), a password, country United Kingdom > Create.
On the iPhone: Settings > Developer > **Sandbox Apple Account** > sign in with it (only
appears once a development build is installed). A sandbox month lasts 5 minutes.

---

## 2. Google Play (once the developer account is verified)

**2a. The app**: Play Console > **Create app** > name DinerAI, app, free (the subscription
is in-app) > declarations > Create. Upload one build to **Testing > Internal testing**
first: Google only lets you create subscriptions after an app has a build.

**2b. The subscription**
Play Console > DinerAI > **Monetize with Play > Products > Subscriptions** > Create
subscription > Product ID `dinerai_monthly`, name `DinerAI` > Create >
**Add base plan** > Base plan ID `monthly`, **Auto-renewing**, billing period **1 month**,
grace period 7 days > **Set prices** > United Kingdom **£99.00** > Update > Save >
**Activate**.

**2c. The free month (everyone)**
Same base plan > **Add offer** > Offer ID `free-month` > Eligibility **New customer
acquisition** (never had this subscription) > **Add phase** > Free trial, **1 month** >
Save > Activate.

**2d. FOUNDER (developer-determined offer)**
Google Play has no discount codes (its promo codes only give free time), so the app checks
FOUNDER with our server (50 places, kept in our database) and then buys this offer:
Same base plan > **Add offer** > Offer ID `founder` > Eligibility **Developer determined**
> phases: **Free trial 1 month**, then **Single payment / Recurring discounted price**
£50.00 for **3** billing periods > **Tags**: add `founder` (the app finds it by this tag)
> Save > Activate.

**2e. The 15% rate**: Google charges 15% on subscriptions automatically; nothing to enrol.
(Check Play Console > Settings > Developer account > Service fees once the account is live.)

**2f. A key for RevenueCat**: follow RevenueCat's "Creating Play Service Credentials"
(Google Cloud project DinerAI > IAM & Admin > Service Accounts > Create `revenuecat` >
Keys > Add key > JSON; then Play Console > Users and permissions > **Invite new users** >
that service account's email > app permissions: DinerAI > View app information, View
financial data, Manage orders and subscriptions > Invite). It can take up to 36 hours to
start working.

**2g. Test accounts**: Play Console (home, not the app) > **Settings > License testing** >
add your Gmail address(es) > Save. Test purchases are never charged.

---

## 3. RevenueCat (app.revenuecat.com, free until $2.5k a month of revenue)

**3a. Project**: sign up > **Create project** `DinerAI`.

**3b. Apple app**: Project > **Apps & providers** > + New > **App Store** > App name DinerAI,
Bundle ID `uk.co.dinerai.app` > **In-app purchase key configuration**: upload the .p8,
enter Key ID and Issuer ID > Save.

**3c. Google app**: + New > **Play Store** > package `uk.co.dinerai.app` > upload the
service account JSON > Save.

**3d. Products**: **Product catalog > Products** > **Import** (or + New): Apple
`dinerai_monthly`; Google `dinerai_monthly:monthly`.

**3e. Entitlement**: Product catalog > **Entitlements** > + New > identifier `dinerai`,
description "DinerAI subscription" > Add > **Attach** both products.

**3f. Offering**: Product catalog > **Offerings** > + New > identifier `default` > add a
package of type **Monthly** > attach the Apple product and the Google product > Save >
Actions > **Make default**.

**3g. Webhook**: Project > **Integrations > Webhooks** > + Add new configuration > name
`DinerAI live` > URL `https://app.dinerai.co.uk/api/revenuecat/webhook` > environment
**Both production and sandbox** (App Review buys in sandbox) > leave the authorization
header empty > turn on **HMAC webhook signing** > Save > **copy the signing secret** (shown
once).

**3h. The secret into Vercel (Production only)**: vercel.com > the DinerAI project >
Settings > **Environment Variables** > Add > Key `REVENUECAT_WEBHOOK_SECRET`, Value the
signing secret, Environments: tick **Production** only > Save > Deployments > latest >
Redeploy. Then in RevenueCat, on the webhook's page, **Send test event**: it should show
200 (our server answers "ignored" for a test event).

**3i. The public keys into EAS** (they go inside the app; not secret):
expo.dev > miraanamin > dinerai > **Environment variables** > Add (environments:
production, preview and development):
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` (RevenueCat > Project settings > API keys > the
App Store app's public key) and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (the Play Store app's).

---

## 4. Sign in with Apple and Google (Supabase, Google Cloud)

**4a. Google OAuth clients**: console.cloud.google.com > project DinerAI > **APIs &
Services > Credentials** > + Create credentials > **OAuth client ID**:
1. **Web application**, name `DinerAI app sign-in` > Create > note the Client ID.
2. **iOS**, bundle ID `uk.co.dinerai.app` > Create > note the Client ID and the **iOS URL
   scheme** (`com.googleusercontent.apps....`).
3. **Android**, package `uk.co.dinerai.app`, SHA-1: from `npx eas-cli@latest credentials`
   (Android > production > the keystore's SHA-1), and later also the **App signing** SHA-1
   from Play Console > Setup > App integrity > App signing (add a second Android client).

**4b. Into EAS** (not secret): `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`. Until they're set,
the app hides "Continue with Google".

**4c. Supabase (live project)**: supabase.com > the live project > **Authentication > Sign
In / Providers**:
- **Apple** > Enable > **Client IDs**: `uk.co.dinerai.app` (add `host.exp.Exponent` too
  while testing in Expo Go) > Save. (The Services ID and secret key are only for websites;
  leave them empty.)
- **Google** > Enable > **Client IDs**: the Web client ID first, then the iOS client ID,
  comma-separated > **Skip nonce checks**: on (Google's iPhone library can't send one) >
  Save.

---

## 5. When to open paid sign-up in the app

Until these are set, app sign-ups need an invite code (exactly like the website):
Vercel (Production) `ONBOARDING_REQUIRES_PAYMENT=true` and `PUBLIC_SIGNUP=true`, plus
`REVENUECAT_WEBHOOK_SECRET` from 3h. Website sign-ups then also need Stripe's live keys
(step 49), so switch them together once both are ready.

## 6. For App Review

App Store Connect > the version > **App Review Information** > Sign-in required: a demo
login that opens Ember & Spice (billing-exempt, so no purchase is needed), and the note:
"Sign-up and the subscription can be tested with a sandbox account; Delete account is in
More (the demo restaurant itself can't be deleted)."

## FOUNDER in the app (decided 12 Nov 2026)

iPhone: no offer code; the free month, then £99 a month (Apple can't combine an offer
code with the free month, and owners don't see whether they were among the first 50).
Android: FOUNDER works as on the website (free month, then 3 months at £50), through
Google's developer-determined offer (2d). Say if Android should drop it too.
