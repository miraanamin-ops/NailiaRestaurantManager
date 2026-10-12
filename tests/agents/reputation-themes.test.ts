// Reputation's weekly themes for the Monday report: the rules on its answer,
// counts worked out by code, made once per week and saved, and a failure never
// stopping the report.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countThemes, themesProblems, type WeeklyThemesOutput } from "@/lib/agents/reputation-themes";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const answer = (extra: Partial<WeeklyThemesOutput["content"]> = {}, sources = ["review:r1", "review:r2", "review:r3"]): WeeklyThemesOutput => ({
  type: "weekly_themes",
  channel: "owner",
  content: { praise: [{ label: "Lamb chops", review_ids: ["r1", "r2", "r2"] }], complaints: [{ label: "Slow bill", review_ids: ["r3"] }], ...extra },
  needs_owner_input: null,
  sources_used: sources,
});

describe("the themes rules", () => {
  const ids = new Set(["r1", "r2", "r3"]);
  test("a good answer passes; counts are worked out by code (duplicates once)", () => {
    expect(themesProblems(answer(), ids)).toEqual([]);
    expect(countThemes(answer().content.praise)).toEqual([{ label: "Lamb chops", count: 2, review_ids: ["r1", "r2"] }]);
  });
  test("reviews that don't exist, missing sources, too many themes and em-dashes are refused", () => {
    expect(themesProblems(answer({ complaints: [{ label: "Cold naan", review_ids: ["r9"] }] }), ids).join()).toMatch(/isn't in this week's reviews/);
    expect(themesProblems(answer({}, ["review:r1"]), ids).join()).toMatch(/sources_used must include review:r2/);
    const four = [1, 2, 3, 4].map((i) => ({ label: `Theme ${i}`, review_ids: ["r1"] }));
    expect(themesProblems(answer({ praise: four }), ids).join()).toMatch(/at most 3 praise/);
    expect(themesProblems(answer({ praise: [{ label: `Lamb ${String.fromCharCode(0x2014)} chops`, review_ids: ["r1"] }] }), ids).join()).toMatch(/em-dash/);
  });
});

describe("making the week's themes", () => {
  let db: ReturnType<typeof memoryDb>;
  let calls = 0;
  let reply: unknown;
  beforeEach(() => {
    vi.resetModules();
    calls = 0;
    reply = answer();
    db = memoryDb({ review_themes: [], audit_log: [], restaurants: [{ id: A, profile_version: 1 }] });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
    vi.doMock("@/lib/claude", () => ({
      MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
      MAX_TOKENS: 100,
      fallbackFor: () => ({}),
      claude: () => ({ beta: { messages: { parse: async () => (calls++, { stop_reason: "end_turn", parsed_output: reply }) } } }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude"]) vi.doUnmock(m);
  });
  const reviews = [
    { id: "r1", rating: 5, text: "Best lamb chops" },
    { id: "r2", rating: 5, text: "Lamb chops again" },
    { id: "r3", rating: 4, text: "Slow to get the bill" },
  ];

  test("made once and saved; the next build of the same week reuses it", async () => {
    const { weeklyThemesFor } = await import("@/lib/agents/reputation");
    const first = await weeklyThemesFor(A, "2026-10-05", "the week starting 2026-10-05", reviews);
    expect(first).toEqual({ praise: [{ label: "Lamb chops", count: 2, review_ids: ["r1", "r2"] }], complaints: [{ label: "Slow bill", count: 1, review_ids: ["r3"] }] });
    expect(db.tables.review_themes).toHaveLength(1);
    expect(db.tables.audit_log[0]).toMatchObject({ actor: "reputation", action: "agent_drafted" });
    await weeklyThemesFor(A, "2026-10-05", "the week starting 2026-10-05", reviews);
    expect(calls).toBe(1);
  });

  test("an answer that's wrong twice leaves the report without themes (and alerts the builder)", async () => {
    reply = answer({ praise: [{ label: "Lamb", review_ids: ["nope"] }] });
    const { weeklyThemesFor } = await import("@/lib/agents/reputation");
    expect(await weeklyThemesFor(A, "2026-10-05", "w", reviews)).toBeNull();
    expect(db.tables.review_themes).toEqual([]);
  });
});

test("the report page shows the section with its counts", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Section } = await import("@/app/report/[token]/sections");
  const html = renderToStaticMarkup(
    Section({
      section: { id: "themes", praise: [{ label: "Lamb chops", count: 2 }], complaints: [{ label: "Slow bill", count: 1 }], reviewCount: 3 },
      ctx: { data: {} as never, brand: "#c2410c" },
    })!,
  );
  expect(html).toContain("What customers said");
  expect(html).toContain("Lamb chops · 2 reviews");
  expect(html).toContain("Slow bill · 1 review");
  expect(html).toContain("From 3 reviews last week.");
});
