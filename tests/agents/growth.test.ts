// Growth agent tests, offline (every push): the plain-code rules catch what they
// must, the saved cases are well formed, and every recorded answer passes its case.
// The live run is tests/agents-live/growth.eval.ts.
import { describe, expect, test } from "vitest";
import { campaignFieldsFrom, growthOutputProblems, growthProblems, NO_BASELINE, type GrowthDraftOutput } from "@/lib/agents/growth-rules";
import { caseContext, judgeGrowth, loadGrowthCases, type GrowthResult } from "./support/growth-cases";

const cases = loadGrowthCases();
const thursday = cases.find((c) => c.file.startsWith("01"))!.case;
const ctx = caseContext(thursday);

const draft = (o: Partial<GrowthDraftOutput> = {}): GrowthDraftOutput => ({
  type: "campaign",
  channel: "email",
  name: "Quiet Thursday mango treat",
  segment: "everyone",
  audience_size: 18,
  send_at: "2026-10-14T10:00",
  template: "offer",
  photo_id: null,
  content: { subject: "A Thursday treat at Ember & Spice", headline: "Free Mango Lassi this Thursday", body: "Come in this Thursday from 5pm and get a free Mango Lassi with any Mixed Grill Platter. Dine-in only, one per table.", cta: "Book a table" },
  offer: {
    type: "free_item",
    description: "Free Mango Lassi with any Mixed Grill Platter",
    items: ["Mango Lassi", "Mixed Grill Platter"],
    applies_to: "Mixed Grill Platter",
    discount_percent: null,
    discount_value_gbp: 3.5,
    valid_from: "2026-10-15T17:00",
    valid_to: "2026-10-15T21:00",
    conditions: "Dine-in only, one per table",
  },
  idea: null,
  expected_outcome: NO_BASELINE,
  needs_owner_input: null,
  sources_used: ["profile:menu", "profile:discount_cap", "segment:everyone"],
  ...o,
});
const p = (d: GrowthDraftOutput, c = ctx) => growthProblems(d, c).join(" | ");

describe("campaign rules", () => {
  test("a right Thursday campaign passes", () => expect(p(draft())).toBe(""));
  test("email only; a real segment with its real size", () => {
    expect(p(draft({ channel: "whatsapp" }))).toMatch(/email only for now/);
    expect(p(draft({ audience_size: 214 }))).toMatch(/audience_size for everyone is 18/);
    expect(p(draft({ segment: "unredeemed_signups", audience_size: 5 }))).toBe("");
  });
  test("the cap is worked out from the offer's fields; a dish not on the menu fails", () => {
    expect(p(draft(), { ...ctx, profile: { ...ctx.profile, discount_cap: 15 } })).toMatch(/19% off, above the 15% cap: set needs_owner_input/);
    expect(p(draft({ offer: { ...draft().offer!, items: ["Lobster Tail"], description: "Free lobster tail" } }))).toMatch(/"Lobster Tail" isn't on the menu/);
    expect(p(draft({ offer: { ...draft().offer!, type: "two_for_one" } }))).toMatch(/isn't one of the owner's approved kinds of offer/);
  });
  test("fake urgency and targeting by religion fail", () => {
    expect(p(draft({ content: { ...draft().content, body: "Only 5 tables left this Thursday, so book now for a free Mango Lassi." } }))).toMatch(/no fake urgency/);
    expect(p(draft({ content: { ...draft().content, headline: "Ramadan Mubarak to our Muslim customers" } }))).toMatch(/never word or target by religion/);
    expect(p(draft({ content: { ...draft().content, headline: "Ramadan Mubarak from all of us" } }))).toBe("");
  });
  test("copy fits the template; dates, conditions and the send time are right", () => {
    expect(p(draft({ content: { ...draft().content, subject: "A very long subject line that goes on far past fifty characters" } }))).toMatch(/subject under 50 characters/);
    expect(p(draft({ offer: { ...draft().offer!, conditions: "" } }))).toMatch(/clear conditions/);
    expect(p(draft({ offer: { ...draft().offer!, valid_from: "2026-10-01" } }))).toMatch(/can't start in the past/);
    expect(p(draft({ send_at: "2026-10-14T22:30" }))).toMatch(/inside the sending hours/);
    expect(p(draft({ send_at: "2026-10-16T10:00" }))).toMatch(/on or before the offer's first day/);
  });
  test("expected outcome: only past results, quoted exactly", () => {
    expect(p(draft({ expected_outcome: "Should bring in about 40 people." }))).toMatch(/quotes past results only/);
    const withHistory = draft({ expected_outcome: "Last similar offer: 3 redemptions from 26 sent", sources_used: [...draft().sources_used, "history:cmp_1"] });
    expect(p(withHistory)).toBe("");
    expect(p({ ...withHistory, expected_outcome: "Last similar offer: 30 redemptions from 26 sent" })).toMatch(/says 30, which isn't in the cited campaign's results/);
  });
  test("a question comes on its own, with no email in it", () => {
    const q = draft({ content: { subject: "", headline: "", body: "", cta: "" }, offer: null, needs_owner_input: "40% is over your 20% cap. Shall I do 20%?" });
    expect(p(q)).toBe("");
    expect(growthOutputProblems({ drafts: [q, draft()] }, ctx).join()).toMatch(/comes on its own/);
  });
});

describe("birthdays and special ideas", () => {
  const bctx = caseContext(cases.find((c) => c.file.startsWith("06"))!.case);
  const birthday = draft({ type: "birthday_batch", template: "birthday", segment: "birthdays_7d", audience_size: 3, offer: { ...draft().offer!, type: "free_item", description: "Free Kunafa with any main in your birthday week", items: ["Kunafa"], applies_to: "Mixed Grill Platter", discount_value_gbp: 3.5, valid_from: "2026-10-12", valid_to: "2026-10-18" }, send_at: "2026-10-12T10:00" });
  test("the birthday batch goes to birthdays_7d with the profile's birthday offer", () => {
    expect(growthProblems(birthday, bctx)).toEqual([]);
    expect(growthProblems({ ...birthday, segment: "everyone", audience_size: 18 }, bctx).join()).toMatch(/goes to birthdays_7d/);
    expect(growthProblems(birthday, { ...bctx, profile: { ...bctx.profile, birthday_offer: null } }).join()).toMatch(/no birthday offer: set needs_owner_input/);
  });
  test("a special idea uses menu dishes and never carries a price", () => {
    const idea = draft({
      type: "special_idea", channel: "owner", segment: null, audience_size: null, send_at: null, template: null, offer: null, expected_outcome: "",
      content: { subject: "", headline: "Lamb kofta wrap", body: "An easy lunch from what the grill already has.", cta: "" },
      idea: { name: "Lamb kofta wrap", uses_dishes: ["Seekh Kebab", "Chicken Tikka Wrap"], ingredients: ["seekh kebab mince", "wrap", "mint yoghurt"], steps: ["Shape and grill", "Warm the wrap", "Layer and roll"], why_now: "Mild weather for lunches outside." },
    });
    const sctx = { ...ctx, task: "special_ideas" as const };
    expect(growthProblems(idea, sctx)).toEqual([]);
    expect(growthProblems({ ...idea, idea: { ...idea.idea!, why_now: "Sell it at £7.95." } }, sctx).join()).toMatch(/never suggest a price/);
    expect(growthProblems({ ...idea, idea: { ...idea.idea!, uses_dishes: ["Truffle Risotto"] } }, sctx).join()).toMatch(/isn't on the menu/);
  });
});

test("the email template gets today's campaign fields from Growth's draft", () => {
  expect(campaignFieldsFrom(draft())).toEqual({
    name: "Quiet Thursday mango treat",
    subject: "A Thursday treat at Ember & Spice",
    body: "Free Mango Lassi this Thursday\n\nCome in this Thursday from 5pm and get a free Mango Lassi with any Mixed Grill Platter. Dine-in only, one per table.\n\nBook a table",
    offer: "Free Mango Lassi with any Mixed Grill Platter. Dine-in only, one per table",
    valid_from: "2026-10-15",
    valid_until: "2026-10-15",
    segment: "everyone",
  });
});

test("Growth has 10 to 20 saved cases, covering every situation phase 3c lists", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  expect(cases.length).toBeLessThanOrEqual(20);
  const names = cases.map((c) => c.file).join(" ");
  for (const kind of ["thursday-quiet", "over-the-cap", "ramadan", "eid-buffet", "date-uncertain", "birthday-batch", "unredeemed", "not-on-menu", "fake-urgency", "special-idea", "outcome-history", "outcome-first"]) expect(names).toContain(kind);
});

describe.each(cases)("growth case $file", ({ case: c }) => {
  test("is well formed", () => {
    expect(c.name && c.source && c.today && c.today_words).toBeTruthy();
    expect(c.task === "owner_request" ? Boolean(c.request) : true).toBe(true);
    expect(c.profile.fields).toHaveProperty("menu");
    expect(c.profile.fields).toHaveProperty("discount_cap");
  });
});

describe.each(cases.filter((c) => c.case.recorded))("recorded answer: $file", ({ case: c }) => {
  test("passes its case", () => {
    const results: GrowthResult[] = c.recorded!.outcomes.map((o) => ({ outcome: o.outcome, by: o.question_by, question: o.question, output: o.output, checker: o.checker }));
    expect(judgeGrowth(c, results)).toEqual([]);
  });
});
