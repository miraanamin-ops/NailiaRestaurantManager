# DinerAI app: plan and decisions (step 50)

The full plan, with screen sketches, the screen map and the timeline, is the Claude Doc
**"DinerAI app plan"**: https://claude.ai/artifact/Mb4HF1MH2GKkxRxViRCVaX
(read it with the Artifact tool's `read` action, or the Claude Docs connector). This file is
the short version a new session needs. If the two disagree, the doc wins: the owner edits it.

## Why (11 Nov 2026)

Meta disabled DinerAI's WhatsApp Business Account (WABA 2270769283493404, sender
+44 7403 690497) on the day it was created, 8 Nov, for "breach of Terms of Acceptable Use";
the review on 11 Nov upheld it. No messages had been sent. The owner is escalating through
Twilio support. Meanwhile DinerAI gets its own iPhone and Android app with push notifications,
which the owner sees as the better long-term front door anyway. The WhatsApp route stays open
in the code (the Twilio sandbox still works for pilots); never create a new WhatsApp account to
get around the ban.

## What the app is

- One codebase for iPhone and Android: **React Native + Expo** (Expo Router, NativeWind,
  Reanimated, Expo Notifications, EAS Build / Submit / Update, TanStack Query + MMKV,
  Sentry, RevenueCat). Lives in `mobile/` in this repository.
- Same engine behind it: drafts, the four checks, `attemptSend`, the brief, Dina, reports,
  Stripe. The app talks to a new app API (`/api/app/...`) with the same login and
  restaurant checks as the website.
- `messageOwner` becomes "deliver to owner": the app (notification + inbox) first, email as
  the back-up, WhatsApp only if it returns. The 24-hour outbox (step 46) is reused to hold and batch.
- Five tabs: **Today, Inbox, Chat, Reports, More**. One main action per screen; drafts are cards
  (swipe right to approve, left to skip, tap to edit; Undo); plain words; the dashboard's look.
- Notifications: the brief at the owner's brief time, urgent alerts (1 to 3 star reviews,
  unhappy customers) straight away, quiet hours respected, buttons on notifications (Approve
  needs Face ID), a badge, tap opens the exact item.

## The owner's decisions (11 Nov 2026)

| Question | Decision |
| --- | --- |
| Paying in the app | **Yes (option A)**: App Store / Google Play subscription via RevenueCat, £99 a month, first month free, FOUNDER as an offer code; 15% store cut on in-app payers only. Website sign-ups stay on Stripe |
| Store name and icon | "DinerAI", **placeholder icon** until the owner gets one designed |
| Sign in with Apple and Google | **Yes**, as well as email and password |
| Tablets | **Only if easy**: phone layout centred on tablets; two panes only if it comes for free |
| Back-up text messages | **No** for now. Instead one friendly push nudge for owners who haven't opened the app in a few days ("we haven't seen you in a while, here's how to bring in more covers"), with a concrete idea |
| If WhatsApp comes back | **Keep the route open** as an option beside the app |

Also required by Apple: account deletion in the app (reuse the close-account flow), a demo
login for reviewers (Ember & Spice). Sign-up and payment rules: no links to website pricing
from the iOS app.

## Phased build (each phase ends with something the owner tests on their phone)

| Phase | Delivers | Owner tests | Days |
| --- | --- | --- | --- |
| 0. Foundations | `mobile/` Expo app, placeholder icon, five tabs, email+password login, Face ID reopen, first app API endpoints, EAS set up | Log in on their phone | 1 to 2 |
| 1. Today and Inbox | Today screen; Inbox cards with Approve / Edit / Skip / Undo through `attemptSend`; real previews (email, Google post, review + reply); the four checks shown | Clear Ember & Spice's demo inbox | 3 |
| 2. Notifications | Device tokens table, deliver-to-owner channel (app first, email back-up), brief + urgent alerts, notification buttons, badge, quiet hours, deep links, the re-engagement nudge | Approve a reply from the lock screen | 2 |
| 3. Chat | Chat screen on the WhatsApp bot's engine (`handleMessage` logic), photos, files, quick replies, all commands | "Thursday is quiet"; a till report photo | 2 |
| 4. Sign-up, setup, paying | Sign-up (+ Apple / Google sign-in), Dina's setup in the app, notification permission, RevenueCat subscription + FOUNDER, RevenueCat webhook into the access rule, delete account | A fresh sign-up from download to a running free month | 3 |
| 5. Reports and More | Reports with charts + PDF, customers, QR, settings, refer + share, help, talk to a person, pause; simple tablet layout | Everything the dashboard does | 2 |
| 6. Polish and test | Sizes (iPhone SE to Pro Max, a tablet), dark mode, big text, offline, Maestro robot tests, Sentry, TestFlight + Play internal testing, friendly restaurants | Real use for a few days | 2 to 3 |
| 7. Into the stores | Listings, screenshots, privacy / data safety, reviewer notes; submit | Approve listing and screenshots | 1 + reviews |

Phases 0 to 3 run on the owner's phone through Expo without the store accounts. Phase 4
onwards needs the Apple and Google developer accounts (both applied for 11 Nov as DinerAI
Limited, D-U-N-S number obtained). Target: built in about 3 weeks from 12 Nov, in both stores
by mid-December.

## Working rules for the build

- Each phase on its own branch, merged when the owner has tested it; the website keeps working throughout.
- Keep rules as pure, unit-tested functions, as in the rest of the codebase; the app gets Maestro flows.
- Multi-restaurant rules apply to every app API endpoint (filter by restaurant, `pickRestaurantId`).
- Update CLAUDE.md "Built so far" at the end of each phase.

## Status and the next chats (11 Nov 2026)

Phases 0, 1 and 2 are live on main (phase 2, notifications, still to be tested on a
development build once Apple approves the developer account). The owner starts a new
Claude Code chat for each remaining step, using the ready-made prompts in the Claude Doc's
"Prompts for new chats" section: Step A (the development build: test notifications and
Face ID), then Phases 3 to 7. Each prompt says where everything is and the working rules:
the worktree C:\Users\miraa\dev\naila-v3, one branch per phase, test on Ember & Spice only
(never Maison Noor or another real restaurant), ask before merging to main, migrations
copied to the owner's clipboard, the Expo token in mobile/.env.expo.local never printed,
and `npx expo start --lan --clear < /dev/null` (never CI=1) for testing in Expo Go.

Phase 3 (Chat) is live (11 Nov 2026, main df72cce, migration 066), tested by the owner on
Ember & Spice: the Chat tab on the WhatsApp bot's own engine, photos and files, quick replies,
drafts as Inbox cards, "Answer in Chat" from the Inbox. Cosmetic changes wait for phase 6.

Phase 4 (sign-up, setup with Dina, paying in the app, Delete account) built on branch
`app-phase4` (12 Nov 2026). Needs migration 067 on live before merging, and the store
set-up in `docs/app-store-setup.md` before anyone can pay in the app (until then app
sign-ups need an invite code, as on the website). Real purchases and Google sign-in need
a development build.

Phase 5 (Reports and More) built on branch `app-phase5` (12 Nov 2026): reports with charts,
the PDF and the 3 actions into Chat; customers, settings, notifications per kind, Recommend a
restaurant, Help and Talk to a person, Pause. Needs migration 068 on live before merging.
