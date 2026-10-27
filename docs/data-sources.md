# Data sources and their terms

Every outside source behind the forecast and the owner's calendar lines, with
the page where its terms live. ⚠️ marks the ones whose terms **may not allow
commercial use** (or don't say): they're fine while we test, but each needs a
decision before the first paying restaurant. The decisions, costs and options
are in [before-launch.md](before-launch.md) (checked 19 October 2026). Re-read
each terms page before relying on this list: terms change.

## Event and calendar feeds (lib/feeds, step 28)

| Feed | Source | What it gives us | Terms | Commercial use |
|---|---|---|---|---|
| Calendar: bank holidays | gov.uk (`https://www.gov.uk/bank-holidays.json`) | England and Wales bank holidays | Open Government Licence v3: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ | ✅ Allowed, with the OGL credit line |
| Calendar: Ramadan and Eid | Umm al-Qura calendar built into Node (no outside service) | First fast, Eid al-Fitr, Eid al-Adha | None (our own calculation) | ✅ No terms apply |
| Calendar: announced Eid dates | East London Mosque public pages (`src/lib/feeds/data/religious.json`), entered by the builder | The dates the restaurant's community actually observes | Site terms: https://www.eastlondonmosque.org.uk (facts copied by hand, not the site's content) | ✅ Facts only; low risk |
| Calendar: Diwali, Mother's Day, Christmas, paydays, clock changes | Our own code | Cultural and money dates | None | ✅ No terms apply |
| School dates | Council term-date pages, typed in or confirmed by the builder (`src/lib/feeds/data/school_terms.json`): Redbridge https://www.redbridge.gov.uk/schools/school-holidays-and-term-dates, Newham https://www.newham.gov.uk/downloads/file/7864/school-term-and-holiday-dates-2025-2026, Waltham Forest https://www.walthamforest.gov.uk/schools-education-and-learning/school-term-and-closure-dates/school-holiday-and-term-dates | School holidays and half terms per council | Each council's own site terms (published public information) | ✅ Facts only; low risk. Only these 3 councils are covered: any other council's restaurants are told so |
| Prayer times | `adhan` library (MIT): https://github.com/batoulapps/adhan-js/blob/master/LICENSE, or a mosque timetable entered by the builder | Iftar time in Ramadan, Friday prayers | MIT licence | ✅ Allowed |
| Football (fixtures ahead) | football-data.org API | Premier League, Champions League, World Cup and Euro fixtures with kick-offs | https://www.football-data.org/terms (free tier) | ⚠️ **Not stated.** Ask them in writing (see before-launch.md) |
| Football (past fixtures, backfill) | football-data.co.uk CSV files | Past Premier League fixtures for learning the effect of home games | https://www.football-data.co.uk/disclaimer.php | ⚠️ **Not checked** (the site refused our check). Ask, or replace with a paid history |
| Local events | Ticketmaster Discovery API | Concerts and shows within 5 km, next 60 days | https://developer.ticketmaster.com/support/terms-of-use/ | ⚠️ **Unclear.** The terms forbid using the API "to derive revenues ... for direct commercial or monetary gain"; written permission needed |
| Disruption | TfL Unified API | Strikes and whole-line closures (London) | https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service | ✅ Allowed once registered, with "Powered by TfL Open Data" where shown |
| Weather (forecast, actuals, archived forecasts) | Open-Meteo APIs (forecast, archive, previous runs) | Hourly and daily weather for the forecast model | https://open-meteo.com/en/terms | ⚠️ **No** on the free API: "non-commercial purposes" only. A paid plan (API Professional) or another provider is needed |
| Location: council and nation | postcodes.io (`https://api.postcodes.io/postcodes/<postcode>`) | The restaurant's council (for school holidays), nation and position | https://postcodes.io/about (MIT software; ONS and OS open data: https://www.ons.gov.uk/methodology/geography/licences) | ✅ Allowed |
| Location: town fallback | Open-Meteo geocoding | A position when the address has no postcode | https://open-meteo.com/en/terms | ⚠️ Same as Open-Meteo weather |

## Other outside data the forecast or the report reads

| Source | What it gives us | Terms | Commercial use |
|---|---|---|---|
| Google Business Profile APIs (live connector, step 33) | Reviews, replies, calls, direction requests, profile views for the Monday report | https://developers.google.com/my-business/content/policies | ✅ Allowed for the business's own profile, with the owner's consent |
| Google Places API (onboarding) | Finding the restaurant, its hours and rating | https://cloud.google.com/maps-platform/terms | ✅ Allowed (paid per call), with limits on keeping the data |

## How each source reaches the owner

- **Brief and report calendar lines** (`lib/calendar-lines`): bank holidays,
  Ramadan, Eid and school holidays always show; any other event (football,
  local events, disruption) only on a day the forecast moves by 10% or more.
- **Forecast effects** (`lib/forecast/baseline.ts`): an event kind counts only
  after it has been seen on at least 2 past days with a typical change of 8% or
  more in the restaurant's own sales.
- Credit lines to show once these sources appear on a public page: "Weather data
  by Open-Meteo.com (CC BY 4.0)", "Powered by TfL Open Data", "Contains public
  sector information licensed under the Open Government Licence v3.0".
