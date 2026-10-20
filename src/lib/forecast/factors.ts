// The forecast's reasons in the owner's words: a fixed dictionary from the factor
// names the model writes to forecast_drivers (analytics/service/.../forecast_daily:
// forecast.contributions and design.FACTORS). Code translates; Claude never does.
// No imports, so it's unit-tested: tests/forecast.test.ts fails if the model can
// emit a factor that has no entry here.

// null = never given as a reason (weekday and season are what "normal" means).
// ahead = the wording for a day other than today, where it differs.
export type FactorWords = { today: string; ahead?: string } | null;

export const FACTOR_WORDS: Record<string, FactorWords> = {
  // Always in the model, never a reason on their own.
  level: null,
  trend: null,
  weekday: null,
  season: null,
  // The calendar.
  bank_holiday: { today: "the bank holiday" },
  bh_eve: { today: "the bank holiday tomorrow", ahead: "the day before a bank holiday" },
  bh_after: { today: "yesterday's bank holiday", ahead: "the day after a bank holiday" },
  xmas_eve: { today: "Christmas Eve" },
  xmas_week: { today: "the Christmas week" },
  nye: { today: "New Year's Eve" },
  new_year: { today: "New Year's Day" },
  mothers_day: { today: "Mother's Day" },
  valentines: { today: "Valentine's Day" },
  school_holiday: { today: "school holidays" },
  inset_day: { today: "a school inset day" },
  payday_window: { today: "payday" },
  clock_change_fwd: { today: "the clocks going forward" },
  clock_change_back: { today: "the clocks going back" },
  diwali: { today: "Diwali" },
  // Religious dates.
  ramadan_1_10: { today: "Ramadan" },
  ramadan_11_20: { today: "Ramadan" },
  ramadan_last10: { today: "the last 10 nights of Ramadan" },
  eid_fitr_d1: { today: "Eid" },
  eid_fitr_d2: { today: "Eid (day 2)" },
  eid_fitr_d3: { today: "Eid (day 3)" },
  eid_adha_d1: { today: "Eid al-Adha" },
  eid_adha_d2: { today: "Eid al-Adha (day 2)" },
  eid_adha_d3: { today: "Eid al-Adha (day 3)" },
  chand_raat: { today: "chand raat" },
  // Weather.
  temp_warm: { today: "warm weather" },
  temp_cold: { today: "cold weather" },
  temp_hot: { today: "hot weather" },
  rain_lunch: { today: "rain at lunchtime", ahead: "rain at lunchtime" },
  rain_dinner: { today: "rain this evening", ahead: "rain in the evening" },
  sunshine: { today: "sunshine" },
  // Sport, events and disruption.
  football_during: { today: "a football match" },
  football_after: { today: "a football match ending" },
  cricket_during: { today: "a cricket match" },
  cricket_after: { today: "a cricket match ending" },
  venue: { today: "an event nearby" },
  disruption: { today: "travel disruption" },
  // Worked out per restaurant.
  prices: { today: "your price changes" },
  hours_open: { today: "your opening hours" },
};

// A deal the model counted ("deal:<campaign id>"): the app names it from the campaign.
export const DEAL_PREFIX = "deal:";

export function isDealFactor(factor: string) {
  return factor.startsWith(DEAL_PREFIX);
}

export function dealCampaignId(factor: string) {
  return isDealFactor(factor) ? factor.slice(DEAL_PREFIX.length) : null;
}

// The owner's words for a factor; null = never a reason; undefined = unknown (left out).
export function factorWords(factor: string, input: { today: boolean; multiplier: number; dealName?: string | null }): string | null | undefined {
  if (isDealFactor(factor)) return input.dealName ? `your "${input.dealName}" offer` : "your offer email";
  if (factor === "hours_open") return input.multiplier < 1 ? "shorter opening hours" : "longer opening hours";
  const w = FACTOR_WORDS[factor];
  if (w === undefined) return undefined;
  if (w === null) return null;
  return input.today ? w.today : (w.ahead ?? w.today);
}
