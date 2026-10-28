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

## 4. Build plan

Each phase ends committed, tested, and with a short note of what you need to do.

| Phase | What | Reuses | Rough effort |
|---|---|---|---|
| 1. Foundation | Migration 048; pure state machine with unit tests (order, skips, partials, re-entry, editing a done step, gap creation and dismissal); `startOnboarding(siteId)`; RLS and isolation tests | `steps.ts` patterns, `ops_apply_policies`, PGlite | 1 session |
| 2. Sign-up and entry | `/start` changes (DPA, versions, invite type), `ONBOARDING_REQUIRES_PAYMENT` flag with the `TODO(stripe)` point, "You're in" screen, WhatsApp number match | `startSignup`, `channel.ts`, `linkWhatsApp` | 1 session |
| 3. Dina engine | `agents/dina.md` (persona rules, no em-dashes, one question at a time), typed message components, write tools with server-side validation, Haiku step router, conversation storage | `loadAgent`, `callAgentWithTools` (extended for write tools), `engine.ts` actions | 2 sessions |
| 4. Web chat | Mobile-first chat in the dark DinerAI style: header with Dina, progress bar with step list, quick replies, tone cards, uploads, editable cards, summary, "Skip for now", typing indicator | `AppShell`, `.dai-app` tokens, `editors.tsx`, `sales-upload.tsx` | 2 sessions |
| 5. WhatsApp adapter | Buttons (max 3), list messages (max 10, tested in the sandbox), numbered fallback, photos, PDFs, CSV/Excel | `whatsapp.ts` templates, the webhook's media handling | 1 session |
| 6. Steps 1 to 6 | Hello, Google (questions, Path A button behind a flag, Path B steps with placeholder screenshots, email the steps, pending status, dummy acceptance, 24h nudge), Tone (4 tones, your defaults in `src/lib/onboarding/tone-defaults.ts`, real review picking, queue real replies via `createDraft`), Make it right, Menu (with confidence questions), Hours and FAQs | Places, Google import, `extractMenu`, `saveMenu`, `profile_examples`, `recovery_offers` | 2 to 3 sessions |
| 7. Steps 7 to 12 | Sales (confirm months, 8-week rule), Team and labour (upload or chat, labour % default 30 flagged), Rewards and cap, Customer import (consent basis, double opt-in) and QR kit by email and WhatsApp, Languages and dates, Approvals and timing (per-restaurant brief time) | POS import, `understand.ts`, `qr-pack`, `sendConfirmEmail` | 2 to 3 sessions |
| 8. Finish, gaps, resume | Summary card with edit links, activation (nothing runs before step 1 is done), setup gaps (one nudge in the brief by priority, Do it now / Later / Not relevant, auto-dismiss after 3), `/settings/setup` gaps page, 24h resume email and WhatsApp | section registry, `emailLoginLink`, queue job types | 1 to 2 sessions |
| 9. Admin console | `/admin/onboarding`: progress, step, channel, gaps, Google status with "mark accepted", 48h stall alert; test controls (start test onboarding, reset, jump to step, delete, link my number); test sites listed apart | builder auth, `resetOnboarding`, `builder-alerts.ts` | 1 session |
| 10. Tests, fixtures, retire old | Fixtures (3 menu images made by script, review sets), end-to-end runs on the in-memory database with a scripted Dina (CI), opt-in live run, "test site never sends" test, remove the old wizard and WhatsApp flow, CLAUDE.md | `tests/e2e`, `make-sample-z-reports.mjs` approach | 1 to 2 sessions |

About 14 to 18 build sessions. You can test the web flow by hand from the end of phase 6 (steps 1 to 6), and WhatsApp from phase 6 too.

## 5. Conflicts and questions (need your answers before phase 1)

1. **Stripe is already built.** `/start` today: invite code = no card; no code = Stripe Checkout (preview) or "invite only" (live). Proposal: with `ONBOARDING_REQUIRES_PAYMENT=false` (default), `/start` always needs an invite code and never opens Stripe; the existing Stripe code stays in place, unused, behind the flag, and the later prompt flips it. Not deleted.
2. **Logging in after sign-up.** The web chat needs a login, and today that's the emailed magic link (sign-up never logs anyone in, by an earlier decision). Proposal: after sign-up, the "You're in" screen shows "Continue on WhatsApp" straight away (WhatsApp proves the number) and "Carry on here" says "We've emailed you a link to open the chat". Alternative: log the new owner straight in on sign-up (only for a brand-new restaurant, never an existing email).
3. **Linking WhatsApp by number.** Proposal: the first message from the sign-up number links it (WhatsApp itself verifies numbers, and Twilio's signature is checked), but only if that number isn't already an owner or staff number; the one-time code stays as a fallback for a different phone. Unknown numbers: silence, as you asked (today they get one polite reply a day; that would stop everywhere).
4. **Accounts and memberships.** Not built, and I can't find the Oct 22 spec. Proposal: `account_id` nullable now, site manager stored as a staff member with role manager (no login), invite flow later. If you have the spec, send it and I'll match its names.
5. **`is_test` vs `is_demo`.** Proposal: a test site is `is_test = true` and always `is_demo = true`, so every existing guard (test tools, email redirect to you, reset, clear-out) applies without new rules.
6. **Allergens.** Today the AI suggests allergens per dish (saved as unconfirmed, never shown to customers). Your prompt says never invent them. Proposal: Dina doesn't suggest; she asks "Any dishes with nuts, gluten...?" only if the owner wants to do allergens now, otherwise all stay unknown. Or keep the unconfirmed suggestions to save typing.
7. **Finishing without WhatsApp.** Today finishing needs the WhatsApp number linked (the brief lives there). Proposal: keep that rule; Dina asks for it at the end if they used the web only.
8. **Brief time.** Per-restaurant brief time touches the queue's 9am gate and the 9:30 lateness alert. Proposal: allow whole hours 7am to 11am only.
9. **Branch and pushing.** The pilot sprint pushed straight to main. Proposal for this: work on branch `onboarding-dina`, push after each phase, you merge when you're ready to test on the live site (main keeps working meanwhile, old onboarding included).
