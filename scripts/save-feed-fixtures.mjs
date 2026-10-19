// Saves real answers from the feeds that need an API key as test fixtures
// (tests/fixtures/feeds/), replacing the ones shaped from the providers' docs.
// Run once the keys are in .env.local:
//   node --env-file=.env.local scripts/save-feed-fixtures.mjs
// Each file keeps a few items only, and no key is ever written into it.
import { writeFileSync } from "node:fs";

const dir = new URL("../tests/fixtures/feeds/", import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const fd = process.env.FOOTBALL_DATA_API_KEY;
if (fd) {
  for (const code of ["PL", "CL"]) {
    const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${today}&dateTo=${plus(60)}`, { headers: { "X-Auth-Token": fd } });
    if (!res.ok) throw new Error(`football-data.org ${code}: ${res.status}`);
    const json = await res.json();
    json.matches = json.matches.slice(0, 8);
    writeFileSync(new URL(`football-data_${code}_matches.json`, dir), JSON.stringify(json, null, 1));
    console.log(`Saved football-data_${code}_matches.json (${json.matches.length} matches)`);
    await new Promise((r) => setTimeout(r, 7000)); // 10 calls a minute
  }
} else console.log("No FOOTBALL_DATA_API_KEY: football fixtures not saved.");

const tm = process.env.TICKETMASTER_API_KEY;
if (tm) {
  const q = new URLSearchParams({ apikey: tm, latlong: "51.5193,-0.0573", radius: "5", unit: "km", size: "6", sort: "date,asc", countryCode: "GB",
    startDateTime: `${today}T00:00:00Z`, endDateTime: `${plus(60)}T00:00:00Z` });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
  if (!res.ok) throw new Error(`Ticketmaster: ${res.status}`);
  const json = await res.json();
  delete json._links;
  writeFileSync(new URL("ticketmaster_events.json", dir), JSON.stringify(json, null, 1).replaceAll(tm, "KEY"));
  console.log(`Saved ticketmaster_events.json (${json._embedded?.events?.length ?? 0} events)`);
} else console.log("No TICKETMASTER_API_KEY: events not saved.");
console.log("Then run npm test: the parser tests may need their expected values updated to the real answers.");
