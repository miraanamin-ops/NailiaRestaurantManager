// Bank holidays ahead (Visibility's Monday check) and the owner's answers to
// "Are your hours changing?". Plain code, plus the Monday step with a stand-in database.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { holidayQuestion, holidaysAhead, longDate, usualHoursOn } from "@/lib/bank-holiday-rules";
import { parseHoursAnswer } from "@/lib/bot/parse";
import { memoryDb } from "./support/memory-db";

const HOLIDAYS = [
  { date: "2026-08-31", title: "Summer bank holiday" },
  { date: "2026-12-25", title: "Christmas Day" },
  { date: "2026-12-28", title: "Boxing Day" },
  { date: "2027-01-01", title: "New Year’s Day" },
];

describe("which bank holidays to ask about", () => {
  test("only the next 4 weeks, soonest first", () => {
    expect(holidaysAhead(HOLIDAYS, {}, "2026-12-07").map((h) => [h.title, h.days])).toEqual([
      ["Christmas Day", 18],
      ["Boxing Day", 21],
      ["New Year’s Day", 25],
    ]);
    expect(holidaysAhead(HOLIDAYS, {}, "2026-10-12")).toEqual([]);
  });

  test("not once special hours are set for that day (usual hours count as an answer)", () => {
    const set = { "2026-12-25": { label: "Christmas Day", hours: "Closed" }, "2026-12-28": { label: "Boxing Day", hours: "usual" } };
    expect(holidaysAhead(HOLIDAYS, set, "2026-12-07").map((h) => h.title)).toEqual(["New Year’s Day"]);
  });

  test("the question, with the usual hours for that weekday", () => {
    const [christmas] = holidaysAhead(HOLIDAYS, {}, "2026-12-04");
    expect(longDate("2026-12-25")).toBe("Friday 25 December");
    expect(holidayQuestion(christmas, usualHoursOn({ Friday: "14:00 – 00:00" }, christmas.date))).toBe(
      "📅 *Christmas Day* (Friday 25 December) is in 3 weeks. Are your hours changing?\n\nYour usual Friday hours: 14:00 – 00:00",
    );
  });
});

describe("answers to the hours question", () => {
  const id = "0b1c2d3e-0000-4000-8000-000000000001";
  test("buttons carry the question's id", () => {
    expect(parseHoursAnswer(`same:${id}`, "", false)).toEqual({ choice: "same", draftId: id });
    expect(parseHoursAnswer(`closed:${id}`, "", false)).toEqual({ choice: "closed", draftId: id });
    expect(parseHoursAnswer(`different:${id}`, "", false)).toEqual({ choice: "different", draftId: id });
  });
  test("typed answers for a brief item, and plain words only while the question is on screen", () => {
    expect(parseHoursAnswer(undefined, "CLOSED 2", false)).toEqual({ choice: "closed", briefNumber: 2 });
    expect(parseHoursAnswer(undefined, "same hours", false)).toBeNull();
    expect(parseHoursAnswer(undefined, "same hours", true)).toEqual({ choice: "same" });
    expect(parseHoursAnswer(undefined, "3", true)).toEqual({ choice: "different" });
  });
});

describe("the Monday check", () => {
  const A = "aaaaaaaa-0000-0000-0000-000000000001";
  let db: ReturnType<typeof memoryDb>;
  beforeEach(() => {
    vi.resetModules();
    db = memoryDb({
      restaurants: [{ id: A, name: "Ember & Spice Grill", agent_modes: {}, opening_hours: { Friday: "14:00 – 00:00" }, special_hours: {}, photo_library: [] }],
      cached_data: [{ key: "uk_bank_holidays", data: HOLIDAYS, fetched_at: new Date().toISOString() }],
      agent_jobs: [], shadow_drafts: [], drafts: [], audit_log: [], profile_versions: [],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.stubGlobal("fetch", async () => {
      throw new Error("gov.uk shouldn't be called while the saved list is fresh");
    });
  });
  afterEach(() => {
    vi.doUnmock("@/lib/supabase");
    vi.unstubAllGlobals();
  });

  test("shadow: each holiday is recorded once as the question it would ask, and the content brief is queued", async () => {
    const { mondayVisibility } = await import("@/lib/agents/visibility");
    const r = () => ({ ...db.tables.restaurants[0] }) as never;
    expect(await mondayVisibility(r(), "2026-12-07")).toEqual(["Christmas Day", "Boxing Day", "New Year’s Day"]);
    expect(db.tables.shadow_drafts.map((s) => s.question)).toHaveLength(3);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ agent: "visibility", source: "bank_holiday", outcome: "question" });
    expect(db.tables.drafts).toHaveLength(0); // nobody is asked in shadow mode
    expect(db.tables.agent_jobs.filter((j) => j.kind === "visibility_shadow" && j.status === "queued")).toHaveLength(1);
    // The next Monday: already asked, so nothing new.
    expect(await mondayVisibility(r(), "2026-12-14")).toEqual([]);
  });

  test("with Visibility off, nothing", async () => {
    db.tables.restaurants[0].agent_modes = { visibility: "off" };
    const { mondayVisibility } = await import("@/lib/agents/visibility");
    expect(await mondayVisibility({ ...db.tables.restaurants[0] } as never, "2026-12-07")).toEqual([]);
    expect(db.tables.agent_jobs).toHaveLength(0);
  });
});

describe("the owner answers", () => {
  const A = "aaaaaaaa-0000-0000-0000-000000000001";
  const Q = "0b1c2d3e-0000-4000-8000-000000000001";
  let db: ReturnType<typeof memoryDb>;
  let said: string[];
  beforeEach(() => {
    vi.resetModules();
    said = [];
    db = memoryDb({
      restaurants: [{ id: A, name: "Ember & Spice Grill", agent_modes: { visibility: "off" }, active: true, opening_hours: { Friday: "14:00 – 00:00" }, special_hours: {}, profile_version: 1 }],
      drafts: [
        {
          id: Q, restaurant_id: A, kind: "hours_question", status: "pending", waiting_for: null, content: "Christmas Day is in 3 weeks. Are your hours changing?",
          audience: "Christmas Day hours", agent_input: { date: "2026-12-25", title: "Christmas Day" }, created_at: "2026-12-07T09:00:00Z", version: 1,
        },
      ],
      agent_jobs: [], audit_log: [], profile_versions: [],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  });
  afterEach(() => vi.doUnmock("@/lib/supabase"));

  const turn = () => ({
    ctx: { restaurant: { ...db.tables.restaurants[0] }, restaurantId: A, now: new Date("2026-12-07T10:00:00Z") },
    send: async (text: string) => void said.push(text),
  });

  test("Closed: saved as special hours (UNDO-able, a profile version), and the question is answered", async () => {
    const { answerHoursQuestion } = await import("@/lib/bot/hours-questions");
    await answerHoursQuestion(turn() as never, { choice: "closed", draftId: Q }, null);
    expect(db.tables.restaurants[0].special_hours).toEqual({ "2026-12-25": { label: "Christmas Day", hours: "Closed" } });
    expect(db.tables.drafts[0]).toMatchObject({ status: "answered", waiting_for: null });
    expect(db.tables.audit_log.find((e) => e.action === "setting")).toMatchObject({ actor: "owner", data: { field: "special_hours" } });
    expect(db.tables.profile_versions[0]).toMatchObject({ field: "special_hours" });
    expect(said[0]).toContain("Saved: Christmas Day, closed");
  });

  test("Different hours: asks for them, then saves what's typed", async () => {
    const { answerHoursQuestion, hoursForQuestion } = await import("@/lib/bot/hours-questions");
    await answerHoursQuestion(turn() as never, { choice: "different", draftId: Q }, null);
    expect(db.tables.drafts[0]).toMatchObject({ status: "pending", waiting_for: "edit_instructions" });
    expect(said[0]).toContain("What will your hours be on Christmas Day?");
    await hoursForQuestion(turn() as never, { ...db.tables.drafts[0] } as never, "nonsense");
    expect(said[1]).toContain("couldn't read those hours");
    await hoursForQuestion(turn() as never, { ...db.tables.drafts[0] } as never, "12-6pm");
    expect(db.tables.restaurants[0].special_hours).toEqual({ "2026-12-25": { label: "Christmas Day", hours: "12:00 – 18:00" } });
  });

  test("Same hours: noted, so it's never asked again", async () => {
    const { answerHoursQuestion } = await import("@/lib/bot/hours-questions");
    await answerHoursQuestion(turn() as never, { choice: "same", draftId: Q }, null);
    expect(db.tables.restaurants[0].special_hours).toEqual({ "2026-12-25": { label: "Christmas Day", hours: "usual" } });
    expect(holidaysAhead(HOLIDAYS, db.tables.restaurants[0].special_hours as never, "2026-12-07").map((h) => h.title)).not.toContain("Christmas Day");
  });

  test("a question is never sent by the gate", async () => {
    const { moneyAndRisk } = await import("@/lib/checks/money");
    const r = { paused: false, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00" };
    const d = { kind: "hours_question", version: 1, status: "approved", approved_at: "2026-12-07T10:00:00Z", sent_at: null, scheduled_for: null, content: "Are your hours changing?" };
    expect(moneyAndRisk(d as never, r, new Date("2026-12-07T12:00:00Z"), "approve")).toMatchObject({ outcome: "blocked", reason: "not_approved" });
  });
});
