# Pilot Zero: the run sheet

## Rerun from a fresh start (November 2026)

The first run (from 2 Nov) is being replaced by a fresh one, to try everything added
since: Dina's newer questions (sign-off name, emoji, allergen statement, kinds of offer,
minimum profit, logo and colours, dish costs), the owner spreadsheets, the business
review, the monthly report and the new dashboard. What's different from the table below:

- **Day 0 is no longer merge day.** Everything is live. Instead:
  1. Make sure there's Claude credit, and that the test setup run has passed (Claude does it).
  2. Close the old restaurant: **/onboarding/admin > Close an account** > "Maison Noor" >
     confirm > tick **skip the cooling-off**. When the closing email says to remove our
     manager account from Google, **don't**: dina@dinerai.co.uk stays a Manager on
     Maison Noor's profile and is reused.
- **Day 1 sign-up:** app.dinerai.co.uk/start?invite=**PILOT-ZERO-RERUN** with
  +447463775130 and miraan.amin+pilot0@gmail.com (allows 2 sign-ups).
  - **Straight after signing up**, in your builder browser: **/onboarding/admin >
    Pilot Zero > Mark** the new restaurant and check both switches say **Dry run**.
    Do this before the Google step, so nothing can ever write to the real profile.
  - **Menu step:** also try the menu costs sheet (Dina offers it) or give costs as "30%".
  - **Sales step:** send `square-item-sales-6-weeks.csv` too, after the other two
    files, for the dish insights.
  - **Rewards and look steps:** new questions; answer them as Maison Noor would.
  - **Google step:** we're already a Manager, so there is no new invitation to accept.
    Tap "Done, I've invited you" (with no new invitation to accept, you may get a
    builder alert; that's expected). Then link the location yourself on **/settings/google** (builder login).
- **After setup:** the business review starts on its own (up to 10 minutes). Go
  through it on WhatsApp; with dry run on, nothing changes on Google.
- **Days 2 to 7** are as in the table. Also look at the new dashboard on your phone.


One week, one row per day. You go through DinerAI on live as its first real customer.
Background and controls: `docs/pilot-zero.md`. Admin pages (builder login):
**app.dinerai.co.uk/onboarding/admin** > **Pilot Zero** (your restaurant, Google dry run,
the simulation, imported sales, your notes) and > **Close an account**.

Rules for every simulated day (days 3 to 5):
- **First, send any WhatsApp message to your restaurant** (e.g. "Morning"), so the brief
  isn't held by WhatsApp's 24-hour window.
- Then add what happened overnight, press **Run day**, and refresh the page until every
  step shows ✓.
- Note anything that surprises you with **#note …** from your phone, as it happens.

| Day | What you do | What you inject | What you should see | What to #note |
|---|---|---|---|---|
| **0, merge day** (about an hour) | Merge checklist (`docs/merge-checklist.md`) steps 1 to 10: migrations 048 to **056** on live, merge, deploy Ready, the checks. Step 8: ask Claude to move the demo pair to placeholder numbers (needs your OK). Step 10: only the demo pair (and test sites) are demo. | Nothing. | Deploy Ready. The demo phone (`/onboarding/admin/phone` > Ember > HELP) answers in a few seconds. No restaurant on your number any more. | Anything in the checklist that was unclear or slow. |
| **1, sign up and set up** | Ask Claude for an invite code. Step 11: sign up at app.dinerai.co.uk/start with **+447463775130** and **miraan.amin+pilot0@gmail.com** (a separate browser profile from your builder login). Set up with Dina, on the web and WhatsApp. Sales step: send `pilot-zero/square-sales-summary-12-months.csv`, then `square-transactions-6-weeks.csv` too (the rota needs sales by the hour to staff to a forecast). Team step: send `staff-sheet.csv`; she asks who runs the site (Yusuf Rahman), the cover rules (answer "at least 1 manager, 2 in the kitchen and 2 front of house on every shift") and the labour target (28%), one at a time. Step 12 before Google: Pilot Zero page > **Mark** your restaurant; check 056 and that Settings says Dry run. Then invite dina@dinerai.co.uk on Maison Noor's profile. | The two sales files and the staff sheet (made-up data). | "Got it: 12 months of sales, Nov 2025 to Oct 2026". The **Your team** card with everyone's days, times and max hours: check it, tap Looks right. Settings: "🧪 Dry run … Only DinerAI can switch this". Pilot Zero page: your restaurant, both switches **dry run**, "connected to Maison Noor". | How long each step took; any question that felt odd or repeated; anything Dina said that wasn't true. |
| **2, first real day** | Message the restaurant before your brief hour. Live it as an owner: read the brief, approve a reply to a real Maison Noor review, text "Thursday is quiet", sign up 2 customers yourself on the QR form with plus-addresses (e.g. +cust1, +cust2). | Nothing (real day). | The 9am brief. Approving a reply says "🧪 Dry run: nothing changed on Google. Would have posted this reply on Google (Maison Noor): …", and nothing changes on Google. A campaign draft; its email comes to you (redirected). The confirm and welcome emails at your plus-addresses. | Brief timing and wording; whether the replies sound like you; anything you'd want but didn't get. |
| **3, simulated Thursday** | Pilot Zero page > **Start simulating**: next Thursday's date. Then the rules above. After Run day, approve the 1-star reply; change the rota by message (e.g. "Aisha can't do Friday"). In the evening: **Add till report**. | **Add review: 1 star** before Run day. Evening: a till report. | A 1-star alert straight away (from "Sim: Laura B."). The brief with the "🧪 Simulated day" footnote, a Google post to approve, next week's rota (staffed to a forecast if you imported the transactions file; otherwise it says it needs sales by the hour). Approving the 1-star reply: "🧪 Simulated review, so never replied to on Google". | Was the alert worth it; is the rota usable; did the rota edit work first time. |
| **4, simulated Friday** | **Next day**, then the rules above. APPROVE ALL in the brief. Text "Friday was quiet, what can we do?". In the evening: **Quiet day**. | **Add review: 5 stars** before Run day. Evening: **Quiet day** (about 45% of a usual Friday). | The 5-star reply waits in the brief. Daily briefs don't show yesterday's takings: they feed the forecast and Monday's report. A campaign idea for quiet days. | Whether the quiet-day idea is something you'd send; anything that felt like noise. |
| **5, simulated Monday** | **Start simulating**: the following Monday's date (moving forward is fine). The rules above. Open the report link and its PDF. Then **Stop simulating**. | Optionally a till report or review first. | The Monday report with the simulated banner at the top (web page and PDF); labour against your 28% target in the brief; the Monday birthday and planning steps on Run day's list. After Stop: the simulation box says Off, 0 simulated reviews and till reports, and the real scheduled jobs run again from the next hour. | Whether the report says something useful in the first 10 seconds; anything confusing in the PDF. |
| **6, Google live (optional, your call) and closing** | Only if you want to: Pilot Zero page > Review replies and posts > type "Maison Noor" > **Switch to live**; approve exactly **one** real reply on WhatsApp; check it on Google; then **Back to dry run**. Hours and photos stay dry run. Then test closing on a throwaway: `/onboarding/admin` > Start a test onboarding > **Close an account** > request, confirm with "skip the cooling-off". | Nothing. | The one reply on Maison Noor's Google profile, and the switch back to dry run in the log. The test restaurant closes: the export email (for a test site it comes to you), then it's gone and one anonymous line (CL-…) is left. | How the live reply looked on Google; anything in the closing email you'd change. |
| **7, wrap up** | Pilot Zero page > **Download all as CSV** (your notes). Look through `/log`. Decide what happens to Maison Noor next. **Last step of Pilot Zero:** Pilot Zero page > **Imported sales** > remove both uploads (type the restaurant's name), or the range 1 Nov 2025 to 31 Oct 2026, so the made-up year can never shape a real restaurant's forecasts. | Nothing. | The notes CSV. The Sales page with no imported days left (your till reports, if any, stay). | Your top three changes before the first real pilot. |
