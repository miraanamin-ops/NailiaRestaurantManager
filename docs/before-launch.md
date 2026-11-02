# Before the first paying restaurant

What has to be settled about the outside data (weather, calendar, sport, events,
disruption, locations) before DinerAI charges anyone. Today everything runs on free
tiers, which is fine while we test with dummy data, but several of those tiers forbid
or don't clearly allow commercial use. Checked on 19 October 2026 from each
provider's own pages; prices change, so check again before signing up.

## The sources, one by one

| Source | What we use it for | Commercial use on the free tier | Data retention terms | Plan we'd need with paying restaurants | Cost |
|---|---|---|---|---|---|
| **Open-Meteo** | Weather: hourly and daily actuals (archive), forecasts as issued (days 0 to 7), archived forecasts for back-tests (Previous Runs) | **No.** "You may only use the free API services for non-commercial purposes." A subscription or ads count as commercial. | None stated. Data is CC BY 4.0: storing it is fine, credit is required. | **API Professional**: the cheaper Standard plan has no historical (archive) or previous-runs data, and the backfill needs both. | Not listed publicly (only in their customer portal). Get the figure from dashboard.open-meteo.com before deciding. |
| **football-data.org** | Premier League and Champions League fixtures with kick-offs; World Cup and Euro finals for England | Not stated on the pricing or coverage pages. Ask daniel@football-data.org. | Not stated. | Free (€0, 10 calls a minute) covers what we use, if commercial use is allowed. England's friendlies, qualifiers and Nations League aren't on any page we checked: they stay as builder entry. | €0 if allowed; paid plans run from €12 to €199 a month (VAT may apply). |
| **football-data.co.uk** | Past Premier League fixtures with kick-offs (backfill only, as the synthetic data generator does) | Not checked: the site refused our check (too many requests). Free CSV files, widely used. | Not checked. | Ask, or replace with football-data.org's paid history (ML Pack Light, €29 a month, 10 seasons). | €0 or €29 a month. |
| **Ticketmaster Discovery** | Events within 5 km of each restaurant (next 60 days) | **Unclear.** The terms forbid using the API to "derive revenues ... for direct commercial or monetary gain". | Content may be kept only "for reasonable periods in order to provide the service". It must be removed within 24 hours if the owner asks. Calls not made for a user may be rate limited or blocked. | Ask Ticketmaster's developer team in writing whether forecasting for paying restaurants is allowed. If not: Skiddle's API, or builder entry for the big venues. | €0 (5,000 calls a day). |
| **TfL Unified API** | Strikes and whole-line closures | **Yes.** Free, royalty-free, commercial use allowed once registered. | Not limited. The licence gives no rights after it ends. | The free key (500 calls a minute). Register at api-portal.tfl.gov.uk with accurate details. | €0. Credit "Powered by TfL Open Data" wherever we show TfL data. Don't use TfL branding or suggest TfL endorses us. |
| **postcodes.io** | A restaurant's position, council (for school holidays) and nation, from its postcode | Free, open source (MIT). No terms against commercial use. The data comes from ONS and Ordnance Survey open data. | None stated. | Fine at our volume (one call per restaurant, cached 90 days). No service guarantee: if it matters, run our own copy (it's open source), or use Ideal Postcodes (paid). | €0. |
| **gov.uk bank holidays** | England and Wales bank holidays | Yes: Open Government Licence v3. | None. | No plan needed. | €0. Credit "Contains public sector information licensed under the Open Government Licence v3.0." |

What needs no outside service, and so no decision:

- **Ramadan and Eid:** from the Umm al-Qura calendar built into Node.
- **Diwali, Mother's Day, Christmas, paydays and clock changes:** calculated in our own code.
- **Prayer times:** the open-source `adhan` library (MIT).
- **School term dates:** typed in or confirmed by the builder from councils' public pages.
- **The East London Mosque's announced dates:** facts from their public pages, entered by the builder.

## What to decide or do before the first paying customer

1. **Weather (the one cost we can't avoid).**
   - **Options:** pay for Open-Meteo API Professional; or move to the Met Office Weather DataHub (free tier with a small daily limit; check it allows commercial use and has archived forecasts); or keep Open-Meteo only for development.
   - **Why it's easy to switch:** the provider sits in one file (`src/lib/feeds/weather-data.ts`).
   - **What changes if we switch:** the forecast model's back-test was calibrated on ECMWF forecasts, so a new provider means a fresh back-test before showing owners forecasts.
2. **Ticketmaster: get written permission.** If it isn't allowed:
   - switch off the events feed on /feeds;
   - add the big venues' events by hand, or use Skiddle;
   - delete the event names and links Ticketmaster gave us (keep only date, size and distance).
3. **football-data.org: ask about commercial use** of the free tier. If the answer is no, the €12 plan is the likely minimum. Ask the same of football-data.co.uk, or drop the Premier League history from the backfill.
4. **Credits on any page an owner sees** that shows this data. The weekly report and any forecast page will need:
   - "Weather data by Open-Meteo.com (CC BY 4.0)";
   - "Powered by TfL Open Data";
   - the Open Government Licence line for bank holidays.
5. **A retention rule for Ticketmaster content.**
   - **Now:** events are kept as calendar rows with their name and link, for the history the forecast trains on.
   - **Proposed:** after 90 days, keep only date, size and distance; clear the name and link.
   - **Takedowns:** a request to remove an event must be acted on within 24 hours. That's a builder task (delete the row on /feeds), not automated yet.
6. **Privacy notice.** The holding site's privacy notice should say which outside services we call and that no customer data is sent to them (only each restaurant's location).
7. **Archived forecasts only reach back to early 2024** (Open-Meteo Previous Runs, ECMWF). In our check, temperature and rain started about March 2024 and sunshine about June 2024. A restaurant whose sales history starts earlier is trained without "as issued" weather for those older days. The backfill records the real start on /feeds.
8. **National Rail strikes have no clean free feed.** The builder adds them on /feeds. If that turns out to be too much work, look at the Rail Data Marketplace (free registration, its own terms).
9. **Cricket and England's other matches are builder entry.** Before launch, decide who keeps them up to date. That's about 2 to 4 England, India, Pakistan and Bangladesh internationals a month in a busy season.
10. **School dates need a yearly round.**
    - **Why:** councils publish each academic year once, and the builder is alerted when any active restaurant's council has fewer than 4 months of dates.
    - **What's seeded:** Redbridge, Newham and Waltham Forest, through December 2026 only.
    - **What's missing:** inset days are set by each school, so only shared ones can be entered.

## Already safe

- No feed ever writes to an owner or a customer.
- A feed with no key is skipped and reported, never a crash.
- Every feed problem goes to the builder only.
- API keys live in Vercel's environment variables. They never go into the database, the cache or a log line (addresses are logged with the key blanked out).
- Total cost today: £0. The only paid call is Claude reading a council's term dates page, a few pence each time, and only when the builder presses the button.

## Legal documents owners accept at sign-up

- **Data processing agreement** (`/dpa`, `src/app/site/dpa/page.tsx`, version in `DPA_VERSION`): a plain-English **draft** written with onboarding with Dina (28 Oct 2026). Have someone qualified check it (with the terms and the privacy notice) before the first real restaurant signs. Changing it means a new `DPA_VERSION`; each restaurant keeps the version it accepted (`restaurants.dpa_version`).
