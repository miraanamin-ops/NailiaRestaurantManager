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
| 5. WhatsApp | Dina on WhatsApp through the same turn: buttons, lists and the numbered fallback, replies read back, photos/PDF/CSV/Excel into a private bucket (16 MB, checked by content), one reply per burst of photos, linking hands over to Dina at the exact step, the sandbox check script, migration 051 | see git log |

Milestone A (pilot-usable Dina) still needs phases 7 and 8: steps 4 to 6, summary and test controls.

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

Rollback for all of them: `supabase/rollback/onboarding_dina_rollback.sql`.

## 6. Open items

- **Google screenshots**: placeholders in `public/onboarding/google/` (phone-1.png to laptop-4.png). Replace with real screenshots, same names. A short video slot is ready (`VIDEO_SLOT` in `src/lib/onboarding/dina/google-content.ts`).
- **GOOGLE_MANAGER_EMAIL**: set it on Vercel (and in the dev settings) so the steps show our manager email; without it they fall back to the manager login's email, or say it's being set up.
- **Marking Google accepted (real mode)**: WhatsApp `BUILDER GOOGLE ACCEPTED <link name>` until phase 8's admin page.
- **Steps 4 to 6 aren't built**: in the real run Dina started asking "making it right" questions instead of leaving it (phase 7 builds it).

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
