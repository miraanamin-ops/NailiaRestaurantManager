# Monthly report

What the owner gets early each month: a one-page summary of last month's takings, made from their own sales exports, as a PDF on WhatsApp and by email, plus a page on their phone.

## What's in it

The numbers are worked out in plain code (`src/lib/report/monthly-rules.ts`, tested in `tests/monthly-report.test.ts`). Claude only writes the headline, one summary sentence and three actions, from those numbers. If Claude can't be reached, the code writes its own (never blank).

- **The headline:** net takings, orders and average order, compared with last month and with the same month last year, **like for like**. That means "what this month's mix of weekdays would have taken at the other month's weekday averages", so five Saturdays don't count as growth. The year comparison needs 80% of last year's month.
- **Day by day:** a bar per day, grey where there were no sales.
- **What moved the month:** days at least 15% off the median of the same weekday in the 8 weeks before, with the reason if the calendar (`local_calendar`) or the weather has one. Days with no sales are listed as "closed?" with what a usual day like it takes.
- **Your week:** the average for each weekday, and the busiest and quietest hour (needs sales with times).
- **Your dishes:** the top 5 by takings, plus rising and falling dishes (at least 20 sold, per trading day, against last month), dishes selling under 5 a week, and the top 3's share. This needs a dish-by-dish export (Square's Item sales).
- **Staff and reviews:** staff cost from the rotas against the takings of the same days, against the labour target; new Google reviews and their average.
- **Three things for next month:** each with a "Start in WhatsApp" link.
- **More next month:** for every section left out, what would unlock it.

## When it comes

This runs in the morning job (`src/lib/morning.ts`) with the rules in `monthStep`:

| Day | What happens |
|---|---|
| Last day of the month | The brief asks for the month's export, with the Square steps and the upload link. |
| 1st and 3rd | A reminder in the brief, while the last day has no sales. |
| Once the last day has sales, or on the 4th | The "report" step makes the report and emails the PDF. The brief sends the PDF and the headline on WhatsApp. |

- A restaurant with no sales in the last 45 days is never asked.
- Prompts are lines in the brief, never messages on their own.
- If the brief is waiting for WhatsApp's 24-hour window, the PDF goes with it when the owner next messages.
- **MONTHLY REPORT** (or **MONTHLY REPORT SEPTEMBER**) sends a month's report any time. It makes the report first if it hasn't been made.

## Where things are

- **Code:**
  - `src/lib/report/monthly.ts`: loading, Claude's words, saving, delivery and the morning-job helpers.
  - `src/lib/report/monthly-pdf.tsx`: the PDF.
  - `src/app/report/[token]/monthly.tsx`: the page.
- **Storage:** the `reports` table, with `data.kind = "monthly"`:
  - `period_start` is the month's first day;
  - `period_end` is one second before the next month, so it's never confused with a Monday weekly report;
  - the link lasts 30 days.
- **Links:**
  - The page and its "Download PDF" (`/report/<token>/pdf`) need the owner's login.
  - WhatsApp's copy comes from `/api/report-pdf/<token>?s=…`, a signed link that lasts 7 days, because Twilio can't log in.
