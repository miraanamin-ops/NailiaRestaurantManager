// What customers say (step 6): Haiku tags each review (checked: known themes,
// dishes only when the review names them), code counts the tags, Sonnet's
// summary is checked against them (numbers, quotes, dishes), the tags are saved
// and reused (a second run and the Monday report make no new AI call), and
// fewer than 10 reviews skips the section.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { countThemes, summaryProblems, tagProblems, type ReviewTag } from "@/lib/review/themes-rules";

const saved = JSON.parse(readFileSync(new URL("../agents/tests/tagger/01-mixed-batch.json", import.meta.url), "utf8")) as {
  reviews: { id: string; rating: number; text: string }[];
  good: ReviewTag[];
  bad: { why: string; replace: ReviewTag }[];
};

describe("the tagger's answer", () => {
  test("the saved case: good passes; a dish the review doesn't name, a missing or extra review, are refused", () => {
    expect(tagProblems(saved.reviews, saved.good)).toEqual([]);
    for (const b of saved.bad) {
      const out = saved.good.map((t) => (t.review_id === b.replace.review_id ? b.replace : t));
      expect(tagProblems(saved.reviews, out).length, b.why).toBeGreaterThan(0);
    }
    expect(tagProblems(saved.reviews, saved.good.slice(1)).join(" ")).toMatch(/r1 wasn't tagged/);
    expect(tagProblems(saved.reviews, [...saved.good, { review_id: "zz", sentiment: "positive", themes: [] }]).join(" ")).toMatch(/isn't in this batch/);
  });
});

describe("the counts (code)", () => {
  const reviews = [
    { id: "a", rating: 5, text: "The lamb chops were perfect. Lovely staff." },
    { id: "b", rating: 5, text: "Best lamb chops in east London." },
    { id: "c", rating: 2, text: "We waited an hour. So slow on a Friday." },
    { id: "d", rating: 3, text: "Food was nice but slow service." },
  ];
  const tags: ReviewTag[] = [
    { review_id: "a", sentiment: "positive", themes: [{ theme: "dish", sentiment: "positive", dish: "lamb chops" }, { theme: "service", sentiment: "positive" }] },
    { review_id: "b", sentiment: "positive", themes: [{ theme: "dish", sentiment: "positive", dish: "Lamb chops" }, { theme: "dish", sentiment: "positive", dish: "lamb chops" }] },
    { review_id: "c", sentiment: "negative", themes: [{ theme: "speed", sentiment: "negative" }] },
    { review_id: "d", sentiment: "mixed", themes: [{ theme: "food", sentiment: "positive" }, { theme: "speed", sentiment: "negative" }] },
  ];
  test("one count per review per label, most first, with a short example in the customer's words", () => {
    const c = countThemes(tags, reviews);
    expect(c.praises.map((x) => [x.label, x.count])).toEqual([["Lamb chops", 2], ["Friendly service", 1], ["The food", 1]]);
    expect(c.complaints.map((x) => [x.label, x.count])).toEqual([["Waiting times", 2]]);
    expect(c.complaints[0].example).toBe("We waited an hour.");
  });

  test("the summary's check: counts only, customers' own words only, no dish the reviews don't mention", () => {
    const c = countThemes(tags, reviews);
    expect(summaryProblems('Guests love the lamb chops (2 reviews). Waiting times come up in 2 reviews: "We waited an hour".', c, reviews.map((r) => r.text), ["Lamb Chops", "Mixed Grill"])).toEqual([]);
    expect(summaryProblems("Waiting times come up in 5 reviews.", c, reviews.map((r) => r.text), []).join(" ")).toMatch(/5/);
    expect(summaryProblems('One guest said "the worst night ever".', c, reviews.map((r) => r.text), []).join(" ")).toMatch(/own words/);
    expect(summaryProblems("People love the mixed grill.", c, reviews.map((r) => r.text), ["Mixed Grill"]).join(" ")).toMatch(/Mixed Grill/);
  });
});

const R = "baba0000-0000-4000-8000-000000000058";
const RV = "baba0000-0000-4000-8000-00000000a058";
let db: ReturnType<typeof memoryDb>;
const calls: string[] = [];
let taggerAnswer: (batch: { id: string; text: string }[]) => unknown;

function reviews(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `rv-${i}`,
    restaurant_id: R,
    rating: i % 4 === 0 ? 2 : 5,
    text: i % 4 === 0 ? "Waited ages for the food, too slow." : "The lamb chops were great and the staff friendly.",
    review_date: new Date(Date.UTC(2026, 9, 30 - i)).toISOString(),
  }));
}

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  taggerAnswer = (batch) => ({
    tags: batch.map((r) =>
      r.text.startsWith("Waited")
        ? { review_id: r.id, sentiment: "negative", themes: [{ theme: "speed", sentiment: "negative", dish: null }] }
        : { review_id: r.id, sentiment: "positive", themes: [{ theme: "dish", sentiment: "positive", dish: "lamb chops" }, { theme: "service", sentiment: "positive", dish: null }] },
    ),
  });
  db = memoryDb({ restaurants: [{ id: R, name: "Ember & Spice", menu: [{ category: "Grills", items: [{ name: "Lamb Chops" }] }] }], reviews: reviews(12), review_tags: [], time_saved_log: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/agents/run", () => ({
    callAgent: async (call: { agent: string; content: { text: string }[]; validate: (o: unknown) => string[] }) => {
      calls.push(call.agent);
      const data = JSON.parse(call.content[0].text.slice(call.content[0].text.indexOf("{")));
      const out = call.agent === "tagger" ? taggerAnswer(data.reviews) : { summary: "Guests love the lamb chops (9 reviews).", action: "Look at how long food takes on busy nights." };
      const problems = call.validate(out);
      if (problems.length) throw new Error(problems.join("; "));
      return { output: out };
    },
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/agents/run"]) vi.doUnmock(m);
});
const ctx = () => ({ review: { id: RV } as never, restaurant: db.tables.restaurants[0] as never, now: new Date(), connected: true, round: 0 });

describe("the themes part", () => {
  test("tags saved with the Haiku model; counts from code; a summary checked against them", async () => {
    const { themesPart } = await import("@/lib/review/parts/themes");
    const out = await themesPart(ctx());
    expect(calls).toEqual(["tagger", "business-review"]);
    expect(db.tables.review_tags).toHaveLength(12);
    expect(db.tables.review_tags[0].model).toBe("claude-haiku-5-5");
    expect(out).toMatchObject({ reviewCount: 12, praises: ["Friendly service", "Lamb chops"], complaint: { label: "Waiting times", count: 3 }, summary: "Guests love the lamb chops (9 reviews).", action: expect.any(String) });
    expect(db.tables.time_saved_log).toHaveLength(1);
  });

  test("a second run uses the saved tags: no new tagging", async () => {
    const { themesPart } = await import("@/lib/review/parts/themes");
    await themesPart(ctx());
    calls.length = 0;
    await themesPart(ctx());
    expect(calls).toEqual(["business-review"]);
  });

  test("fewer than 10 reviews: skipped, no AI", async () => {
    db.tables.reviews = reviews(4);
    const { themesPart } = await import("@/lib/review/parts/themes");
    expect(await themesPart(ctx())).toEqual({ reviewCount: 4, praises: [], complaint: null, skipped: "few_reviews" });
    expect(calls).toEqual([]);
  });

  test("a tagger that invents a dish fails the part (retried; then its section drops out)", async () => {
    taggerAnswer = (batch) => ({ tags: batch.map((r) => ({ review_id: r.id, sentiment: "positive", themes: [{ theme: "dish", sentiment: "positive", dish: "mixed grill" }] })) });
    const { themesPart } = await import("@/lib/review/parts/themes");
    await expect(themesPart(ctx())).rejects.toThrow(/isn't in the review's words/);
    expect(db.tables.review_tags).toHaveLength(0);
  });

  test("the Monday report reads the same tags", async () => {
    const { themesPart } = await import("@/lib/review/parts/themes");
    await themesPart(ctx());
    const { tagThemesFor } = await import("@/lib/review/tag-themes");
    const week = db.tables.reviews.slice(0, 4) as never[];
    expect(await tagThemesFor(R, week)).toEqual([
      { label: "Friendly service", count: 3, tone: "praised" },
      { label: "Lamb chops", count: 3, tone: "praised" },
      { label: "Waiting times", count: 1, tone: "complaint" },
    ]);
  });
});
