# Pilot Zero test files

Made-up data for a halal food hall in Ilford ("Pilot Zero Food Hall"), for trying
DinerAI end to end. Made by `make-files.mjs`, always the same output:
`node pilot-zero/make-files.mjs` remakes them. `tests/pilot-zero-files.test.ts` runs them
through the real importers on every test run.

They're in the layout of Square's exports, written by hand, not real exports. If a real
Square export ever looks different, trust the real one.

## The files

| File | What it is | Where it goes |
|---|---|---|
| `square-sales-summary-12-months.csv` | Square **Sales summary**, one row per day, 1 Nov 2025 to 31 Oct 2026 (361 days: 4 closed days left out, as Square does). Net sales about £653,000 for the year. | Dina's **sales** step (or Sales page > Upload). The columns to confirm: Date, takings = "Net Sales". |
| `square-transactions-6-weeks.csv` | Square **Transactions** export, one row per payment, 20 Sep to 31 Oct 2026: 5,463 rows, 3 refunds, 1.8 MB (small enough for WhatsApp). Each day's net sales match the summary. | After the summary, if you want each day's **number of orders** too (forecasts are better with it). Columns: Date, takings = "Net Sales", orders = one per "Transaction ID". |
| `staff-sheet.csv` | The team: 10 people, all at £12.71 an hour or more (the National Living Wage from April 2026), with role, pay, contracted hours, days, times and max hours. | Dina's **team** step. |
| `staff-availability-messages.txt` | One WhatsApp line per person, e.g. `add Aisha Patel, front of house, £12.71, fri-sun, 5pm-11pm, max 20 hours`. | The fallback (see "Availability" below). |

## What's in the sales

- **The week:** Monday to Thursday quiet (about £1,000 to £1,250 net), Friday about
  double (prayers at lunchtime, then the evening), Saturday the busiest, Sunday busy.
- **Seasons:** January quieter, the summer busier, about 6% growth over the year.
- **School holidays (Redbridge 2025/26):** weekdays about 15% busier. 22 Dec to 2 Jan,
  16 to 20 Feb, 30 Mar to 10 Apr, 25 to 29 May, 22 Jul to 2 Sep, 26 to 30 Oct.
- **Ramadan (expected 18 Feb to 19 Mar 2026):** about 12% busier, the last ten nights
  (from 10 Mar) about 25% busier.
- **Eid al-Fitr (Fri 20 Mar 2026):** about 2.3 times a usual day, the day after 1.6.
  **Eid al-Adha (Wed 27 May 2026):** about double, the day after 1.4.
- **Closed:** Christmas Day, and Mon 13 to Wed 15 Jul 2026 (a made-up kitchen refit).
- **A big event:** Sat 13 Jun 2026, about 1.85 times a usual Saturday (a made-up
  festival in the park nearby).
- **In the transactions:** orders from 12:00 to 23:00, a lunch bump, the evening peak, a
  bigger Friday lunch, more afternoon families in the October half term; about 12% cash.

The Ramadan and Eid dates are the expected ones; the real dates follow the moon and can
move by a day.

## The team

| Name | Role | £/hour | Contracted | Days | Times | Max hours |
|---|---|---|---|---|---|---|
| Yusuf Rahman | Manager (site manager) | 15.50 | 40 | Mon to Fri | any | 45 |
| Sana Akhtar | Manager (assistant) | 14.20 | 30 | Thu to Sun | 12pm to 11pm | 36 |
| Bilal Hussain | Kitchen | 13.80 | 40 | Weekdays | any | 40 |
| Imran Qureshi | Kitchen | 13.20 | 32 | Wed to Sun | evenings | 35 |
| Farah Begum | Kitchen | 12.71 | 16 | Weekends | any | 20 |
| Tomasz Nowak | Kitchen | 13.00 | 24 | Mon to Thu | 12pm to 6pm | 25 |
| Aisha Patel | Front of house | 12.71 | 20 | Fri to Sun | 5pm to 11pm | 20 |
| Daniel Mensah | Front of house | 12.90 | 30 | Every day | lunchtimes | 30 |
| Zara Ali | Front of house | 12.71 | 12 | Weekends | any | 12 |
| Hamza Siddiqui | Delivery | 12.75 | 25 | Thu to Sun | evenings | 28 |

**Staffing rules to tell Dina** on the team step: Yusuf Rahman is the site manager; at
least 1 manager, 2 kitchen and 2 front of house on every shift; labour target 28%.

## Availability

Dina's team step reads everyone's days, times and max hours from the sheet and shows
them on the **Your team** card. Check it and tap **Looks right**: code saves the team
then, availability included ("Any time" means no time limit). If something's wrong, say
so and she shows the corrected card.

**Fallback:** after setup, the ten lines in `staff-availability-messages.txt` set the
same availability by WhatsApp, one message each (the test checks they give exactly what
the sheet gives). Text `TEAM` to see the team with their days and times.

## Careful on live

Imported sales are ordinary sales data, not simulation data. They aren't labelled
simulated, and Stop simulating doesn't remove them. Upload them only to a test
restaurant, or to your Pilot Zero restaurant if you're happy for its forecasts to be
based on this made-up year. (Simulated till reports and quiet days, added from the
admin console, are the ones Stop removes.)

**To wipe them later** (e.g. if Maison Noor becomes a real customer):
/onboarding/admin > Pilot Zero > your restaurant > **Imported sales**: remove one upload,
or everything imported in a date range. Type the restaurant's name to confirm. Till
report photos the owner sent are kept. It can't be undone.
