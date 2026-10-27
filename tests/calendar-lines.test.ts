// The local calendar for owners (docs/pilot-sprint.md, "Finance forecast and
// calendar"): which events get a line (only ones that move the forecast, plus
// Ramadan, Eid, bank holidays and school holidays), the wording, the one
// campaign idea a morning and its one-tap answer, and school holidays from the
// restaurant's council (said plainly when we don't cover it).
import { describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { dummyWeekAhead, type DayAhead } from "@/lib/forecast/week-ahead-rules";
import { alwaysKind, calendarLines, coverageNote, lineText, movePct, pickSuggestion, suggestionFor, whenText, type CalendarLine } from "@/lib/calendar-lines/rules";
import type { UpcomingEvent } from "@/lib/upcoming-events-rules";

const R = "7e57c0de-0000-4000-8000-000000000000";
const MONDAY = "2026-10-26";
const ev = (date: string, title: string, type: UpcomingEvent["type"], source: UpcomingEvent["source"] = "feed"): UpcomingEvent => ({ date, title, type, expected_effect: "neutral", source });

// The dummy week with Saturday 20% up and Tuesday 15% down on a normal day.
function days(): Map<string, DayAhead> {
  const w = dummyWeekAhead(R, MONDAY);
  const m = new Map(w.days.map((d) => [d.date, { ...d, normal_orders: 100, orders: 100 }]));
  m.get("2026-10-31")!.orders = 120;
  m.get("2026-10-27")!.orders = 85;
  return m;
}

describe("which events get a line", () => {
  test("always: Ramadan, Eid, bank holidays, school holidays; never the owner's own events", () => {
    expect(alwaysKind({ type: "religious", title: "Ramadan" })).toBe("ramadan");
    expect(alwaysKind({ type: "religious", title: "Eid al-Adha" })).toBe("eid");
    expect(alwaysKind({ type: "religious", title: "Diwali" })).toBeNull();
    expect(alwaysKind({ type: "bank_holiday", title: "Christmas Day" })).toBe("bank_holiday");
    expect(alwaysKind({ type: "school_holiday", title: "Half term (Newham)" })).toBe("school_holiday");
    expect(alwaysKind({ type: "sport", title: "West Ham v Fulham" })).toBeNull();
  });

  test("other events only on a day the forecast moves 10% or more; restaurant events never", () => {
    const lines = calendarLines(
      [
        ev("2026-10-31", "West Ham v Fulham", "sport"),
        ev("2026-10-29", "Arsenal v Spurs", "sport"), // a normal Thursday: left out
        ev("2026-10-27", "Concert at the O2", "local_event"),
        ev("2026-10-28", "Diwali", "religious"), // not moving it, not an always kind
        ev("2026-10-30", "Closed: refit", "restaurant", "owner"),
        ev("2026-10-26", "Half term (Newham)", "school_holiday", "builder"),
      ],
      days(),
      true,
    );
    expect(lines.map((l) => [l.title, l.pct])).toEqual([
      ["Half term (Newham)", null],
      ["Concert at the O2", -15],
      ["West Ham v Fulham", 20],
    ]);
  });

  test("a forecast that isn't shown (held back, too little history) moves nothing: only the always kinds", () => {
    const lines = calendarLines([ev("2026-10-31", "West Ham v Fulham", "sport"), ev("2026-10-28", "Eid al-Adha", "religious")], days(), false);
    expect(lines.map((l) => l.title)).toEqual(["Eid al-Adha"]);
    expect(movePct(days().get("2026-10-31"), false)).toBeNull();
  });

  test("a date over several days is one line", () => {
    const half = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((d) => ev(d, "Half term (Newham)", "school_holiday", "builder"));
    const [line] = calendarLines(half, days(), true);
    expect(line).toMatchObject({ first: "2026-10-26", last: "2026-10-30", pct: -15 }); // its biggest move (Tuesday)
  });
});

describe("the wording", () => {
  const line = (over: Partial<CalendarLine>): CalendarLine => ({ key: "k", title: "West Ham v Fulham", type: "sport", first: "2026-10-31", last: "2026-10-31", always: null, pct: 18, dummy: false, ...over });

  test("Sat: West Ham at home, expect busier", () => {
    expect(lineText(line({}), MONDAY, "2026-11-01")).toBe("Sat: West Ham v Fulham, expect busier (+18%)");
    expect(lineText(line({ pct: -12 }), MONDAY, "2026-11-01")).toBe("Sat: West Ham v Fulham, expect quieter (−12%)");
    expect(lineText(line({ type: "bank_holiday", title: "Christmas Day", always: "bank_holiday", pct: null, first: MONDAY, last: MONDAY }), MONDAY, "2026-11-01")).toBe("Today: Christmas Day");
  });

  test("spans: Mon–Fri, From Wed, Until Fri, All week", () => {
    expect(whenText({ first: "2026-10-26", last: "2026-10-30" }, "2026-10-25", "2026-11-01", false)).toBe("Mon–Fri");
    expect(whenText({ first: "2026-10-28", last: "2026-11-01" }, MONDAY, "2026-11-01", false)).toBe("Wed–Sun");
    expect(whenText({ first: "2026-10-26", last: "2026-11-30" }, "2026-10-25", "2026-11-01", false)).toBe("From Mon");
    expect(whenText({ first: MONDAY, last: "2026-10-30" }, MONDAY, "2026-11-01", true)).toBe("Until Fri");
    expect(whenText({ first: MONDAY, last: "2026-11-20" }, MONDAY, "2026-11-01", true)).toBe("All week");
  });

  test("school holidays we don't cover are said plainly", () => {
    expect(coverageNote({ status: "covered", council: "Newham" })).toBeNull();
    expect(coverageNote({ status: "not_covered", council: "Tower Hamlets" })).toBe("_School holidays: we don't have Tower Hamlets' term dates yet, so they aren't included here._");
    expect(coverageNote({ status: "not_covered", council: "Camden" })).toMatch(/Camden's term dates/);
    expect(coverageNote({ status: "no_postcode" })).toMatch(/couldn't find your council \(no postcode in your address\)/);
  });
});

describe("campaign ideas", () => {
  const line = (over: Partial<CalendarLine>): CalendarLine => ({ key: "k", title: "West Ham v Fulham", type: "sport", first: "2026-10-31", last: "2026-10-31", always: null, pct: 18, dummy: false, ...over });

  test("3 to 7 days ahead; quieter days, Eid, Ramadan, a busy match, a bank holiday, school holidays", () => {
    expect(suggestionFor(line({}), MONDAY)!.question).toBe("💡 West Ham v Fulham on Saturday should be busier (+18%). Want me to draft a match-day email to regulars?");
    expect(suggestionFor(line({}), "2026-10-29")).toBeNull(); // 2 days: too late
    expect(suggestionFor(line({}), "2026-10-23")).toBeNull(); // 8 days: too early
    expect(suggestionFor(line({ pct: -20 }), MONDAY)!.request).toMatch(/Saturday 2026-10-31 looks quieter than usual .* Draft an email offer/);
    expect(suggestionFor(line({ type: "religious", title: "Eid al-Adha", always: "eid", pct: null }), MONDAY)!.question).toMatch(/Eid al-Adha is on Saturday. Want me to draft an Eid email/);
    expect(suggestionFor(line({ type: "religious", title: "Ramadan", always: "ramadan", pct: null }), MONDAY)!.question).toMatch(/Ramadan starts Saturday. Want me to draft an iftar offer email/);
    expect(suggestionFor(line({ type: "school_holiday", title: "Half term (Newham)", always: "school_holiday", pct: null }), MONDAY)!.question).toMatch(/family offer/);
    expect(suggestionFor(line({ type: "sport", pct: null }), MONDAY)).toBeNull(); // not moving it, not an always kind
    expect(suggestionFor(line({ dummy: true }), MONDAY)).toBeNull(); // never for dummy events
  });

  test("one a morning, quieter days first, an event offered once only", () => {
    const lines = [line({ key: "a" }), line({ key: "b", pct: -15, first: "2026-10-30", last: "2026-10-30", title: "Rain all day" })];
    expect(pickSuggestion(lines, MONDAY, new Set())!.line.key).toBe("b");
    expect(pickSuggestion(lines, MONDAY, new Set(["b"]))!.line.key).toBe("a");
    expect(pickSuggestion(lines, MONDAY, new Set(["a", "b"]))).toBeNull();
  });
});

describe("in the database", () => {
  const load = async (restaurant: Record<string, unknown>, councils: Record<string, unknown>[] = []) => {
    vi.resetModules();
    const db = memoryDb({ restaurants: [{ id: R, ...restaurant }], councils, calendar_suggestions: [] });
    const located = vi.fn(async () => ({ lat: 51.5, lon: 0, cell: "x", councilCode: "E09000030" }));
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/feeds/location", () => ({ ensureLocated: located }));
    vi.doMock("@/lib/upcoming-events", () => ({
      getUpcomingEvents: async (_id: string, from: string, to: string) =>
        [ev("2026-10-28", "Test bank holiday", "bank_holiday", "gov.uk"), ev("2026-10-31", "West Ham v Fulham", "sport")].filter((e) => e.date >= from && e.date <= to),
    }));
    return { db, located, mod: await import("@/lib/calendar-lines") };
  };

  test("school holidays: the council from the postcode, covered or not", async () => {
    const today = "2026-10-26";
    let t = await load({ address: "1 High St, London E15 1AA", council_code: "E09000025", council_name: "Newham" }, [{ code: "E09000025", name: "Newham", dates_known_until: "2027-07-20" }]);
    expect(await t.mod.schoolCoverage(R, today)).toEqual({ status: "covered", council: "Newham" });
    expect(t.located).not.toHaveBeenCalled();
    t = await load({ address: "1 High St, London E15 1AA", council_code: "E09000025", council_name: "Newham" }, [{ code: "E09000025", name: "Newham", dates_known_until: "2026-07-20" }]);
    expect(await t.mod.schoolCoverage(R, today)).toEqual({ status: "not_covered", council: "Newham" }); // its dates ran out
    t = await load({ address: "12 Test Street, London E1 6AN", council_code: null, council_name: "Tower Hamlets" });
    expect(await t.mod.schoolCoverage(R, today)).toEqual({ status: "not_covered", council: "Tower Hamlets" });
    expect(t.located).toHaveBeenCalledOnce();
    t = await load({ address: "12 Test Street, London", council_code: null });
    expect(await t.mod.schoolCoverage(R, today)).toEqual({ status: "no_postcode" });
  });

  test("the Monday block: the week's lines, the school note, and one idea saved once", async () => {
    const t = await load({ address: "12 Test Street, London E1 6AN", council_code: "E09000030", council_name: "Tower Hamlets" });
    const week = { ...dummyWeekAhead(R, MONDAY), days: [...days().values()] };
    const now = new Date("2026-10-26T09:05:00Z");
    const first = await t.mod.calendarBlock({ id: R }, now, async () => week);
    expect(first.text).toBe(
      ["📅 *This week*", "Wed: Test bank holiday", "Sat: West Ham v Fulham, expect busier (+20%)", "_School holidays: we don't have Tower Hamlets' term dates yet, so they aren't included here._"].join("\n"),
    );
    expect(first.offers).toEqual([{ id: t.db.tables.calendar_suggestions[0].id, question: expect.stringMatching(/West Ham v Fulham on Saturday should be busier/) }]);
    const again = await t.mod.calendarBlock({ id: R }, now, async () => week);
    expect(again.offers).toEqual([]); // the match was offered already; Wednesday is too close for an idea
    expect(t.db.tables.calendar_suggestions).toHaveLength(1);
  });

  test("other mornings: the next 3 days only, no school note", async () => {
    const t = await load({ address: "x", council_code: null });
    const week = { ...dummyWeekAhead(R, MONDAY), days: [...days().values()] };
    const out = await t.mod.calendarBlock({ id: R }, new Date("2026-10-27T09:05:00Z"), async () => week);
    expect(out.text).toBe("📅 *Coming up*\nWed: Test bank holiday");
  });
});

describe("the owner's tap on an idea", () => {
  const load = async () => {
    vi.resetModules();
    const db = memoryDb({
      calendar_suggestions: [{ id: "idea-1", restaurant_id: R, day: "2026-10-31", title: "West Ham v Fulham", question: "q", request: "Draft a match-day email", status: "offered", draft_id: null }],
      forecast_briefs: [],
    });
    const created = vi.fn(async () => ({ id: "draft-9", content: "x" }));
    vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
    vi.doMock("@/lib/agents/growth", () => ({ growthMode: async () => "off", liveGrowthRequest: vi.fn(), queueGrowthShadow: vi.fn() }));
    vi.doMock("@/lib/assistant", () => ({ writeOfferCampaign: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/bot/flows", () => ({ campaignCreateAndSend: created }));
    vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), getLearningContext: vi.fn(async () => "") }));
    const sent: string[] = [];
    const turn = { ctx: { restaurantId: R, now: new Date("2026-10-26T10:00:00Z"), restaurant: { id: R } }, send: async (t: string) => void sent.push(t) };
    return { db, created, sent, turn, answer: (await import("@/lib/forecast/offer")).answerOfferTap };
  };

  test("Draft an offer: the usual campaign flow with the idea's request; asked again, it says it's done", async () => {
    const t = await load();
    expect(await t.answer(t.turn as never, { id: "idea-1", yes: true } as never)).toBe(true);
    expect(t.created).toHaveBeenCalledWith(expect.anything(), {}, "Draft a match-day email", expect.any(Function), expect.stringMatching(/Here's an email for West Ham v Fulham \(Saturday 31 Oct\)/));
    expect(t.db.tables.calendar_suggestions[0]).toMatchObject({ status: "drafted", draft_id: "draft-9" });
    await t.answer(t.turn as never, { id: "idea-1", yes: true } as never);
    expect(t.sent.at(-1)).toMatch(/already drafted/);
    expect(t.created).toHaveBeenCalledOnce();
  });

  test("Not now: marked declined, nothing drafted", async () => {
    const t = await load();
    await t.answer(t.turn as never, { id: "idea-1", yes: false } as never);
    expect(t.db.tables.calendar_suggestions[0].status).toBe("declined");
    expect(t.created).not.toHaveBeenCalled();
    expect(t.sent).toEqual(["OK, no email for that one."]);
  });
});
