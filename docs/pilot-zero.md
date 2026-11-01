# Pilot Zero

You go through DinerAI as the first real customer, on live, after `onboarding-dina`
is merged. The harness is built on that branch so it ships with the merge. Every
Pilot Zero feature is off unless a restaurant is marked for it, so the phone test on
the preview isn't affected.

Read with `docs/onboarding-handover.md` (section 8: what already existed) and
`docs/merge-checklist.md`.

## Decisions (1 Nov)

| Topic | Decision |
|---|---|
| Your number | `BUILDER_WHATSAPP` (+447463775130) becomes the owner number of your Pilot Zero restaurant: the real owner experience. Alerts, BUILDER commands and #note keep working from it. |
| Demo pair | Ember & Spice and Cardamom Corner move to placeholder numbers that can't receive anything (+44 7700 900401 and 900402). You run them from the **demo phone** in the admin console. No `BUILDER_TEST_WHATSAPP`. |
| Google for Pilot Zero | Maison Noor's real profile, by the manager route (dina@dinerai.co.uk). Dry run on by default, switched only in the admin console with a confirmation naming the profile. Simulated reviews can never be replied to. With dry run off, every write still needs your WhatsApp approval and is logged. Hours and photo changes stay dry run until switched on separately. The owner sees "would have posted" for every dry-run write. |
| Real scheduled jobs | Skip a restaurant while its simulation is on; "Run day" drives it. |
| Test files | 12-month Square **Sales summary** plus a 6-week **Transactions** file (a year of transactions is too big for the 16 MB upload). |
| Export on closing | Link lasts 7 days; the file is deleted when it expires; one anonymous closure line is kept. |
| Cooling-off | 24 hours, cancellable; skippable from the admin console on demo and Pilot Zero restaurants. |
| Migrations | 055 and 056 go on dev only after you say the phone test is finished; live gets both with the merge. |
| Scope (about 3 days) | Simulation: date, Z-report, simulated reviews (incl. a 1-star), quiet day, Run day. Close account: admin console only. |

## Phases

| # | What | Status |
|---|---|---|
| 1 | Identity: live listing, plus-addresses, demo phone and placeholder numbers | **done** |
| 2 | Google dry run, simulated reviews never replied to (056 on dev after the phone test) | **done** |
| 3 | Simulation in `/onboarding/admin`: date, Z-report, simulated reviews, quiet day, Run day | **done** |
| 4 | Test data in `/pilot-zero`, through the real importers | **done** |
| 5 | Close account (admin console) | **done** |
| 6 | #note and its CSV export | **done** |
| 7 | Two simulated days with dry-run Google; tests; preview Ready; the run sheet | **done** |

## Phase 1: identity

**Live, read only (1 Nov)**, `scripts/who-uses.mjs --live`:
- Ember & Spice Grill: owner number `whatsapp:+447463775130` (yours), 368 WhatsApp
  messages; a customer and consent with miraan.amin@gmail.com; a Google connection
  for miraan.amin@gmail.com, status disconnected.
- Cardamom Corner Café: no owner number, no owner email.
- Login accounts: miraan.amin@gmail.com, miraan.amin+trial1@gmail.com,
  miraan.amin+trial2@gmail.com (both plus-addresses signed in fine on 14 Oct).
- No staff numbers, no setups waiting to link.

Dev has nothing on your number or email.

**Plus-addresses**: sign-up keeps the address exactly as typed (lowercased), login
matches it exactly (so `you+pilot0@gmail.com` is an owner of its restaurant only, not
the builder), customer sign-ups and deletion work by exact address and token, and no
email is ever put in a link. One change: with EMAIL_REDIRECT on, an address in
the builder's own inbox (`you+anything@gmail.com`, or Gmail's dotted forms) now goes
as itself instead of being redirected to `you@gmail.com` (`mailbox` in
`src/lib/email/route.ts`). Anyone else's plus-address is still redirected.
Tests: `tests/email.test.ts`, `tests/auth.test.ts`, `tests/invites.test.ts`.

**Placeholder numbers** (`isPlaceholderNumber` in `src/lib/switches.ts`): +44 7700
900400 to 900499, a block of Ofcom's drama range, never a real phone. Nothing is ever
sent to one: `createMessage` in `src/lib/whatsapp.ts` returns a `placeholder-` id
without calling Twilio, and the message is logged as usual. Nobody can text from
one (Twilio signs every inbound message), so on production a demo restaurant on a
placeholder number gets test tools (`testToolsFor`), driven only by the demo phone.

**The demo phone** (`/onboarding/admin/phone`, builder login only;
`src/lib/demo-phone.ts`): pick Ember & Spice or Cardamom Corner, type as their owner
(or tap 1, 2, 3, HELP, RUN BRIEF, RUN REPORT, TIME OFF). The message is logged and
put on the same `owner_message` queue as a real WhatsApp message, so the assistant
answers exactly as on WhatsApp; the page reloads for a minute and shows the answer.
Buttons are answered by typing 1, 2 or 3. It refuses any restaurant that isn't
demo or isn't on a placeholder number. Each message is in the audit log
(`demo_phone`). Picked over "AS EMBER" from your phone because it needs no change to
the webhook (the security-critical path) and can't mix your Pilot Zero
conversation with a demo one.

**Fixed on the way**: `testToolsFor` compared numbers with `/D/g` instead of `/\D/g`,
so `whatsapp:+44…` and `+44…` never matched (branch only, never live).

**The live change for the demo pair** (shown, not applied):

```
node --env-file=.env.live.local scripts/demo-numbers.mjs --live
restaurants.owner_whatsapp:
  Ember & Spice Grill (ember-spice): whatsapp:+447463775130  ->  whatsapp:+447700900401
  Cardamom Corner Café (cardamom-corner): (none)  ->  whatsapp:+447700900402
Nothing else changes (their customers, drafts, messages and settings stay as they are).
```

Run it with `--yes` only **after the merge** (the code on main has no demo phone, and
would send Ember's messages to a number Twilio can't deliver to). Undo:
`--yes --back ember-spice=whatsapp:+447463775130 cardamom-corner=`. It's in the merge
checklist as step 8, and must run **before** you sign up your Pilot Zero restaurant
(step 11).

Nothing queued for Ember can reach your phone after the move: every scheduled
message reads `owner_whatsapp` when it sends. The only jobs carrying a number are
WhatsApp messages waiting for an answer; the script closes queued ones and refuses
while one is being answered. The assistant ignores a message whose sender isn't the
current owner number, and the queue's "Sorry" (`onDead` in `src/lib/queue/handlers.ts`)
never goes to a number that moved (`tests/queue.test.ts`).

**After the move**:
- Ember stays active: its scheduled jobs run as before, and their messages only
  show on the demo phone. Its brief waits for a message inside the 24-hour window,
  as for any owner: send anything from the demo phone.
- "Link my WhatsApp" on a test onboarding will say your number belongs to another
  restaurant (Pilot Zero). Test onboardings then run in the web chat.
- Logins: log in as the builder (miraan.amin@gmail.com) and as the Pilot Zero owner
  (your plus-address) in different browser profiles, or one in a private window.

## Phase 2: Google dry run

**Migration 056** (`supabase/056_pilot_zero.sql`, rollback in `supabase/rollback/`) adds three
columns to `restaurants`: `pilot_zero` (the mark), `google_dry_run` and
`google_profile_writes`. Later phases may add to the same file before it runs anywhere.
**Fails closed on Production** (your call, 1 Nov):
- If 056 hasn't run, every Google write on Production is refused. The owner sees a
  dry run, and you get one alert ("Production is running without 056"). No exception
  for Ember & Spice: no live Google test for it is pending (its Google connection is
  disconnected, and there's no profile for it other than Maison Noor).
- A restaurant whose owner number is `BUILDER_WHATSAPP` counts as Pilot Zero for the
  dry run from the start, before it's marked. So Maison Noor is dry run the moment it
  connects.
- Previews and local work behave as before 056 (nothing is dry run unless set, and
  your number gets no default), so your phone test isn't changed. Previews never
  write to live Google anyway.
- Side effect: between the merge and step 8, Ember & Spice is still on your number,
  so its (dummy) Google replies show as dry run. Nothing reaches Google either way.

**The rules** (`googleDryRun` in `src/lib/gate-rules.ts`, pure and unit-tested):
- Two kinds of write: review replies and posts; hours and photos.
- A Pilot Zero restaurant: both dry run until switched. Hours and photos go live only
  when both switches are live. Everyone else: as before, unless the builder sets
  `google_dry_run`.
- A reply to a simulated review (`reviews.source = 'simulated'`, phase 3) never goes
  to Google, whatever the switches say.
- A Pilot Zero restaurant's Google writes are never on Auto: each one needs the
  owner's Approve (`tapOnlyForGoogle` in `src/lib/trust.ts`).

**Where it's enforced**:
- The send gate (`attemptSend` in `src/lib/send.ts`, step 3b): a dry-run write is
  marked sent and simulated, Google isn't called, and the owner's WhatsApp reply says
  `🧪 Dry run: nothing changed on Google. Would have posted this reply on Google
  (Maison Noor): "…"`. The same line is in the owner's `/log` and on the admin page.
  The draft keeps it under `checks.send.dry_run`, so UNDO knows nothing reached Google.
- The wall (`gbp()` in `src/lib/google/api.ts`): any write of a dry-run kind is
  refused before Google is called, including taking replies and posts down.
- The live connector refuses a reply to a simulated review.
- The owner's Settings page says when Google is dry run, and that only DinerAI can
  switch it.

**The switch** (`/onboarding/admin/pilot-zero`, builder login, `src/lib/pilot-zero.ts`):
- **Mark**: only a test restaurant or one on your own number (`BUILDER_WHATSAPP`) can
  be marked. A real pilot's restaurant and the demo pair can't.
- **Switch to live**: type the Google profile's name exactly (e.g. "Maison Noor"). Needs
  a connected profile. **Back to dry run**: one tap.
- Every change is in the audit log (actor builder). UNDO only reverses the owner's own
  actions, so it can't touch these.
- `tests/pilot-zero.test.ts` fails if any other file writes these columns. They aren't
  profile fields, so no message, Dina tool or settings form can set them.
- The page lists the latest "would have posted" writes for each Pilot Zero restaurant.

Tests: `tests/pilot-zero.test.ts` (rules, switch, never Auto, nothing else writes
them) and `tests/google-live.test.ts` "Google dry run" (against the mocked Google API:
nothing written while dry run, replies live but hours still dry, simulated reviews,
the wall, UNDO, other restaurants unchanged).

## Phase 3: the simulation

On the Pilot Zero page (`/onboarding/admin/pilot-zero`), each marked restaurant has a
**Simulation** box. Code: `src/lib/simulation-rules.ts` (pure) and `src/lib/simulation.ts`.
It needs 056 (columns `reviews.simulated`, `sales_days.simulated`, `sales_hours.simulated`
and the `sim_day` job type were added to the same file).

- **Start simulating** on a date. The restaurant's clock (`restaurants.fake_now`, which a
  Pilot Zero restaurant now honours as well as a demo one) rests at **midday** on that
  date, inside sending hours. Owner messages on WhatsApp work on the simulated date.
- While it's on, the **real scheduled jobs skip the restaurant** (the dispatcher, and the
  late-brief alert). **Stop simulating** goes back to real time and the real jobs.
- **Add till report**: that weekday's usual takings (the average of the same weekday
  in its sales history, or a typical day), or an amount you type. **Quiet day**: about
  45% of usual. Stored as a till report marked dummy and simulated, with sales by hour.
  It never replaces a day that has real figures.
- **Add review** (1 to 5 stars): arrives at the simulated time, from "Sim: …", source
  `simulated`. It's never replied to on Google, whatever the dry run switch says.
- **Run day**: every scheduled job for the simulated date, in the order they really run,
  each at its own simulated time:
  1. 02:05 review check (a new 1 to 3 star review alerts you at once; 4 to 5 are drafted
     and held for the brief)
  2. 05:35 nightly forecast (the app's own week forecast, saved as the brief will show it;
     the Python models on Railway can't run for a simulated date)
  3. at the brief hour, the morning job's steps: held sends, Monday's birthday email,
     Monday and Thursday's Google post, Monday's report, Monday planning, the brief
  4. Thursday 10:00: next week's rota (before an 11am brief, as it really would)

  Each step is its own queued job, like the real morning job, so a slow Claude call
  can't time the day out. A step that fails is shown and the rest still run. The box
  shows each step as it goes (refresh). Afterwards the clock rests at midday again.
- **Next day** moves the date on by one. Then add what happened and Run day again.
- **Labels**: a brief made during the simulation ends with "🧪 Simulated day: …", and a
  report made during it says so at the top (web page and PDF). Simulated sales show as
  dummy figures on the Sales page and in the report. The only export (the customer list)
  has nothing simulated in it.
- **Clear simulated data** removes this restaurant's simulated reviews, till reports and
  hours mid-simulation (drafts about them stay).
- **Stop simulating undoes everything the simulation touched**, whether or not you
  pressed Clear (your call, 1 Nov: simulated figures must never feed a real forecast).
  The app's forecast and the Python models read sales with no filter, so nothing is
  left for them to read:
  - simulated till reports, sales by hour and reviews are deleted;
  - forecast copies saved since it started are deleted (a real brief on that date
    would otherwise read one);
  - unsent drafts made since it started are withdrawn, and a rota week drafted since
    then is removed (or the real Thursday job would skip that week);
  - the once-a-day markers (last brief, last report, ...) go back to what they were
    when it started (saved in `restaurants.simulation`), so a simulated Thursday can't
    stop the real Thursday's brief.
  Each step must work before the next, and the clock is cleared last: if anything
  fails, the simulation stays on (real jobs keep skipping) until Stop works.
  Reports made during it stay, with their simulated banner.
- Only a marked restaurant can be simulated. Every action is in the audit log (action
  `simulation`, actor builder). Tests: `tests/simulation.test.ts`.

Trying it on the preview needs 056 on dev (after your phone test).

## Phase 4: test data

`pilot-zero/` (see its README): a 12-month Square Sales summary (361 days, Nov 2025 to
Oct 2026, with the week, Ramadan, both Eids, school holidays, two closures and a big
event), a 6-week Square Transactions file (5,463 payments, 1.8 MB, matching the
summary), a staff sheet (10 people, all at £12.71 an hour or more) and ten WhatsApp
lines that set each person's availability. Made by `pilot-zero/make-files.mjs` (always
the same output). `tests/pilot-zero-files.test.ts` runs them through the real
importers: none was rejected, so nothing needed fixing.

**Availability (your call, 1 Nov):** Dina's team step now saves each person's days, times
and max hours too. `save_team` only notes the team (`team_draft`); the **Your team** card
(`teamCard` in `ops-content.ts`, from the draft) shows it, and "Looks right" saves it
(`confirmTeam` in `ops-step.ts`, through `saveStaff`). Days and times in the owner's words
are read by the rota's own parser (`parseDays`, `parseTimes`); one it can't read goes back
to Dina to ask about. A change on the card means a corrected `save_team`. Dina's prompt is
0.13. The WhatsApp "add …" lines still work as a fallback.

**Removing imported sales** (`src/lib/pilot-zero-sales.ts`; Pilot Zero page > Imported
sales): one upload, or a date range, for a restaurant marked for Pilot Zero, after typing
its name. Imported days, hours and items go; uploads wholly covered are marked removed and
their files deleted; till reports the owner sent stay. Audit action `sales_removed`.

## Phase 5: closing an account (admin console)

`/onboarding/admin` > **Close an account** (`src/lib/closure-rules.ts` pure, `src/lib/closure.ts`).
Needs 056 (`account_closures`, the private `account-exports` bucket, the `account_close` job).

1. **Request** (ask 1): pick the restaurant and type its name. Nothing changes yet.
   Ember & Spice and Cardamom Corner can't be closed.
2. **Confirm** (ask 2): type the name again and tick "I understand everything will be
   deleted". Sending is paused at once and the owner is emailed when it closes and how
   to cancel (reply to the email). It closes after a **24-hour cooling-off**, picked up
   by the hourly job. **Cancel closing** works until then and puts sending back on. A
   demo or Pilot Zero restaurant can tick "skip the cooling-off" and close straight away.
3. **Closing** (a queued system job; each step is recorded, so a retry carries on where it
   stopped; if it dies, the page shows the error with **Try again**):
   1. the export: `account.json` (everything that's theirs: profile, customers and
      consents, reviews, drafts, campaigns, sales, team and rotas, reports, the chats,
      the log; no logins or tokens), `customers.csv` and `sales.csv`, under the
      anonymous reference in `account-exports`;
   2. Google: their own login is revoked (`disconnect`); if we're on their profile as a
      manager (dina@dinerai.co.uk), our link is removed, you get an alert to remove the
      manager account from that profile, and the owner's email tells them how too;
   3. Stripe: the subscription is cancelled when Stripe is on (else "off");
   4. the owner's email with the download links, valid 7 days (sent before anything is
      deleted, so a failed email stops the closing);
   5. deleting: the restaurant's files in post-photos, sales-files and onboarding-uploads,
      its login (unless another restaurant or your own builder login uses that email),
      then the restaurant row, which takes every table with it;
   6. **one anonymous line kept**: the reference (CL-…), the kind (demo, Pilot Zero, real),
      the dates, what each step did and the counts. No name, email or number.
4. The daily clean-up deletes the export files once their 7 days are up.

Everything is in the audit log while the restaurant exists (action `closure`), and you
get an alert when it's closed. Not covered by us: Twilio's own message logs, Resend's email
logs and Supabase's backups keep copies for their own retention periods.
Tests: `tests/closure.test.ts` (asking twice, the cooling-off, cancelling, the export,
Google both ways, Stripe, a retry, the login, the export deleted after 7 days, and the
other restaurant's rows, files and login untouched every time).

## Phase 6: #note

From your own WhatsApp (`BUILDER_WHATSAPP` only), send **#note** and what you noticed, e.g.
`#note the brief said Friday was quiet but it wasn't`. The webhook catches it before
anything else (`isNoteCommand` in `src/lib/feeds/builder-parse.ts`), so it never reaches
Dina or the assistant, even though your number is your Pilot Zero restaurant's owner
number. It's saved in `pilot_notes` (056) with the simulated date if your restaurant is
simulating, else today's, and you get "📝 Noted for 2026-11-12 (simulated day)." back. A
repeat delivery from Twilio is noted once. From any other number "#note" is an ordinary
message. The Pilot Zero page lists the latest 20 and **Download all as CSV**
(`/onboarding/admin/pilot-zero/notes`: date, simulated, restaurant, note, time written;
formula-safe). Notes stay if the restaurant is closed. Tests: `tests/pilot-notes.test.ts`
and the #note cases in `tests/webhook.test.ts`.

## Phase 7: two simulated days, the real team step, the run sheet

**Two simulated days** (`tests/pilot-zero-two-days.test.ts`, in memory: 056 isn't on dev
yet). A restaurant on your number, set up as on live (Production, Google through our
manager account, dry run by default), with the pilot-zero year and team, runs a simulated
Thursday and Friday through the real simulation, morning job, review check, rota, send
gate and Google wall (only Claude, WhatsApp and Google's servers are stand-ins). The
overnight 1-star alerts at once; the briefs carry the 🧪 footnote; approving replies says
"would have posted" (and "simulated review" for the 1-star); **nothing is written to
Google**; Stop puts everything back. Found and fixed: with a year of daily totals but no
sales by the hour, the rota said "less than 8 weeks of sales history"; it now says it needs
sales by the hour (and the run sheet imports the transactions file too).

**The team step with the real Claude** (`tests/e2e/dina-team.e2e.ts`, in memory, two runs,
$0.06 and $0.05):
- Run 1 stumbled: she read the sheet, asked the labour target first (one question at a
  time, right), then "couldn't see the rows" any more and kept asking for the sheet. The
  sheet was only in front of her on the turn it arrived. **Fixed**: it's kept on the step
  and given to her every turn until the team is saved (`staffSheetData` in `turn.ts`;
  test in `tests/dina-ops.test.ts`). An owner would have hit this too.
- Run 2: sheet, one question (target), `save_team`, the team card, Looks right: all 10
  saved with days, times, max hours, contracted hours and pay exactly as in the sheet.
- Still to watch: she didn't ask about cover rules (the sheet has none), so none were
  saved. The run sheet tells you to say them. Making her always ask is a small prompt
  change if you want it.

**The run sheet**: `docs/pilot-zero-run-sheet.md`.

## Notes for the run sheet (phase 7)
- Each simulated day starts with: send any WhatsApp message to the restaurant, so the
  brief isn't held by WhatsApp's 24-hour window (your call, 1 Nov).
- The last step of Pilot Zero: remove the made-up imported sales (Pilot Zero page >
  Imported sales), so they can't shape a real restaurant's forecasts later.

## Open items (deferred by your call)
- Close account for the owner on the web and WhatsApp (the admin console version
  is phase 5).
- The privacy notice and the data processing agreement must say that Twilio, Resend
  and Supabase keep their own logs and backups for their own retention periods after
  an account is closed (your call, 1 Nov).
- Injected customer sign-ups in the simulation (you'll sign up a couple yourself
  with plus-addresses).
