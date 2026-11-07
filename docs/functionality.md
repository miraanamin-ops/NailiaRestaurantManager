# DinerAI: everything it does

*Written 7 November 2026, from what is built and live on app.dinerai.co.uk.*

DinerAI is an AI marketing and operations assistant for independent, single-site
restaurants. The owner runs it from WhatsApp, with a web app for when they want the
bigger picture. The AI does the work and arrives with a finished draft. The owner taps
**Approve**, **Edit** or **Skip**. Nothing reaches a customer or Google unless it passes
safety rules written in plain code.

**Status labels used below**
- **Live**: working on the live site today.
- **Live, limited**: works, with a limit explained underneath.
- **Built, switched off**: finished and tested, waiting for an outside approval, a key or a decision.
- **Not yet**: not built.

---

## 1. The idea in one minute

- **WhatsApp first.** The owner never has to log in to anything. Every message to
  them carries a decision or a result, never "just checking in".
- **Do the work before asking.** Review replies, Google posts, email offers and rotas
  arrive already written, so approval is one tap.
- **Batch, don't drip.** Routine items wait for one morning message. Only urgent things
  (a bad review, something the owner asked for) arrive straight away.
- **Nothing reaches a customer unchecked.** Every draft goes through four checks and a
  send gate written in code, not left to the AI's judgement.
- **A team of specialist AI agents** sits behind one assistant: a general manager (the
  "GM") who talks to the owner, and specialists for reputation, Google visibility,
  insights, growth (campaigns), plus a checker that reviews everyone's work.

---

## 2. Signing up and getting set up

| Feature | What it does | Status |
|---|---|---|
| Website | dinerai.co.uk: dark, mobile-first landing page explaining what DinerAI does, how it works, the safety checks, a sample Monday report, pricing (£99 a month) and FAQs. Privacy notice, terms and data processing agreement pages. Illustrative numbers are labelled "Example". | Live |
| Sign-up | /start: owner name, restaurant, email, mobile, terms tick box, a CAPTCHA and rate limits. Invite codes let a restaurant in without paying. | Live, invite-only |
| Paid sign-up | Stripe Checkout with a free trial, then £99 a month. Login link after paying, a Billing card in settings, Stripe's portal to change card or cancel (at period end). Failed payments show a banner and keep the restaurant running; cancelled or unpaid accounts are switched off with their data kept. | Built, switched off (Stripe test mode only) |
| Setting up with Dina | Dina is the onboarding assistant. She takes the owner through setup in a web chat or on WhatsApp, and they can switch between the two at any step without losing progress. Every step can be skipped and finished later. | Live |
| Step: hello and Google | Finds the restaurant on Google Maps, then helps the owner add DinerAI as a Manager on their Google profile, with step-by-step pictures, a reminder 24 hours later and automatic acceptance of the invitation. Copies address, hours, phone, rating, photos and reviews across. | Live |
| Step: tone of voice | Shows replies to the restaurant's own real reviews written in four tones. The owner picks one or writes their own, plus their sign-off name and emoji preference. | Live |
| Step: making it right | What the owner is happy to offer an unhappy customer (e.g. a free dessert), and who customers should contact. Refused if over the discount cap. | Live |
| Step: menu | The owner sends photos or a PDF of the menu. AI reads it into sections, dishes and prices to check. Allergens are suggested dish by dish but never shown to customers until the owner confirms each one. Optional dish costs (exact, estimated or "30% for the rest") for profit checks. | Live |
| Step: hours and common questions | Confirms opening hours and answers to 7 common customer questions (halal, parking, bookings and so on), saved in the owner's own words. | Live |
| Step: sales history | Upload last year's till export (CSV or Excel, up to 25 MB) or our daily takings spreadsheet. It works out the columns, imports the history and says what it found ("12 months of sales, Nov 2025 to Oct 2026"). | Live |
| Step: team and labour | Who works there, their role, pay, contracted hours, usual days and times, maximum hours, cover rules and the labour cost target. Can be sent as our team spreadsheet. | Live |
| Step: rewards and offers | The sign-up reward for new customers, the kinds of offer the owner is happy to run, the discount cap and the minimum profit to keep after an offer (50% recommended). | Live |
| Step: your look | Logo and brand colours (picked up from the website or sent as a photo) and 3 suggested dish photos. | Live |
| Step: QR codes | A printable pack (four table cards and a counter sign, plus an A4/A5 poster) in the restaurant's colours, linking to its customer sign-up page. | Live |
| Step: approvals and timing | What time the morning message arrives (7 to 11am) and the hours customer emails may go out. | Live |
| Finish | A summary card of everything saved, with "Change" links and a list of anything still to do. Every agent whose checklist is complete switches on. | Live |
| Business review | Straight after setup, a first review of the restaurant: reads up to 200 Google reviews, drafts replies to the unanswered ones, scores the Google profile and suggests fixes, finds nearby rivals, lists the next 30 days' key dates, makes the QR poster. The owner works through it one step at a time on WhatsApp; it counts the time saved. | Live |
| Owner spreadsheets | Four Excel templates in the restaurant's colours: menu costs (pre-filled with their dishes), team, an example till export, and daily takings (365 dates filled in). Downloaded from settings, by texting SPREADSHEETS, or offered by Dina; sent back on WhatsApp or uploaded, and read by plain code (no AI). | Live |

---

## 3. The daily and weekly rhythm

| Feature | What it does | Status |
|---|---|---|
| Morning brief | At the owner's chosen hour: a numbered list of everything waiting (at most 5 cards, urgent first), each with Approve / Edit / Skip, plus **APPROVE ALL** (or "APPROVE 2"). Also: a "done for you" line, today's forecast, the next few days' events, labour against target on Mondays, and a nudge if yesterday's sales are missing. Nothing at all on a quiet day. | Live |
| Urgent alerts | A 1 to 3 star review arrives straight away with a drafted reply. At most one alert an hour, and none in the owner's quiet hours (default 11pm to 9am). | Live |
| Monday report | A mobile web page and PDF, with a short WhatsApp version: headline, last week's sales against the forecast, Google (rating, reviews, replies, calls, directions, views, what customers said), customers and campaigns, your menu, time saved, next week (forecast, rota cost, key dates), and 3 actions with "Start in WhatsApp" buttons. | Live |
| Monthly report | Early each month: last month's takings like for like (against last month and last year, allowing for the mix of weekdays), 3 or 4 key messages, busiest days and hours, dishes rising and falling, staff cost, reviews, three actions, and how the restaurant compares with nearby DinerAI restaurants (only with 5 or more nearby, opt-out in settings). PDF on WhatsApp and email. Asks for the month's sales export at month end. | Live |
| Evening receipt | After a business review session, an evening message summing up what was done. | Live |

---

## 4. Talking to DinerAI on WhatsApp

| Feature | What it does | Status |
|---|---|---|
| Plain-English requests | "Thursday is quiet" (an offer), "post about our new lamb ribs", "how did we do last week?", "change Friday hours to 11pm", "add lamb chops, £14", "Ali can't do Friday". The GM works out what's meant and passes it to the right specialist. | Live |
| Approve / Edit / Skip | Buttons on every draft, or type 1, 2 or 3. Edit takes plain-English changes and redrafts. Skip offers three one-tap reasons, and the AI learns the restaurant's tone from edits and skip reasons. | Live |
| Photos | A dish photo becomes a captioned Google post to approve. Unusable photos get a reason (too dark, blurry, a customer's face). | Live |
| Facts about the restaurant | "We close at 11 on Fridays now" becomes a confirm card, then updates settings (and Google, after Approve). | Live |
| Commands | HELP, STATUS, PAUSE / RESUME (stop all sending), UNDO (reverses the last change), APPROVE ALL, TEAM, ROTA, LABOUR TARGET 28%, EXPORT CUSTOMERS, SPREADSHEETS, CAMPAIGN RESULTS, MONTHLY REPORT. | Live |
| Staff numbers | The owner can register staff phones ("ADD STAFF +447…") that can only send till reports and sales files, nothing else. | Live |
| Language and quiet hours | The owner's language and quiet hours are respected for alerts. | Live |

---

## 5. Reviews and reputation (Google)

| Feature | What it does | Status |
|---|---|---|
| Review watch | Checks Google for new reviews every hour. 4 to 5 stars: a reply drafted for the morning brief. 1 to 3 stars: an instant alert with a careful reply. | Live (with Google connected) |
| Reply writing | Replies in the restaurant's chosen voice and sign-off, using its recovery offers and facts (hours, halal statement). Never invents facts or prices. | Live |
| Sensitive reviews | Food poisoning, allergies, named staff, suspected fake reviews and similar come to the owner as a question first: reply publicly, handle privately, or both. | Live |
| Posting replies | Approved replies go to Google. UNDO deletes a posted reply. | Live (Maison Noor kept on dry run) |
| Pasted reviews | A review pasted into WhatsApp gets a copy-paste reply. | Live |
| What customers said | Weekly themes from reviews, counted by code, in the Monday report. | Live |

---

## 6. Google profile (visibility)

| Feature | What it does | Status |
|---|---|---|
| Google posts | Two drafted posts a week (Monday and Thursday), plus posts from photos. Tuesday's brief asks for one dish photo for Thursday, high-profit dishes first. | Live |
| Hours and menu updates | A change to hours or the menu becomes an update showing Google now and after, always needing Approve. | Live, limited (the menu isn't sent to Google) |
| Bank holiday question | Four weeks before a UK bank holiday: "Are your hours changing?" with Same / Closed / Different, which sets special hours on Google. | Live |
| Profile health | Scores the Google profile and suggests fixes for empty fields during the business review. | Live |
| Performance | Views, calls, direction requests and website clicks in the reports. | Live (with Google connected) |
| Google sign-in for owners | Owners can connect Google themselves instead of adding us as a Manager. | Built, switched off (Google hasn't verified the app yet) |

---

## 7. Customers and email marketing

| Feature | What it does | Status |
|---|---|---|
| QR sign-up | Customers scan a table card, fill in a branded form (unticked consent box, CAPTCHA, privacy notice) and confirm their email. Consent saved with time and wording. | Live |
| Welcome reward | After confirming, a welcome email with the owner's reward. "Redeem now" at the till turns the screen green with a live clock, lasts 10 minutes, then shows "Already used". The owner is told on WhatsApp. | Live |
| Email campaigns | The owner asks ("Thursday is quiet") or DinerAI suggests one; a branded email with a picture preview arrives to approve. Sent to everyone, birthdays in the next 7 days, or new sign-ups who haven't used their reward. Tracks sends, opens, clicks and redemptions. | Live |
| Birthday emails | A weekly birthday batch with the owner's birthday offer. | Live |
| Quiet-day offers | When the forecast shows a day 3 to 7 days ahead noticeably quieter, a "Draft an offer" button in the brief. | Live |
| Event-led ideas | At most one campaign idea a morning for something 3 to 7 days ahead (Eid, Ramadan, a big match, half term). | Live |
| "How was your visit?" | About 3 hours after a reward or offer is used: a feedback email with the Google review link for everyone (never only happy customers) and a private form; 1 to 3 star feedback reaches the owner at once. At most one per customer per 30 days. | Live |
| Customer rules | Double opt-in, at most one campaign per customer in 7 days, Unsubscribe and "Delete my data" in every email, emails sent as the restaurant from our verified domain with replies going to the restaurant. | Live |
| Customer list | Customers page with search, birthdays and a CSV export (logged). | Live |
| WhatsApp to customers | Offers by WhatsApp instead of email. | Not yet (blocked until Meta approval, by design) |

---

## 8. Sales data

| Feature | What it does | Status |
|---|---|---|
| Till report photo | The owner or a staff phone sends a photo of the end-of-day Z-report. AI reads it; code checks the figures add up and saves it, or asks. | Live |
| Typed takings | "We took £2,340, 180 orders" is saved after a YES. | Live |
| Till exports | CSV or Excel exports from any till, on WhatsApp or the Sales page. The first file of a new layout is checked once; after that it imports straight away, item by item and hour by hour where the file allows. | Live |
| Daily takings sheet | Our spreadsheet of 365 days, read by plain code. | Live |
| Weather | Daily weather for each restaurant, with a 12-month history, used to explain sales. | Live (see the weather licence in the workplan) |
| Direct till connections | Live feeds from Square, Epos Now, Lightspeed and Toast instead of exports. Square tested end to end in its sandbox. | Built, switched off (needs partner approvals and keys) |

---

## 9. Forecasts and the local calendar

| Feature | What it does | Status |
|---|---|---|
| Daily forecast | Likely orders and takings with a range, and the top reasons ("West Ham at home, +17%"). From a statistical model (no AI writes any number), or from the restaurant's own recent history when the model hasn't passed its checks. Held back if its past accuracy isn't good enough. | Live |
| Week ahead | Each day's likely takings and orders, busy and quiet days, on the home page and in the Monday report. Needs 8 weeks of sales. | Live |
| Local calendar | Bank holidays, Ramadan, Eid and chand raat (with uncertain moon-sighting dates), Diwali, Mother's Day, paydays, school holidays (3 councils so far), football (Premier League, Champions League, England tournaments), big events within 5 km, TfL strikes and closures, prayer times. | Live, limited (some sources need commercial permission; see the workplan) |
| Forecast questions | "How busy will Saturday be?" and "why is Friday quiet?" are answered with code's numbers only. | Live |

---

## 10. Team and rota

| Feature | What it does | Status |
|---|---|---|
| Team | Staff with role, pay, maximum hours and usual availability, edited on the Team page or by message ("add Ali, kitchen, £13, weekdays", "Sara's going up to 13 quid", "Bilal's left"). Minimal personal data. | Live |
| Weekly rota | Every Thursday at 10am, next week's rota built from opening hours, the forecast and the rules, picking the cheapest available person who fits. Labour cost and % of forecast sales per day and week, open shifts and warnings (over 48 hours, under 11 hours' rest). | Live |
| Rota changes | Plain-English edits ("Ali can't do Friday", "swap Sara and Bilal on Sunday") rebuild it. Approve publishes a read-only rota page and a PDF to forward to staff, without pay or costs. | Live |
| Labour target | Labour % against the owner's target in the brief and reports. | Live |

---

## 11. Menu and profit

| Feature | What it does | Status |
|---|---|---|
| Menu | Sections, dishes and prices with history, edited in settings or by message; renames keep each dish's history. | Live |
| Allergens | UK allergen names, confirmed dish by dish by the owner. Unconfirmed allergens are never shown or used for customers. | Live |
| Menu engineering | With dish costs and item sales: profit per dish and four groups (winners, crowd-pleasers, hidden gems, rethink), in the Monday report. | Live |
| Profit floor | No offer may leave a costed dish below the owner's minimum profit, checked when drafted and again at send time. | Live |

---

## 12. The owner web app (app.dinerai.co.uk)

Login is by an email link (no passwords). Bottom tabs on a phone, a sidebar on a laptop.

| Page | What's on it | Status |
|---|---|---|
| Home | Today's summary; Waiting for you with Approve / Edit / Skip; this week against last (sales, rating, customers, offers used); the next 7 days; reviews; customers; latest campaign; a "finish setting up" checklist. | Live |
| Approvals | Everything waiting, and recent decisions. Approve and Skip work on the web with the same safety checks as WhatsApp. | Live |
| Sales | Takings for the week or 4 weeks, day by day against the forecast, busiest hours, best and slowest dishes, next week; uploads and history underneath. | Live |
| Customers | The email list, search, birthdays, QR cards, export. | Live |
| Reviews | All Google reviews with filters (low, unanswered). | Live |
| Team | Next week's rota cost against target, the rota grid, the team list and rules. | Live |
| Activity | A plain-English timeline of every draft, decision, send and change, with filters and the last change (Undo on WhatsApp). | Live |
| Settings | Restaurant details, menu and allergens, tone and profile, offers and caps, brand look and email previews, spreadsheets, Google connection, billing, data and privacy. | Live |
| Report pages | The Monday and monthly reports, links valid for 30 days. | Live |

---

## 13. Safety and trust (what protects owners and customers)

- **Nothing sends without approval** (the builder can allow Auto for low-risk tasks only;
  campaigns, offers, hours, menu and profile changes can never be Auto).
- **Four checks on every draft:** brand and tone, facts (AI checker), compliance, money
  and risk (plain code). Consent and unsubscribe links are checked again at send time.
- **Money rules:** discount cap, minimum profit per dish, every £ amount must be a real
  menu price or offer value.
- **Sending window** (default 9am to 9pm), no duplicate sends, PAUSE / RESUME, one
  campaign per customer per 7 days.
- **Audit log and UNDO:** every action recorded with who and when; UNDO reverses the
  owner's last change where possible.
- **Privacy:** restaurants can never see each other's data (tested on every change); the
  AI never receives customer lists or contact details; customers confirm before any
  marketing; one-tap unsubscribe and data deletion; exports logged; staff data minimal.
- **Security:** only the registered owner's WhatsApp number is answered; fake and
  duplicate messages are rejected; web pages need a login; CAPTCHA and rate limits on
  public forms.
- **Reliability:** work runs on a queue, one job per restaurant, so one failing
  restaurant never delays another. Failures retry, and only the builder is alerted,
  never the owner. Over 1,890 automated tests run before every deploy.

---

## 14. Accounts and data

| Feature | What it does | Status |
|---|---|---|
| Closing an account | Request, confirm, 24-hour cooling-off, then a full export emailed to the owner, Google and Stripe disconnected, and everything deleted except one anonymous line. Started from the admin console. | Live (builder-run) |
| Customer data rights | Customers can unsubscribe or delete their data from any email. | Live |

---

## 15. Behind the scenes (builder tools)

- **Admin console** (/onboarding/admin): test onboardings, the demo phone, Pilot Zero
  controls (Google dry run, the day simulator, notes), business reviews, closing accounts,
  Google invitations.
- **Builder alerts** by email and WhatsApp for failed or late jobs, never sent to owners.
- **Outside data** page (/feeds): every feed's status, school dates, mosque timetables.
- **Cost tracking:** AI cost per restaurant per month, per agent and per onboarding.
- **Switches:** email redirect, test tools, Google mode and an agents kill switch.
- **Demo restaurants and dummy data** on the test database only (scripts refuse the live one).
- **Statistical forecast service:** a separate Python worker that runs nightly.
