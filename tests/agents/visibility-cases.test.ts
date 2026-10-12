// Visibility agent tests, offline (every push): the saved cases are well formed,
// the plain-code rules catch what they must, and (once recorded) every recorded
// answer passes its case. The live run is tests/agents-live/visibility.eval.ts.
import { describe, expect, test } from "vitest";
import { PHOTO_TIPS, visibilityProblems, wordCount, type VisibilityOutput } from "@/lib/agents/visibility-rules";
import { judgeVisibility, loadVisibilityCases } from "./support/visibility-cases";

const cases = loadVisibilityCases();

test("Visibility has 10 to 20 saved cases, covering every situation phase 3a lists", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  expect(cases.length).toBeLessThanOrEqual(20);
  const names = cases.map((c) => c.file).join(" ");
  for (const kind of ["phone-number", "not-on-menu", "not-in-profile", "breaks-halal", "topic-repeated", "photo-with-child", "hours-changed"]) expect(names).toContain(kind);
});

describe.each(cases)("visibility case $file", ({ case: c }) => {
  test("is well formed", () => {
    expect(c.expect.types.length).toBeGreaterThan(0);
    if (c.task === "photo") expect(c.photo).toBeTruthy();
    if (c.task === "profile_changed") expect(c.event?.from && c.event.to).toBeTruthy();
  });
});

const base = (extra: Partial<VisibilityOutput> = {}): VisibilityOutput => ({
  type: "google_post",
  channel: "google",
  content: {
    text: "Our Lamb Chops are marinated in yoghurt and spices, then finished over real charcoal until they're smoky at the edges. Four pieces for £13.95, with warm Garlic Naan and Masala Chips on the side if you're hungry. Bring the family this week and make an evening of it. We'd love to see you.",
    cta: "Book",
    hashtags: [],
  },
  photo_id: null,
  change: null,
  publish_at: null,
  photo_check: null,
  shoots: [],
  needs_owner_input: null,
  sources_used: ["profile:menu"],
  ...extra,
});
const profile = { halal_statement: "All our meat is halal.", words_to_avoid: ["cheap"], emoji_allowed: { posts: 2 } };
const p = (out: VisibilityOutput, task: "google_post" | "photo" | "profile_changed" | "content_brief" = "google_post", event = null as never) =>
  visibilityProblems(out, { task, profile, event }).join(" | ");

describe("the post rules", () => {
  test("a good 40 to 100 word post passes", () => {
    expect(wordCount(base().content.text)).toBeGreaterThanOrEqual(40);
    expect(p(base())).toBe("");
  });
  test("phone numbers, links, hashtags, alcohol for a halal restaurant, and too many emojis are caught", () => {
    const t = base().content.text;
    expect(p(base({ content: { ...base().content, text: `${t} Call 020 7946 0123.` } }))).toMatch(/no phone numbers/);
    expect(p(base({ content: { ...base().content, text: `${t} See www.ember.test.` } }))).toMatch(/no links/);
    expect(p(base({ content: { ...base().content, hashtags: ["#grill"] } }))).toMatch(/no hashtags on Google/);
    expect(p(base({ content: { ...base().content, text: t.replace("Garlic Naan", "a cold beer") } }))).toMatch(/dietary rules \("beer"\)/);
    expect(p(base({ content: { ...base().content, text: `${t} 🔥🔥🔥` } }))).toMatch(/3 emojis/);
  });
  test("too short, too long, or no call to action", () => {
    expect(p(base({ content: { ...base().content, text: "Lamb chops tonight." } }))).toMatch(/40 to 100 words \(this one is 3\)/);
    expect(p(base({ content: { ...base().content, cta: null } }))).toMatch(/one call to action/);
  });
});

describe("photos", () => {
  const unusable = (reason: "too_dark" | "person_or_child" | "ok") =>
    base({ type: "google_photo", content: { text: "", cta: null, hashtags: [] }, sources_used: [], photo_check: { usable: false, reason_code: reason, reason: "Too dark to see the food." } });
  test("an unusable photo needs only its reason; staff get a fixed tip", () => {
    expect(p(unusable("too_dark"), "photo")).toBe("");
    expect(p(unusable("ok"), "photo")).toMatch(/reason_code other than ok/);
    expect(PHOTO_TIPS.too_dark).toMatch(/too dark/);
  });
  test("a photo with a customer's face or a child can never be used", () => {
    expect(p(base({ photo_check: { usable: true, reason_code: "person_or_child", reason: "" } }), "photo")).toMatch(/never usable/);
  });
});

describe("profile changes and the weekly brief", () => {
  test("an hours change shows the field, from and to", () => {
    const event = { field: "hours", from: "Friday 14:00 – 00:00", to: "Friday 12:00 – 23:00" } as never;
    const out = base({ type: "hours_update", change: { field: "hours", from: "Friday 14:00 – 00:00", to: "Friday 12:00 – 23:00" } });
    expect(p(out, "profile_changed", event)).toBe("");
    expect(p(base({ type: "hours_update", change: null }), "profile_changed", event)).toMatch(/shows the field/);
    expect(p(base({ type: "menu_update", change: out.change }), "profile_changed", event)).toMatch(/drafted as hours_update/);
  });
  test("the brief has exactly 3 shoots, each with a caption and at most 5 hashtags", () => {
    const shoot = { what: "Naan from the tandoor", where: "the pass", how: "phone vertical, 10 seconds", who: "anyone on the pass", day: "Tuesday", platform: "Instagram" as const, caption: "Fresh naan, straight from the tandoor.", hashtags: ["#naan", "#halal"] };
    const brief = base({ type: "content_brief", channel: "owner", content: { text: "This week's three shoots.", cta: null, hashtags: [] }, shoots: [shoot, shoot, shoot] });
    expect(p(brief, "content_brief")).toBe("");
    expect(p({ ...brief, shoots: [shoot] }, "content_brief")).toMatch(/exactly 3 shoot briefs/);
    expect(p({ ...brief, shoots: [shoot, shoot, { ...shoot, hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }] }, "content_brief")).toMatch(/6 hashtags/);
    expect(p({ ...brief, shoots: [shoot, shoot, { ...shoot, what: "Espresso martini pairing" }] }, "content_brief")).toMatch(/dietary rules/);
  });
});

describe.each(cases.filter((c) => c.case.recorded))("recorded answer: $file", ({ case: c }) => {
  test("passes its case", () => {
    const r = c.recorded!;
    expect(judgeVisibility(c, { outcome: r.outcome, by: r.question_by, question: r.question, output: r.output, checker: r.checker })).toEqual([]);
  });
});
