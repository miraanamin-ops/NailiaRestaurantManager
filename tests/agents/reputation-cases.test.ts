// Reputation agent tests, offline (every push): the saved cases are well formed,
// the plain-code reply rules catch what they must, and (once recorded) every
// recorded answer passes its case. The live run is tests/agents-live/reputation.eval.ts.
import { describe, expect, test } from "vitest";
import { reputationProblems, type ReputationReplyOutput } from "@/lib/agents/reputation-rules";
import { judgeReputation, loadReputationCases, sentenceCount } from "./support/reputation-cases";

const cases = loadReputationCases();

test("Reputation has 10 to 20 saved cases, covering every review type that needs the owner", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  expect(cases.length).toBeLessThanOrEqual(20);
  const names = cases.map((c) => c.file).join(" ");
  for (const kind of ["allerg", "poisoning", "halal", "fake", "staff", "stars-only-five", "stars-only-one", "spanish", "injection"]) expect(names).toContain(kind);
});

describe.each(cases)("reputation case $file", ({ case: c }) => {
  test("is well formed", () => {
    expect(c.review.id && c.review.author_name).toBeTruthy();
    expect(c.expect.sources_must_include).toContain(`review:${c.review.id}`);
    if (c.expect.needs_owner_input) expect(c.expect.checker).toBeUndefined();
    else expect(c.expect.checker?.length).toBeGreaterThan(0);
  });
});

describe("the reply rules", () => {
  const c = cases.find((x) => x.file.startsWith("03-"))!.case;
  const reply = (text: string, extra: Partial<ReputationReplyOutput> = {}): ReputationReplyOutput => ({
    type: "review_reply",
    channel: "google",
    review_id: c.review.id,
    rating: c.review.rating,
    content: { text },
    alert: true,
    needs_owner_input: null,
    sources_used: [`review:${c.review.id}`, "profile:sign_off_name", "profile:complaint_contact"],
    ...extra,
  });
  const good = "Thanks for letting us know, Nusrat, and sorry about the wait. Please email hello@emberandspice.co.uk so we can put it right.\n\nThe Ember & Spice Grill family";

  test("a careful 2-star reply passes", () => {
    expect(judgeReputation(c, reply(good), { verdict: "pass" })).toEqual([]);
  });
  test("a low-star reply must set alert", () => {
    expect(judgeReputation(c, reply(good, { alert: false }), { verdict: "pass" }).join()).toMatch(/alert must be true/);
  });
  test("a question for the owner can't come with a reply", () => {
    expect(reputationProblems(reply(good, { needs_owner_input: "Reply publicly?" }), { review: c.review, profile: c.profile.fields }).join()).toMatch(/content must be empty/);
  });
  test("forbidden content is caught", () => {
    const p = (text: string) => reputationProblems(reply(text), { review: c.review, profile: c.profile.fields }).join(" | ");
    const dash = String.fromCharCode(0x2014);
    expect(p(good.replace("Thanks", `Thanks ${dash} truly`))).toMatch(/em-dash/);
    expect(p(good.replace("Please", "Visit www.example.com. Please"))).toMatch(/links/);
    expect(p(good.replace("Please", "We'll give you a refund. Please"))).toMatch(/refunds/);
    expect(p(good.replace("Please", "Update your review and your next meal is on us. Please"))).toMatch(/exchange for a review/);
    expect(p(good.replace("Please", "Our naan is allergen-free. Please"))).toMatch(/allergen-free/);
    expect(p(good.replace("Thanks", "Thanks 🔥🔥"))).toMatch(/2 emojis/);
    expect(p(good.replace("The Ember & Spice Grill family", "Bilal"))).toMatch(/sign-off name/);
  });
  test("a gesture must come from the approved recovery offers", () => {
    const text = good.replace("Please", "Your next dessert is on us. Please");
    expect(reputationProblems(reply(text), { review: c.review, profile: c.profile.fields }).join()).toMatch(/profile:recovery_offers/);
    expect(reputationProblems(reply(text, { sources_used: [...reply(good).sources_used, "profile:recovery_offers"] }), { review: c.review, profile: c.profile.fields })).toEqual([]);
    expect(reputationProblems(reply("Feel free to email hello@emberandspice.co.uk.\n\nThe Ember & Spice Grill family"), { review: c.review, profile: c.profile.fields })).toEqual([]);
  });
  test("sentences are counted without the sign-off", () => {
    expect(sentenceCount(good, "The Ember & Spice Grill family")).toBe(2);
  });
});

describe.each(cases.filter((c) => c.case.recorded))("recorded answer: $file", ({ case: c }) => {
  test("passes its case", () => {
    expect(judgeReputation(c, c.recorded!.output, c.recorded!.checker)).toEqual([]);
  });
});
