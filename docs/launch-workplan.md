# DinerAI: workplan to go live for paying customers

*Written 7 November 2026. "You" = the founder; "Claude" = the build work done with Claude Code.*

## Where we are

The product is built and running on app.dinerai.co.uk (see `docs/functionality.md`).
What stops a stranger paying £99 a month and using it without help:

1. **WhatsApp is still Twilio's sandbox.** Every owner has to send a "join" phrase first,
   and messages outside WhatsApp's 24-hour window don't arrive. This needs Meta approval
   and is the **longest wait**, so it starts first.
2. **Payments are in Stripe test mode**, and the code deliberately refuses live keys.
3. **Several free services don't allow commercial use** (hosting, weather, some
   calendar feeds) or will run out at real volume (email, login emails).
4. **The pilot rerun hasn't happened yet**, and Dina's newest setup questions have never
   run against the real Claude.
5. **Legal and admin:** ICO registration, real company details on the website, and a
   qualified check of the terms, privacy notice and data processing agreement.

**The critical path is Meta (about 2 to 4 weeks).** Everything else fits inside that
wait, so **the realistic launch date is early to mid December 2026**, with a soft launch
to a handful of friendly restaurants first.

---

## Phase 0: Pilot Zero rerun (now, about 1 week)

| # | Task | Who | Notes |
|---|---|---|---|
| 0.1 | Add Claude API credit (start with $50 and switch on auto-reload with a monthly limit) | You | console.anthropic.com > Billing |
| 0.2 | One test setup on a throwaway test restaurant with the real Claude, to catch anything broken in Dina's newest questions | Claude | About $0.30 |
| 0.3 | Close the current Maison Noor account: app.dinerai.co.uk/onboarding/admin > **Close an account** > type "Maison Noor" > confirm > tick "skip the cooling-off" | You | Exports then deletes the restaurant. **Do not** remove dina@dinerai.co.uk as a Manager on Maison Noor's Google profile, even if the closing email suggests it; we reuse it. |
| 0.4 | Fresh sign-up with invite code **PILOT-ZERO-RERUN** (`/start?invite=PILOT-ZERO-RERUN`), then follow `docs/pilot-zero-run-sheet.md` from Day 1 (the rerun notes are at the top) | You | The code is live and allows 2 sign-ups, in case the first attempt goes wrong |
| 0.5 | Fix what the pilot finds (#notes), push to live as we go | Claude | |
| 0.6 | Go / no-go: would you pay £99 a month for what you saw? | You | Your top 3 changes become Phase 6 work |

---

## Phase 1: business and legal (start now, runs alongside everything else)

| # | Task | Who | Cost | Notes |
|---|---|---|---|---|
| 1.1 | Send Claude the company's legal name, number and registered office | You | | Goes in the website footer, terms, privacy notice, DPA and emails (currently placeholders) |
| 1.2 | Register with the ICO (data protection fee) | You | £52 a year (tier 1) | ico.org.uk/fee. Required before processing customer data commercially |
| 1.3 | Business bank account, if not done | You | | Needed for Stripe live payouts |
| 1.4 | Qualified review of the terms, privacy notice and DPA, including the "how you compare nearby" clause and the outside data sources | You (a solicitor or a templates service) | £300 to £1,000 | Claude can prepare a one-page brief for the reviewer |
| 1.5 | Professional indemnity and cyber insurance | You | about £20 to £50 a month | An AI posting on businesses' behalf: worth having before the first paid customer |
| 1.6 | VAT: decide whether to register voluntarily (you must once turnover passes £90,000) | You, with an accountant | | Affects whether £99 is VAT-inclusive; Stripe Tax can handle it |
| 1.7 | Support: a support email (e.g. help@dinerai.co.uk) and how owners reach a person | You and Claude | | Claude adds it to the site, emails and the HELP command |

---

## Phase 2: WhatsApp production (start this week, 2 to 4 weeks, the critical path)

| # | Task | Who | Notes |
|---|---|---|---|
| 2.1 | Meta Business portfolio for the company and business verification (company documents, website, domain email) | You | business.facebook.com. Claude can write exact click paths |
| 2.2 | A dedicated phone number for DinerAI's WhatsApp (not on any phone's WhatsApp app) | You | A Twilio UK number is simplest |
| 2.3 | Register the WhatsApp sender through Twilio (Twilio > Messaging > Senders > WhatsApp), linked to the Meta portfolio; display name "DinerAI" | You, Claude guides | Display name approval takes a few days |
| 2.4 | Message templates for everything sent outside the 24-hour window: the morning brief opener, urgent review alert, Monday report, rota ready, business review ready, setup reminders, Dina's buttons and lists | Claude writes them; you submit or approve in Twilio | Meta approves each one (hours to days) |
| 2.5 | Code: when the 24-hour window is closed, open with the approved template instead of waiting; switch to the new number (TWILIO_WHATSAPP_NUMBER); remove the sandbox join step from sign-up and onboarding | Claude | About 2 to 3 days of work plus tests |
| 2.6 | Test on your phone end to end, then move Maison Noor and the demo phone over | You and Claude | |

Cost: a Twilio number is about £1 a month, plus Twilio's small per-message fee and
Meta's charge per template message sent outside the 24-hour window (UK marketing
templates cost a few pence each; utility templates less; check Meta's current rate card).
Messages inside the 24-hour window aren't charged by Meta. Roughly £3 to £8 per
restaurant a month.

---

## Phase 3: Google (start now, runs in the background)

| # | Task | Who | Notes |
|---|---|---|---|
| 3.1 | Apply for Google's OAuth app verification (business.manage scope): privacy policy link, a short demo video, the reason for the scope | You, Claude prepares the text and video script | Takes weeks. Until then, owners use the Manager route (adding dina@dinerai.co.uk), which works today, so this **doesn't block launch** |
| 3.2 | Google Cloud billing with a budget alert for the Places API (onboarding search, rivals) | You | Small: our own cap is 100 calls a day |
| 3.3 | Decide whether real restaurants get live Google posting from day one, or 1 to 2 weeks of "approve but dry run" first | You | Recommendation: live from day one, because every write already needs the owner's Approve |

---

## Phase 4: services, plans and costs (week 2 to 3)

| # | Service | Why | Plan needed | Approx. cost |
|---|---|---|---|---|
| 4.1 | Vercel (hosting) | The free Hobby plan is for non-commercial use only | Pro | $20 a month |
| 4.2 | Supabase (database) | Daily backups, no pausing, more capacity; add point-in-time recovery later | Pro | $25 a month |
| 4.3 | Supabase login emails | Its built-in email only sends a few login links an hour: an outreach wave would block logins | Custom SMTP through Resend (a settings change in Supabase) | £0 extra |
| 4.4 | Resend (customer emails) | The free plan allows 100 a day and 3,000 a month | Pro | $20 a month (50,000 emails) |
| 4.5 | Anthropic (Claude) | Every agent and Dina | Pay as you go, auto-reload, monthly limit | Measure in the pilot; expect about £5 to £15 per restaurant a month |
| 4.6 | Open-Meteo (weather) | The free tier forbids commercial use | API Professional, or switch to the Met Office DataHub (needs a fresh forecast back-test) | Price on request (about €30 to €100 a month) |
| 4.7 | Ticketmaster events | Commercial use unclear | Written permission, or switch the feed off | £0 |
| 4.8 | football-data.org | Commercial use not stated | Ask; else the €12 a month plan | £0 to €12 a month |
| 4.9 | Railway (forecast worker) | Already running | Hobby or Pro | $5 to $20 a month |
| 4.10 | Twilio | WhatsApp | Pay as you go | See Phase 2 |
| 4.11 | Cloudflare Turnstile, postcodes.io, TfL, gov.uk | | Free tiers allow commercial use | £0 |

**Fixed running cost: about £150 to £250 a month** before any customers, plus about
£10 to £25 per restaurant a month (Claude, WhatsApp, email). At £99 a month, that's
roughly 75 to 90% gross margin per restaurant, and break-even at about 3 restaurants.

---

## Phase 5: payments live (week 3)

| # | Task | Who | Notes |
|---|---|---|---|
| 5.1 | Activate Stripe live mode (company details, bank account, identity checks) | You | |
| 5.2 | Decide pricing details: £99 a month, VAT-inclusive or not, trial length (14 days today), card upfront (today) or not, any founding-customer discount code | You | Recommendation: 14-day trial with card upfront, plus a "FOUNDER" code for the first 20 restaurants |
| 5.3 | Create the live product and price, the Customer Portal (cancel at period end) and trial-ending reminder emails in Stripe | You, Claude guides | Dashboard settings, not code |
| 5.4 | Code: allow live keys on Production only (still refused on previews and locally), with a live-mode banner on the builder pages | Claude | Half a day |
| 5.5 | Live Stripe keys and webhook secret in Vercel (Production only), webhook endpoint pointed at app.dinerai.co.uk | You, Claude guides | |
| 5.6 | Finish the two outstanding billing checks: a failed payment, and an invite code | You and Claude | Listed in CLAUDE.md known limits |
| 5.7 | A real £99 payment with your own card, then refund it | You | Proves the live path end to end |

---

## Phase 6: product ready for strangers (weeks 2 to 4, alongside the above)

| # | Task | Who |
|---|---|---|
| 6.1 | Fixes from the pilot (Phase 0.6) | Claude |
| 6.2 | Production switches check: email redirect OFF, test tools OFF, Google mode live, agents allowed, sign-ups never demo. Claude lists the exact values; you confirm in Vercel | You and Claude |
| 6.3 | Self-serve Google step without the builder: invitations auto-accepted, with a clear fallback when they can't be matched (today it alerts you) | Claude |
| 6.4 | Help: a short help page and FAQs on the site, a "Talk to a person" option in HELP, a welcome email after sign-up | Claude |
| 6.5 | Landing page: real company details, current screenshots of the new dashboard, a 60-second demo video, check that every claim is true and "Coming soon" items are right | You and Claude |
| 6.6 | Monitoring: an uptime check on the site and webhooks (e.g. Better Stack, free), and a weekly health email to you (sign-ups, active restaurants, failures, AI spend) | Claude |
| 6.7 | Database-level separation between restaurants (row-level security for the app itself), the main remaining security item from the known limits | Claude, about 1 week |
| 6.8 | A tested restore from a Supabase backup (on the dev project) | Claude |
| 6.9 | School term dates for the councils your outreach targets (only 3 councils today) | Claude, from council pages |
| 6.10 | Analytics: where sign-ups come from (UTM tags on outreach links), trial-to-paid conversion, and setup completion | Claude |

---

## Phase 7: soft launch (weeks 4 to 6)

1. **3 to 5 "founding" restaurants** you know or can visit: invite codes, free or
   discounted for 2 months, in return for feedback and a quote.
2. Watch every setup live (the admin console shows progress and stalls). Fix the
   friction points within a day.
3. **Go / no-go checklist before opening up:**
   - every founding restaurant finished setup without your help (or the fixes are in);
   - morning briefs arrive on time, every day, on the real WhatsApp number;
   - no wrong post or email reached a customer;
   - AI cost per restaurant is inside the estimate;
   - a live payment and a cancellation worked.

## Phase 8: open sign-up and outreach (from about mid December)

1. Turn on paid sign-up (PUBLIC_SIGNUP and ONBOARDING_REQUIRES_PAYMENT on Production).
2. Send outreach **in waves of a few hundred a week**, not all 3,000 at once, so
   setups, questions and fixes stay manageable. Each wave links to /start with its own
   tracking tag.
3. Weekly: conversion from email to sign-up to finished setup to paid; AI and
   messaging costs; support questions. Adjust the email and onboarding between waves.
4. Pick up the parked till connections (Square first) once partner approvals arrive.

---

## Week-by-week summary

| Week (from 9 Nov) | You | Claude |
|---|---|---|
| 1 | Claude credit; company details; ICO; start Meta verification; close Maison Noor and start the pilot | Test setup run; pilot fixes; template wording; WhatsApp production code |
| 2 | Pilot days 2 to 7; Twilio number and sender; Stripe activation; legal review booked; outreach domain warming up | Pilot fixes; templates submitted; live-key code; production switch list; help page |
| 3 | Plans upgraded (Vercel, Supabase, Resend, weather); Stripe live product; templates approved | Live payments wired and tested; monitoring; row-level security |
| 4 | Real WhatsApp number on your phone; first founding restaurants signed up | Move everyone off the sandbox; landing page and demo video; analytics |
| 5 to 6 | Soft launch with 3 to 5 restaurants | Fast fixes from real use |
| 7+ | Open sign-up; outreach waves | Weekly improvements; till connections |

## Decisions needed from you

1. Pricing details (5.2): VAT-inclusive or not, trial length, founding discount.
2. Live Google writes from day one for real restaurants (3.3).
3. Weather: pay Open-Meteo, or move to the Met Office (4.6).
4. Who the founding restaurants are (Phase 7).
5. Budget ceiling for monthly running costs and AI spend.
