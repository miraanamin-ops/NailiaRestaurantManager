# Onboarding with Dina: audit before building

Audit date: 28 Oct 2026. Code audited: `origin/main` at `0b90030` (worktree `C:\Users\miraa\dev\naila-dina`, branch `onboarding-dina`). Sources: the code, the SQL files, `CLAUDE.md` steps 1 to 36, and `docs/current-state.md` (19 Oct). Nothing was changed.

## 1. What exists today, item by item

Status: **built** = works end to end today; **partly** = some of it exists; **missing** = nothing.

| Item | Status | Where it lives | What needs changing for Dina |
|---|---|---|---|
| Website sign-up (`/start`) | built | `src/app/start/page.tsx`, `actions.ts` `startSignup`; words in `src/content/site.ts` | Fields are already owner name, restaurant name, email, mobile (normalised by `normaliseWhatsApp`), invite code, one terms tick box, Turnstile, hidden bot field, rate limits. Add the data processing agreement to the tick box and store privacy and DPA versions as well as `terms_version`. Replace "email a login link" with `startOnboarding(siteId)` and the "You're in" screen. |
| Invite codes | built | table `pilot_invites` (code, note, max_uses, used_count, expires_at, active), `claim_pilot_invite()` (025), `src/lib/billing/invites.ts`, `tests/invites.test.ts` | Checked server-side already, atomically. Add a `type` column (standard, pilot) instead of a second `invite_codes` table. |
| Stripe Checkout and trial | **built (conflict)** | `src/lib/billing/*`, `/start/return`, `/api/stripe/webhook`, `025_billing.sql` (step 29) | Your prompt says don't build Stripe; it's already on main. Without an invite code `/start` sends people to Stripe (previews) or refuses them (live, until `PUBLIC_SIGNUP=true`). See question 1. |
| Access rule | built | `src/lib/billing/access.ts` `shouldBeActive`: active only when onboarding finished AND (exempt, pilot code, trial or paid) | Test sites need `billing_exempt` or a pilot code, or finishing leaves them inactive. |
| Accounts, sites, memberships (Oct 22 spec) | **missing** | Not on main, not on any branch, not in the project folder | One owner email per restaurant (`restaurants.owner_email`); login = that email or `BUILDER_EMAIL` (`src/lib/auth.ts`). New tables get `restaurant_id` (the "site") plus a nullable `account_id` for later. I don't have the Oct 22 spec: see question 4. |
| Auth | built | Supabase magic link only (`/login`, `/auth/*`, `emailLoginLink`) | No passwords anywhere. Keep magic link. Supabase's built-in email is limited to a few an hour (known limit), which matters for repeated test runs and resume emails. |
| Onboarding engine | built (8 steps) | `src/lib/onboarding/`: `steps.ts` (pure order and statuses), `store.ts` (`onboarding` row: `steps` jsonb, `data` jsonb, `wa_waiting`, `link_code`, `pending_whatsapp`), `engine.ts` (every step's actions, shared by web and WhatsApp) | Steps: google, menu, allergens, voice, replies, reward, sales, finish. Statuses only done/skipped (no in_progress, partial). Re-entry works. Becomes the action layer under Dina's tools (see section 2). |
| Web onboarding | built (form wizard) | `/onboarding` (choice), `/onboarding/setup` (409-line wizard), `editors.tsx` (editable menu table), `sales-upload.tsx` (25 MB upload with progress) | It's forms, not a chat. Replace with the web chat; reuse the menu table editor and the upload component inside chat cards. |
| WhatsApp onboarding | built (scripted text) | `whatsapp-flow.ts` (424 lines, `wa_waiting` = "step:what"), webhook routes in-progress owners to it | Typed replies parsed by `parseOnboardingReply`. Replace with the WhatsApp adapter over the same engine. Media (several photos at once) handling is worth keeping. |
| Linking WhatsApp | built (code-based) | One-time code in "Link my restaurant: CODE" (`findLinkCode`, `linkWhatsApp`); number typed at sign-up kept in `pending_whatsapp` but not trusted | Your prompt: match the sender to the sign-up number. See question 3. Unknown numbers today get one polite "not registered" reply a day; your prompt says nothing at all. |
| Channel config | built | `src/lib/onboarding/channel.ts`: `TWILIO_WHATSAPP_NUMBER`, `TWILIO_SANDBOX_JOIN` | Already one change to switch numbers. Reuse for the wa.me link and copy button. |
| Restaurant profile fields | built | `restaurants` columns; `src/lib/profile/fields.ts` (versioned, Revert per field), `saveProfileFields` (UNDO) | name, owner_name, address, phone, website, cuisine, opening_hours, special_hours, photos, rating. Missing: owner/manager role, FAQs (parking, delivery, bookings, accessibility, kids, private hire), customer languages. Halal is a free-text `halal_statement`. |
| Menu storage | built | `dishes`, `menu_sections`, `dish_prices` via `saveMenu` (031, 037; never write `restaurants.menu`); `extractMenu` (Sonnet vision) in `onboarding/ai.ts` | Reuse. Extraction has no per-dish confidence yet (needed for "ask only where unsure"). Dietary flags: allergens per dish with `allergens_confirmed`; no vegetarian/vegan/halal flags per dish. |
| Allergens | built (AI suggests, unconfirmed) | `suggestAllergens`, `confirmAllergens`, `customerSafeMenu` | Your prompt: "never invent allergens". Today the AI suggests them (never shown to customers until confirmed). See question 6. |
| Brand voice / tone | partly | `brand_voice` (text chosen from 3 website-based samples, `draftVoices`); `profile_examples.review_replies.positive/negative` (026: replies picked from 3 Claude-written options per made-up review) | Exactly the "praise voice and complaint voice" slots. Missing: the 4 fixed tones, your default reviews and replies, picking real reviews, saving edits as tone examples, queueing the real replies. |
| Make it right | built (fields only) | `recovery_offers` (text list), `complaint_contact`, on the settings page (`profile-cards.tsx`), required for Reputation go-live | Reuse. Missing: "who handles complaints" (a person), and a check that each recovery offer fits the discount cap (today recovery offers aren't measured by the gate). |
| Rewards and discount cap | built | `signup_reward`, `discount_cap_percent`, `birthday_offer`, `approved_offer_types`; cap enforced in `checks/money.ts` + `offers.ts` | Missing: "how often a customer can redeem" (today one sign-up reward per customer, by design). |
| Customer list import | **missing** | Only export exists (`customer-csv.ts`, `/export/customers`) | New: CSV import, consent basis and source per customer, then the existing double opt-in email (`sendConfirmEmail`). Note Resend free plan: 100 emails a day. |
| QR kit | built | `qr-pack.tsx` (PDF: 4 table cards + counter sign), `/r/<slug>/qr-pack` | Reuse. Sending it by email is new (one Resend email with the link). |
| POS CSV import | built | `src/lib/sales/pos-import.ts` (CSV, .xlsx; AI column mapping confirmed once; batches of 1,000; 25 MB upload), onboarding `sales` step | Reuse. Add the "11 months, Nov 2025 to Oct 2026" confirmation and the 8-week rule (forecasts already refuse under 8 weeks: step 35). |
| Forecast engine | built | `getWeekAhead` (`src/lib/forecast/week-ahead.ts`), Python `forecast_daily` | Nothing to change: it reads `sales_days` automatically. |
| Staff and labour | built | `staff` (role kitchen/front of house/delivery/manager, hourly rate, max hours, availability), `rota_rules`, `/staff`, `lib/rota/understand.ts` (Claude reads team messages), `restaurants.labour_target_pct` (LABOUR TARGET) | Reuse `understand.ts` for chat input. Missing: a staff file upload, contracted hours (we store max hours), "site manager" as a login (no memberships). |
| Google (dummy and live) | built | `src/lib/google/` (dummy per restaurant unless a location is linked), `/settings/google` (OAuth Connect, location picker; the builder links a location after an owner adds `GOOGLE_MANAGER_EMAIL` as Manager), import on connect fills empty fields and completes onboarding's Google step | Path A (OAuth) is built and API access is approved; Path B linking is built for the builder. Missing: the three questions, phone/laptop instructions, "email me these steps", screenshots, `in_progress` (pending), simulated acceptance in dummy mode, 24-hour nudge. Config name already exists as `GOOGLE_MANAGER_EMAIL` (I'd keep it rather than add `DINERAI_GOOGLE_MANAGER_EMAIL`). |
| Places look-up | built | `places.ts` ("Is this you?"), needs `GOOGLE_PLACES_API_KEY` | Reuse for step 1's pre-fill (address, cuisine) when Google isn't connected. |
| Morning brief | built | `brief.ts`, `gm-brief.ts`, section registry `src/lib/sections/` | A gap nudge is one new brief section in the registry (no edits to brief code). Brief time is fixed: `BRIEF_HOUR = 9` in `morning-gate.ts`, also used by the queue and the 9:30 lateness alert. A per-restaurant time is a real change (see phases). |
| Quiet hours / send window | built | `send_window_start/end` (customer sends, 9 to 9), `quiet_hours_start/end` (owner alerts, default 11pm to 9am) | Two different settings today. Your step 12 "quiet hours" matches `send_window`. |
| Approvers | partly | Owner only; trust levels per task set by the builder | Without memberships, "owner only" is the only answer for now. |
| Languages and key dates | partly | `owner_language` (owner's own); `local_calendar` + feeds (Ramadan, Eid, bank holidays, football, school terms), `restaurant_teams` | Missing: customer message languages; which dates the owner cares about (stored per restaurant). |
| Safety layer | built | `createDraft`, `attemptSend`, the four checks, checker agent, `gate-rules.ts`, `audit.ts`, UNDO | Reuse unchanged: any real review reply from the tone step is an ordinary `createDraft`. |
| Agents and tool calls | built (read tools only) | `src/lib/agents/` (`loadAgent`, `callAgentWithTools`: allow-listed **read** tools, up to 6 rounds), agents' prompts in `/agents/*.md` | Dina needs **write** tools validated in code. New pattern, onboarding only; the allow-list stays the gate. |
| TEST_MODE / switches | built | `src/lib/switches.ts` (EMAIL_REDIRECT, TEST_TOOLS, GOOGLE_MODE...), `is_demo`, `resetOnboarding` (demo only) | `is_test` can sit on top of `is_demo` (a test site is always a demo, so every existing guard applies). |
| Admin console | partly | Builder sections on `/log` (switches, queue, dead jobs, forecast), `/feeds`, builder card in settings, `/settings/google` builder view | No cross-restaurant onboarding view. New page `/admin/onboarding` (builder only). |
| RLS | partly | `ops_apply_policies` / `ops_owns_restaurant` (030) on ops tables; tested in PGlite (`tests/support/full-pg.ts`) | The older `onboarding` table has RLS on with no policies (nobody but the secret key reads it). New tables use `ops_apply_policies('owned')` with tests. Reminder: the app itself uses the secret key, so RLS protects logins, not the app (known limit). |
| Isolation tests | built | `tests/isolation.test.ts`, `tests/support/owned-tables.ts` | New tables go in the owned-tables list. |
| Resume reminder, setup gaps, stall alert | **missing** | none | New. |
| Twilio buttons | built (quick reply) | `whatsapp.ts`: Content API `twilio/quick-reply` templates made automatically; typed 1/2/3 fallback | List messages (`twilio/list-picker`) not used yet: to try in the sandbox in phase 5. |

### Worth keeping from today's onboarding
- One engine, saved progress, either channel: the design already matches your prompt; Dina replaces the front ends, not the engine.
- `steps.ts` style: order and rules as pure, unit-tested code.
- Menu photos saved as files (several WhatsApp photos arrive at once), the editable menu table, the 25 MB sales upload with progress.
- `saveMenu`, `saveProfileFields` (versioned, UNDO), `logSetting` on every change.
- The website reader (logo and colour for emails) and the Places "Is this you?".
- `resetOnboarding` and the demo-only guard.
- The "Do you have a website?" question when Google didn't find one.

### WhatsApp templates needed (outside the 24-hour window)
Sandbox can't use approved templates, so in the sandbox these simply wait for the owner's next message (as the brief does today). For the real number, Meta must approve:
1. `onboarding_resume`: "Hi {{1}}, it's Dina. Your DinerAI setup is {{2}} of 12 done. Carry on where we left off?" [Carry on] [Later]
2. `setup_gap_nudge` (only if a gap nudge must go outside the brief; in the brief it rides on the brief's own template): "{{1}}" [Do it now] [Later] [Not relevant]
3. `google_invite_nudge`: "Just checking: did you get a chance to add DinerAI as a manager on Google? I can send the steps again." [Send steps] [Later]
4. The morning brief opener (already a known limit).

## 2. How Dina fits on top

```
web chat  ─┐                      ┌─ Dina (Sonnet): talks, extracts, asks
           ├─ channel adapters ─► onboarding service ─┤
WhatsApp  ─┘  (render, parse)     │  state machine in code (steps, order, statuses, gaps)
                                  └─ step actions = today's engine.ts + new ones
                                       └─ saveMenu / saveProfileFields / createDraft / gate / audit
```

- **State machine** (pure, new `src/lib/onboarding/flow.ts`): the 12 steps, statuses `not_started | in_progress | done | partial | skipped`, which are skippable, each step's required fields, unlock lines, gap rules. Dina can't change a status; only a validated tool call can.
- **Dina's tools** (each validated in code before it saves): e.g. `confirm_basics`, `google_answer`, `save_tone`, `save_make_it_right`, `save_menu_draft` / `confirm_menu`, `save_hours`, `save_faqs`, `save_staff`, `save_labour_target`, `save_rewards`, `save_languages_dates`, `save_timing`, `skip_step`, `go_to_step`. Each returns what was saved or the exact problem, and Dina sees it.
- **Messages out** are typed components (`text`, `buttons`, `choice_cards`, `upload`, `editable_card`, `summary`), rendered by the web chat as components and by WhatsApp as buttons, lists or numbered text.
- **Routing "go back to the menu"**: Haiku picks the step from the message when it isn't about the current step.
- **Cost**: about $0.50 to $1 of Claude per full run (Sonnet $2/$10 per million tokens with the prompt cached; menu photos add about $0.10 to $0.30). Fully skipped runs cost a few cents.

## 3. Proposed data model (migration 048)

- `onboarding_sessions`: `restaurant_id` (pk, the site), `account_id` (nullable, for later), `flow_version` (2), `current_step`, `channel_last_used` (web/whatsapp), `started_at`, `completed_at`, `abandoned_reminder_sent_at`, `stall_alerted_at`. The old `onboarding` row keeps `link_code`/`pending_whatsapp` until question 3 is settled.
- `onboarding_steps`: `restaurant_id`, `step_key`, `status`, `data` jsonb, `started_at`, `completed_at`, `skipped_at`; unique (restaurant, step).
- `onboarding_messages`: the chat history per restaurant (role, channel, component json), so a channel switch shows the same conversation and Dina has context.
- `setup_gaps`: as in your prompt (`restaurant_id`, `step_key`, `unlock_text`, `nudge_count`, `last_nudged_at`, `snoozed_until`, `dismissed`, `dismissed_reason`, `done_at`).
- `pilot_invites.type` (standard, pilot).
- `restaurants`: `is_test` (check: implies `is_demo`), `owner_role` (owner/manager), `faqs` jsonb, `customer_languages` text[], `key_dates` text[], `brief_hour`, `privacy_version`, `dpa_version`, `complaint_handler`, `redeem_limit`.
- All new tables: `ops_apply_policies('owned')`, in `owned-tables.ts`, in the clear-out, with PGlite RLS tests.

## 4. Decisions (28 Oct 2026)

1. Stripe stays in the code, switched off: with `ONBOARDING_REQUIRES_PAYMENT=false` (the default) every sign-up needs an invite code and never sees Stripe.
2. A brand-new owner is logged straight in after sign-up, so "You're in" opens the web chat directly; the login email still goes in the background. An email that already has a restaurant never gets logged in this way (login link only, as today).
3. The first WhatsApp message from the sign-up number links it (if no other restaurant or staff member has it); the one-time code stays as a fallback. Unknown numbers get no reply.
4. Accounts and memberships are out of scope. The site manager is a team member with role manager and no login.
5. A test site is `is_test = true` and always `is_demo = true`. On top of the demo rules, a hard wall in code, whatever the switches say: emails only ever reach the builder or the owner (everyone else is redirected), nothing is ever written to live Google (refused in `gbp()`, the one place every Google call goes through), and WhatsApp to customers stays off (it is off for everyone until Meta). Checked: before this, demo restaurants followed the site-wide switches for email and Google, so a demo with a linked Google location could post for real. Ember & Spice (demo, not a test site) keeps its live Google test.
6. Allergen suggestions stay, clearly marked "suggested". The owner confirms each dish one by one (no "accept all"). Unconfirmed = unknown everywhere: never shown to customers and never in Dina's answers.
7. Finishing needs WhatsApp linked.
8. Brief time: whole hours, 7am to 11am.
9. Work on branch `onboarding-dina`, pushed after each phase; the current onboarding stays live on main until you merge.
10. (Phase 2) The login made at sign-up uses the same Supabase session as a login link, and is limited to the restaurant it signed up (by its session id, in `signup_sessions`), so signing up with someone else's email never shows their restaurants. Only an email with no restaurant and no login account before is logged in this way.
11. (Phase 2) A sign-up number that already belongs to another restaurant (owner or staff) is never linked automatically: "You're in" says why and shows the one-time code.
12. Step 12's unlock line: "Tell me who approves and when to message you, and I’ll fit around your day."

## 5. Build plan (revised)

Each phase ends committed, tested, and with a short note of what you need to do.

### Milestone A: a pilot-usable Dina
Sign-up, channel choice, steps 1 to 6, the summary, setup gaps stored (no nudges yet). Steps 7 to 12 aren't asked yet: their safe defaults apply (discount cap 15%, 9am brief, 9am to 9pm sending, sign-up reward suggested from the menu) and the summary says so.

| Phase | What | Rough effort |
|---|---|---|
| 1. Foundation (done) | Migration 048 (sessions, steps, chat messages, setup gaps, invite type, `is_test`, the new restaurant fields for steps 1 to 6); the 12-step state machine in pure code with unit tests (order, skips, partials, re-entry, editing a done step, waiting steps, gap creation, snooze and dismissal); `startOnboarding(siteId)`; the test-site wall (email, Google, WhatsApp) with tests; RLS and isolation tests | 1 session |
| 2. Sign-up and entry (done) | `/start`: data processing agreement in the tick box, versions stored, invite type, `ONBOARDING_REQUIRES_PAYMENT` with the `TODO(stripe)` point; new owner logged in; "You're in" (web chat or WhatsApp with join phrase and copy button); number-match linking | 1 session |
| 3. Dina engine (done) | `agents/dina.md`, typed message components, write tools validated in code, Haiku step router, chat history | 2 sessions |
| 4. Web chat (done; real browser check on dev to do) | Mobile-first chat in the DinerAI style, progress bar with the step list, every message component, typing indicator | 2 sessions |
| 5. WhatsApp adapter | Buttons, list messages (tried in the sandbox), numbered fallback, photos and files | 1 session |
| 6. Steps 1 to 3 | Hello, Google (questions, Path A behind a flag, Path B with placeholder screenshots, email the steps, pending, simulated acceptance, 24h nudge), Tone (4 tones and your defaults in a config file, real reviews, real replies queued through the approval loop) | 1 to 2 sessions |
| 7. Steps 4 to 6 | Make it right (offers checked against the cap), Menu (questions only where unsure, allergens suggested and confirmed dish by dish), Hours and FAQs | 1 to 2 sessions |
| 8. Summary and test controls | Summary card with edit links, activation (nothing runs before step 1), gaps stored for skipped and partial steps; builder test controls (start test onboarding, reset, jump to step, delete, link my number, mark Google accepted); end-to-end tests for the milestone | 1 to 2 sessions |

### Milestone B
| Phase | What | Rough effort |
|---|---|---|
| 9. Steps 7, 8, 9, 12 and the QR kit | Sales history, team and labour, rewards and cap, approvals and timing (per-restaurant brief hour), QR kit by email and WhatsApp | 2 sessions |
| 10. Gap nudges | One nudge in the brief by priority, Do it now / Later / Not relevant, auto-dismiss after 3, gaps page in settings | 1 session |

### Milestone C (later)
| Phase | What | Rough effort |
|---|---|---|
| 11. Customer list import and languages | CSV import with consent basis and double opt-in; languages and key dates | 1 to 2 sessions |
| 12. Resume and admin view | 24h "carry on" email and WhatsApp; `/admin/onboarding` with progress, gaps, Google status and the 48h stall alert | 1 to 2 sessions |
| 13. Retire the old onboarding | Remove the old wizard and WhatsApp flow, full test suite, CLAUDE.md | 1 session |
