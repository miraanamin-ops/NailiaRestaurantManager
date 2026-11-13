// Adds council school term dates (the same rows /feeds/terms saves), then the
// calendar feed turns them into school holidays. Safe to re-run: existing terms
// (same council and start day) are left as they are.
// Usage: node --env-file=.env.local scripts/add-school-terms.mjs [--live]
// Dates checked by hand on the councils' own pages on 13 Nov 2026.
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "add-school-terms.mjs");

const COUNCILS = [
  {
    code: "E09000026",
    name: "Redbridge",
    url: "https://www.redbridge.gov.uk/schools/school-holidays-and-term-dates",
    terms: [
      ["2027-01-04", "2027-03-25", "2027-02-15", "2027-02-19", "2026-27"],
      ["2027-04-12", "2027-07-22", "2027-05-31", "2027-06-04", "2026-27"],
      ["2027-09-02", "2027-12-17", "2027-10-25", "2027-10-29", "2027-28"],
      ["2028-01-04", "2028-04-07", "2028-02-14", "2028-02-18", "2027-28"],
      ["2028-04-24", "2028-07-21", "2028-05-29", "2028-06-02", "2027-28"],
    ],
  },
  {
    code: "E09000030",
    name: "Tower Hamlets",
    url: "https://www.towerhamlets.gov.uk/lgnl/education_and_learning/schools/term_and_holiday_dates.aspx",
    terms: [
      ["2026-09-01", "2026-12-18", "2026-10-26", "2026-10-30", "2026-27"],
      ["2027-01-04", "2027-03-25", "2027-02-15", "2027-02-19", "2026-27"],
      ["2027-04-12", "2027-07-23", "2027-05-31", "2027-06-04", "2026-27"],
      ["2027-09-01", "2027-12-17", "2027-10-25", "2027-10-29", "2027-28"],
      ["2028-01-04", "2028-03-31", "2028-02-14", "2028-02-18", "2027-28"],
      ["2028-04-18", "2028-07-26", "2028-05-29", "2028-06-02", "2027-28"],
    ],
  },
];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const now = new Date().toISOString();
for (const c of COUNCILS) {
  const up = await supabase.from("councils").upsert({ code: c.code, name: c.name, term_dates_url: c.url }, { onConflict: "code", ignoreDuplicates: true });
  if (up.error) throw new Error(up.error.message);
  const rows = c.terms.map(([start, end, hs, he, year]) => ({
    council_code: c.code,
    kind: "term",
    start_day: start,
    end_day: end,
    half_term_start: hs,
    half_term_end: he,
    academic_year: year,
    source: "builder",
    confirmed_by: "builder (council website, checked 2026-11-13)",
    confirmed_at: now,
  }));
  const ins = await supabase.from("school_dates").upsert(rows, { onConflict: "council_code,kind,start_day", ignoreDuplicates: true }).select("id");
  if (ins.error) throw new Error(ins.error.message);
  console.log(`${c.name}: ${ins.data.length} new term(s) of ${rows.length}`);
}
console.log("Done. Now run the calendar feed so the holidays are made: scripts/run-feed.mjs run calendar");
