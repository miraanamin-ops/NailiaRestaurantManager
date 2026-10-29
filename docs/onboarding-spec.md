# Onboarding with Dina: the original brief

The owner's prompt of 28 Oct 2026, saved word for word as the spec for step 37.
Decisions made since (which change parts of this) are in `docs/onboarding-handover.md`
and `docs/onboarding-audit.md`.

---

Context

You're working on DinerAI (app.dinerai.co.uk), an AI operator for independent restaurants, run mainly through WhatsApp. Stack: Next.js on Vercel, Supabase (Postgres, auth, storage, scheduled jobs), Claude Sonnet for writing and Haiku for sorting and tagging, Twilio WhatsApp (sandbox for now, real number later), Resend for email. Stripe comes later, in a separate prompt.

Already built (verify each, don't assume): WhatsApp owner assistant, approval loop (Approve, Edit, Skip), safety rules and coded release gate, checker step, audit log and UNDO, job alerts and watchdog, TEST_MODE, tests on push, multi-restaurant, an existing onboarding flow (web and WhatsApp), email sign-up and reward redemption, branded email with double opt-in, post-visit feedback, customer deletion and CSV export, CAPTCHA on sign-up pages, Google reviews and posts in dummy mode, morning brief, Monday report, agent organisation. Possibly built, status unknown: data in (Z-report photos, POS CSV import, weather, Sales section), accounts, sites and team access (spec dated Oct 22), "make it right" fields for complaint recovery.

The goal

Replace the current onboarding with one guided, conversational flow led by Dina, your DinerAI manager. The owner signs up on the website, then completes setup by chatting with Dina either in a clean branded web chat or on WhatsApp. Both channels share the same progress, so the owner can switch mid-way. Most steps are skippable; skipped steps become "setup gaps" that Dina follows up later, explaining what each one unlocks.

Important: no paywall in this build. I need to test the whole onboarding flow myself, end to end and repeatedly, before it goes behind payment. So in this build, sign-up leads straight into onboarding with no Stripe step. Do not build Stripe Checkout or trials now. A separate prompt later will add the Stripe free trial and move onboarding to its final place (after a customer has signed up and started their trial). Build it so that move is easy: onboarding should start from a single entry function (e.g. startOnboarding(siteId)) that can later be called from the Stripe webhook instead of from sign-up, with nothing else needing to change.

Phase 0: audit first, then stop

Before writing any code:

Map what already exists for every item in this prompt: sign-up, invite codes, onboarding (web and WhatsApp), restaurant profile fields, menu storage, brand voice storage, make-it-right fields, rewards and discount cap, customer import, QR generation, POS CSV import, staff and labour data, accounts and memberships, Google integration (dummy mode), morning brief, admin console.
Write docs/onboarding-audit.md with a table: item, status (built / partly built / missing), where it lives (files, tables), and what needs changing. Note anything in the current onboarding worth keeping.
Propose a build plan in phases with rough effort, reusing existing code wherever possible.
Stop and wait for my approval before building.
Architecture rules
State machine in code, AI on top. The steps, their order, required fields and statuses live in code and the database. Dina (Claude) handles conversation, extraction and clarification only, and saves data through typed tool calls that are validated server-side. Dina can never mark a step done without the validated data.
One engine, two channels. A single onboarding service drives both web chat and WhatsApp. Channel adapters only handle rendering (buttons, cards, uploads) and input parsing.
Fits the accounts model. Onboarding data attaches to a site (restaurant) and, if accounts and memberships exist, to the account. If they don't exist yet, structure it so the migration is trivial.
Reuse the safety layer. Anything that reaches a customer or a public platform (review replies, posts, messages) goes through the existing checker, release gate, approval loop and audit log. Onboarding never bypasses them.
Idempotent and resumable. Every step can be re-entered safely. Retries never duplicate records or sends.
TEST_MODE and dummy Google mode must work end to end for the whole flow.
Row-level security on all new site-scoped tables, with tests.
Suggested data model (adapt to what exists)
onboarding_sessions: site_id, account_id, current_step, channel_last_used, started_at, completed_at, abandoned_reminder_sent_at.
onboarding_steps: site_id, step_key, status (not_started, in_progress, done, partial, skipped), data (jsonb), completed_at, skipped_at.
setup_gaps: site_id, step_key, unlock_text, nudge_count, last_nudged_at, snoozed_until, dismissed (true when the owner says "not relevant" or after 3 ignored nudges).
invite_codes: code, type (standard, pilot), max_uses, uses, expires_at. (Payment-related fields come in the later Stripe prompt.)
is_test flag on sites, so test runs are easy to filter, reset and delete.
Part 1: website sign-up
Landing page sign-up button leads to the sign-up page (wording becomes "Start free trial" once Stripe is added).
Fields: invite code, name, email, restaurant name, WhatsApp number (UK format, normalised to E.164), password or magic link (match the current auth approach).
One tick box accepting terms, privacy notice and data processing agreement. Store the version and timestamp accepted.
Keep the existing CAPTCHA.
Validate the invite code server-side before account creation. Clear, friendly error messages.
Part 2: test access (no paywall)
On successful sign-up, create the account, site and onboarding session, then call startOnboarding(siteId) directly. No payment step.
Add a feature flag, ONBOARDING_REQUIRES_PAYMENT, defaulting to false. For now it does nothing except mark where the Stripe step will plug in later. Leave a clear TODO(stripe) comment at that point.
Add a "Start test onboarding" button in the admin console (admin login only). It creates a fresh test site flagged is_test = true, pre-filled with dummy sign-up details, and opens the web chat. I should be able to run this as many times as I like.
Test sites:
Never message real customers or post anywhere public, whatever channel (respect TEST_MODE and dummy Google mode).
Can be reset to step 1 with one click, or deleted, from the admin console.
Have a "jump to step" control in the admin console, so I can test any single step without redoing the whole flow.
Can be linked to my own WhatsApp number so I can test the WhatsApp channel too.
Keep the invite code check on the public sign-up page, so nobody outside the pilot can get in while it's unpaid.
Part 3: choose a channel

After sign-up, a branded "You're in" screen with two options:

Carry on here: opens the web chat.
Continue on WhatsApp: a wa.me link with the sandbox join phrase pre-filled, plus the phrase shown with a copy button and simple instructions. Make the join phrase and number config values so switching to the real number later is one change.

On first WhatsApp message, match the sender's number to the number given at sign-up. That match verifies the number. Unknown numbers get nothing.

Part 4: the web chat UI
Clean, mobile-first, using the existing DinerAI branding and design tokens in the repo. Dina has a small avatar and name at the top.
A progress bar ("Setup 4 of 12") that the owner can tap to see all steps and jump to any skipped one.
Rich message components: quick-reply buttons, choice cards (for tones), file and photo upload, editable confirmation cards (e.g. extracted menu), the summary card, and a persistent "Skip for now" option on skippable steps.
Typing indicator while Dina thinks. Messages short, one question at a time.
Works well on a phone in a busy kitchen: large tap targets, no horizontal scroll.
Part 5: WhatsApp rendering
Use interactive quick-reply buttons (max 3) and list messages (max 10 rows) where Twilio supports them. Check what works in the sandbox (Twilio Content API) and always support a numbered text fallback ("Reply 1, 2 or 3").
Accept photos and documents (menu photos, CSV and Excel exports).
One review or one choice per message, never a wall of text.
Respect the WhatsApp 24-hour session window. Any message outside it (resume reminders, gap nudges) needs an approved template. List the templates required in the audit doc.
Part 6: Dina's persona

System prompt essentials:

Introduces herself as "Dina, your DinerAI manager". Always clear she's AI, never pretends to be a person.
Warm, confident, practical. British English. Short messages. One question at a time.
Never uses em-dashes.
Does the work before asking: pre-fills from Google, the website or earlier answers and asks the owner to confirm rather than type.
Never guesses facts (prices, allergens, halal status, hours). If unsure, she asks.
For every skippable step, explains in one line what it unlocks, and makes skipping feel fine: "No problem, we can do this later."
Owners can type naturally at any point ("change Sunday hours", "go back to the menu"); Dina routes it to the right step.
Part 7: the steps, in this order

For each step: what Dina does, what's saved, whether it's skippable, and the unlock line used for setup gaps.

1. Hello (not skippable)

Dina introduces herself and confirms name, restaurant name, address, cuisine, and role (owner or manager). Pre-fill from sign-up.

2. Google profile (skippable)

Unlock: "Connect Google and I'll reply to your reviews, post updates and track calls and directions for you."

Before any instructions, three button questions:

"Do you have a Google profile for the restaurant?" If no, offer short guidance on creating one and move on (mark skipped).
"Are you an owner on it?" If no or not sure, explain only owners can add people, and generate a forwardable message for whoever set it up.
"Are you on your phone or a laptop?" Tailor the instructions. Offer "Email me these steps" (send via Resend) so they can do it later.

Path A (when Google API access is approved; build behind a feature flag): "Connect Google" OAuth button, sign in, pick the location, done. Show upfront: "Use the Google account you manage your profile with."

Path B (current fallback): add DinerAI as a manager. Dina sends numbered steps, each with a screenshot (use placeholder images in public/onboarding/google/ that I'll replace; on web, also a slot for a short video):

Sign in to Google with the account that manages your profile, and search your restaurant name.
Click Menu, then Business Profile settings, then People and access.
Click Add at the top left and paste our email (tap-to-copy button). The email is a config value, e.g. DINERAI_GOOGLE_MANAGER_EMAIL.
Under "Access", choose Manager, then click Invite.

Reassurance line: "Manager, not Owner. You stay in control and can remove us any time."

After they tap "Done, I've invited you": status becomes in_progress (pending acceptance). Acceptance happens on our side: add an admin console action to mark it accepted (and in dummy mode, simulate it). On acceptance, Dina confirms with something concrete, e.g. "I'm in! You have 47 reviews and a 4.6 rating." Mention that Google makes new managers wait 7 days before some features unlock. If not accepted or not invited within 24 hours, one gentle nudge with the steps again.

3. Tone (skippable, defaults to Warm and personal)

Unlock: "Pick a tone and every reply and post will sound like you."

Pick one good and one bad review from their Google profile:

Must have text of at least about 15 words.
Prefer the last 12 months.
Good: 5 stars, ideally mentioning something specific (a dish, a staff member).
Bad: 2 to 3 stars with a specific complaint. Avoid abusive 1-star reviews.
Prefer unanswered reviews. Existing owner replies are read as evidence of their natural voice.

Show the good review first with 4 tone options plus "Write my own", then the bad review the same way. The two picks can differ; save both (praise voice and complaint voice). Any edits to a chosen reply are saved as tone examples.

If the reviews are real, offer to queue the chosen replies through the normal approval loop (bad review replies always require approval and pass the checker). If Google isn't connected, or there's no suitable review, use the defaults below and say so ("Here's a typical review so we can set your tone").

The 4 tones: Warm and personal, Polished and professional, Fun and chatty, Short and simple.

Default good review (Sarah, 5 stars): "Came for my sister's birthday and honestly the mixed grill was the best I've had in ages. The staff were lovely with the kids and even brought out a candle for the cake. We'll definitely be back!"

Warm and personal: "Sarah, thank you so much! We're so glad your sister's birthday was a special one, and that the kids had a great time too. The team loved being part of it. Can't wait to welcome you all back soon."
Polished and professional: "Dear Sarah, thank you for celebrating your sister's birthday with us. We're delighted you enjoyed the mixed grill and our team's service. We look forward to welcoming you again."
Fun and chatty: "Best mixed grill in ages? We'll take that! 🎉 Thanks Sarah, it was a joy having you all in for the birthday. Come back soon and bring the whole crew!"
Short and simple: "Thanks Sarah! So glad you all enjoyed it. See you again soon."

Default bad review (James, 2 stars): "Food was decent but we waited nearly 50 minutes for our mains on a Friday and nobody came over to explain. The chips were cold by the time they arrived. Expected better for the price."

Warm and personal: "James, I'm really sorry about your Friday visit. Waiting that long with no update isn't how we want anyone to feel, and cold chips made it worse. We'd love the chance to put it right, so please drop us a message and ask for the manager."
Polished and professional: "Dear James, thank you for your feedback, and please accept our apologies for the wait and the cold chips. This falls short of our standards and we have shared it with the team. We would welcome the chance to make it right, so please contact us directly."
Fun and chatty: "Sorry James, that's not the Friday night we want for anyone! A 50-minute wait with no update and cold chips isn't good enough, and we've told the kitchen. Give us another go and ask for the manager, we'll look after you."
Short and simple: "Sorry James, that wait and the cold chips aren't good enough. We've shared this with the team. Please get in touch so we can put it right."

Store these defaults in a config or seed file, not hard-coded in components.

4. Make it right (skippable)

Unlock: "Tell me how you like to fix complaints and I'll offer it in replies to unhappy customers."

Use the existing make-it-right fields (find them in the audit). Ask what Dina may offer unhappy customers (invite back, free dessert, a contact to take it offline) and who handles complaints. Any offer is capped by the discount cap and enforced by the release gate.

5. Menu (skippable)

Unlock: "Share your menu and I'll write captions, suggest offers and answer allergen questions using your real dishes."

Photo(s), PDF or upload. Extract with Claude Sonnet vision into structured data: sections, dishes, descriptions, prices, dietary flags. Show an editable confirmation card. Ask clarifying questions only where confidence is low (unclear prices, names). Never invent allergens or halal status; ask, or leave as unknown. Save to the existing menu tables.

6. Hours and FAQs (skippable)

Unlock: "Confirm your hours and FAQs and I'll keep Google accurate and answer common questions."

Pre-fill from Google if connected. Confirm opening hours, then FAQs as buttons: halal certification, parking, delivery and collection, bookings, accessibility, kids, private hire.

7. Sales history (skippable)

Unlock: "Send your sales history and I'll forecast quiet nights and plan offers before they happen."

Ask for a 12-month POS export, with short how-to tips for Square, Lightspeed and Epos Now (placeholders I can fill). Reuse the existing POS CSV importer if built. Accept CSV and Excel. After parsing, confirm: "Got it: 11 months of sales, Nov 2025 to Oct 2026." If shorter than 8 weeks, explain forecasts need more history. Partial uploads count as partial. Feed the forecast engine if it exists.

8. Team and labour (skippable)

Unlock: "Share your team and labour target and I'll track labour % daily and suggest rotas."

Staff list by upload or chat: name, role, hourly rate, contracted hours.
Who the site manager is. If accounts and memberships exist, invite them using the existing flow (they confirm by replying YES); otherwise store for later.
Cover rules (e.g. minimum staff on Friday nights).
Labour % target with a hint: "Most UK independents aim for 25 to 35% of sales; 30% is a common target." Default 30% if skipped, flagged as a default.
9. Rewards and discount cap (skippable, with safe defaults)

Unlock: "Set your rewards and limits and I'll run offers without ever going over budget."

Sign-up reward (default: free dessert), maximum discount Dina can ever offer (feeds the release gate), and how often a customer can redeem. Save to existing rewards and cap settings.

10. Customer list and QR kit (skippable)

Unlock: "Import your customers and print your QR codes and I'll start growing your list."

Optional CSV import. The owner must confirm customers consented to marketing; store consent basis and source per customer. Imported customers go through the existing double opt-in before any marketing.
Generate a printable table QR kit (PDF) using the existing QR sign-up, send it by email and WhatsApp.
11. Languages and key dates (skippable)

Unlock: "Tell me your languages and key dates and I'll plan campaigns around them."

Customer message languages (English plus options such as Urdu, Bengali, Arabic, Turkish), and which dates matter (Ramadan, Eid, football, school holidays, local events).

12. Approvals and timing (skippable, with defaults)

Who approves what (owner only for now, or per the accounts spec if built), morning brief time (default 9am), quiet hours (default no messages before 9am or after 9pm, matching the existing send window).

Part 8: summary and what happens next
Summary card listing everything Dina has, each with an edit link.
Progress: "Setup 9 of 12 done", plus the locked items and their unlock lines.
What's next: first morning brief tomorrow at the chosen time, first Monday report, QR kit live, first review replies queued (if any).
Completing onboarding activates the site: scheduled jobs (morning brief, review checks, Monday report) start. Make sure nothing starts for a site that hasn't finished at least step 1.
Part 9: setup gaps and follow-up
Every skipped or partial step creates a setup_gaps row with its unlock line.
The morning brief includes at most one gap nudge, prioritised by value (Google, then sales history, then menu, then the rest), and tied to a moment when possible, e.g. "Thursday looks quiet, but I need your sales history to plan for it."
Owner replies: "Do it now" (resumes that step in the current channel), "Later" (snooze 7 days), "Not relevant" (dismiss). After 3 ignored nudges, the gap is dismissed automatically.
A web settings page lists all gaps and lets the owner complete any of them.
Every answer is editable later by just telling Dina.
Part 10: save and resume
If an owner stops mid-onboarding for 24 hours, send one "Carry on where we left off" message: email with a magic link, and WhatsApp (template, if outside the 24-hour window). Only once.
Switching channels mid-way picks up the exact step.
Part 11: admin console

Add an onboarding view for me: each site's progress, current step, channel, gaps, Google status (with the "mark accepted" action), and an alert when someone stalls for 48 hours. Include the test controls from Part 2 (start test onboarding, reset, jump to step, delete), and show test sites separately from real ones.

Testing
Unit tests for the state machine: order, skips, partials, re-entry, editing a completed step, gap creation and dismissal rules.
End-to-end tests (TEST_MODE, dummy Google) covering: full web run, full WhatsApp run, switching channel mid-way, all steps skipped, abandoned and resumed, test site reset and jump to step, and confirming a test site never sends anything real.
Fixtures: 3 sample menu photos (clean, messy, handwritten) with expected extraction; review sets for the tone picker (normal, no text reviews, no bad reviews, only abusive 1-stars).
RLS tests proving one site can never read another site's onboarding data.
All existing tests must still pass.
Out of scope

Stripe Checkout, free trials, trial reminders and billing webhooks (a separate prompt will add these and move onboarding behind sign-up and trial once I've tested it). Live Google API calls (behind a feature flag only), switching to the real WhatsApp number, Instagram, trends, loyalty stamp card.

Working style
Phase 0 audit first, then stop for my approval.
Build in small phases, each committed and tested, with a short summary of what changed and anything I need to do (env vars, WhatsApp templates, screenshots to replace).
Ask me when something in this prompt conflicts with what's already built, rather than guessing.
