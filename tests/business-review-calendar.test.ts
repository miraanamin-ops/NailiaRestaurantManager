// The next 30 days (step 8): dates only from the code list (checked against
// official sources, never AI), audiences only from what the owner says ("all"
// always), Ramadan campaigns say iftar not lunch (Mother's Day 2027), one
// campaign and one post per event, emails held with nobody on the list.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { CALENDAR_EVENTS, campaignRequest, inRamadan, ramadanProblems, relevantEvents } from "@/lib/review/calendar-events";

describe("the dates", () => {
  test("every one is a real date, with its source; only moon-sighted ones are uncertain", () => {
    for (const e of CALENDAR_EVENTS) {
      expect(new Date(`${e.starts_on}T12:00:00Z`).toISOString().slice(0, 10), e.key).toBe(e.starts_on);
      if (e.ends_on) expect(e.ends_on >= e.starts_on, e.key).toBe(true);
      expect(e.source.length, e.key).toBeGreaterThan(5);
      if (e.date_uncertain) expect(e.audience, e.key).toBe("muslim");
    }
    expect(new Set(CALENDAR_EVENTS.map((e) => e.key)).size).toBe(CALENDAR_EVENTS.length);
  });

  test("the list is exactly what was checked (change it only with new sources)", () => {
    expect(CALENDAR_EVENTS.map((e) => `${e.starts_on}${e.ends_on ? `..${e.ends_on}` : ""} ${e.name}${e.date_uncertain ? " (expected)" : ""}`)).toMatchInlineSnapshot(`
      [
        "2026-11-05 Bonfire Night",
        "2026-11-08 Diwali",
        "2026-11-20..2026-12-23 Christmas party season",
        "2026-11-27 Black Friday",
        "2026-12-24 Christmas Eve",
        "2026-12-25 Christmas Day",
        "2026-12-26 Boxing Day",
        "2026-12-21..2027-01-01 School Christmas holidays",
        "2026-12-31 New Year's Eve",
        "2027-01-01 New Year's Day",
        "2027-02-06 Lunar New Year",
        "2027-02-08..2027-03-09 Ramadan (expected)",
        "2027-02-09 Pancake Day",
        "2027-02-14 Valentine's Day",
        "2027-02-15..2027-02-19 February half term",
        "2027-03-07 Mother's Day",
        "2027-03-10 Eid al-Fitr (expected)",
        "2027-03-26 Good Friday",
        "2027-03-27..2027-03-29 Easter weekend",
        "2027-03-29..2027-04-09 School Easter holidays",
        "2027-05-03 Early May bank holiday",
        "2027-05-16 Eid al-Adha (expected)",
        "2027-05-22 FA Cup final",
        "2027-05-31 Spring bank holiday",
        "2027-05-31..2027-06-04 May half term",
        "2027-06-05 Champions League final",
        "2027-06-20 Father's Day",
        "2027-06-24..2027-07-25 Women's World Cup",
        "2027-07-23..2027-09-01 School summer holidays",
        "2027-08-30 Summer bank holiday",
        "2027-10-25..2027-10-29 October half term",
        "2027-10-31 Halloween",
        "2027-11-05 Bonfire Night",
        "2027-11-19..2027-12-23 Christmas party season",
        "2027-11-26 Black Friday",
        "2027-12-24 Christmas Eve",
        "2027-12-25 Christmas Day",
        "2027-12-26 Boxing Day",
        "2027-12-31 New Year's Eve",
      ]
    `);
  });
});

describe("which ones a restaurant plans for", () => {
  test("not asked yet: dates for everyone only; never from the cuisine", () => {
    expect(relevantEvents(CALENDAR_EVENTS, null, "2026-11-03", 30).map((e) => e.name)).toEqual(["Bonfire Night", "Christmas party season", "Black Friday"]);
  });
  test("the owner said Diwali: it's in; a season already running counts", () => {
    expect(relevantEvents(CALENDAR_EVENTS, ["hindu_sikh"], "2026-11-03", 30).map((e) => e.name)).toEqual(["Bonfire Night", "Diwali", "Christmas party season", "Black Friday"]);
    expect(relevantEvents(CALENDAR_EVENTS, [], "2026-12-10", 30).map((e) => e.name)[0]).toBe("Christmas party season");
  });
  test("Mother's Day 2027 falls in Ramadan: iftar, not lunch, for a restaurant that plans for Ramadan", () => {
    const mothers = CALENDAR_EVENTS.find((e) => e.key === "mothers-day-2027")!;
    expect(inRamadan(CALENDAR_EVENTS, mothers.starts_on)).toBe(true);
    expect(campaignRequest(mothers, ["muslim"])).toMatch(/iftar meal after sunset, not lunch/);
    expect(campaignRequest(mothers, null)).not.toMatch(/iftar/);
    expect(ramadanProblems("Treat Mum to Sunday lunch", mothers, ["muslim"])).toEqual(["Mother's Day falls during Ramadan: say iftar, not lunch."]);
    expect(ramadanProblems("Treat Mum to iftar", mothers, ["muslim"])).toEqual([]);
    expect(ramadanProblems("Treat Mum to Sunday lunch", mothers, [])).toEqual([]);
  });
});

const R = "aaab0000-0000-4000-8000-000000000058";
const RV = "aaab0000-0000-4000-8000-00000000a058";
let db: ReturnType<typeof memoryDb>;
const written: string[] = [];
let subscribers = 0;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00Z"), toFake: ["Date"] });
  written.length = 0;
  subscribers = 0;
  db = memoryDb({ restaurants: [{ id: R, name: "Ember & Spice", event_audiences: null }], calendar_events: [], drafts: [], time_saved_log: [], business_review_parts: [{ review_id: RV, restaurant_id: R, part: "events", status: "done", result: { names: [], drafted: 0, emailsHeld: true } }], audit_log: [] });
  let n = 0;
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  // No Claude anywhere near the dates: if anything asked it, the test fails.
  vi.doMock("@/lib/claude", () => ({ claude: () => { throw new Error("Claude was asked during the calendar"); }, MODELS: {}, MODEL: "", MAX_TOKENS: 1, WITH_FALLBACK: {}, fallbackFor: () => ({}) }));
  vi.doMock("@/lib/assistant", () => ({
    loadRestaurantContext: async () => ({ restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }),
    writeOfferCampaign: async (_c: unknown, _l: unknown, request: string) => (written.push(request), { name: "x", subject: "Offer", body: request.includes("Again") || !request.includes("Ramadan") ? "Join us" : "Come for lunch" }),
    writeEventPost: async (_c: unknown, _l: unknown, request: string) => (written.push(`post: ${request}`), { topic: "event", text: "See you there" }),
  }));
  vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), getLearningContext: async () => ({}) }));
  vi.doMock("@/lib/bot/flows", () => ({ campaignCreateAndSend: async () => { const d = { id: `c${++n}`, restaurant_id: R, kind: "email_campaign", status: "pending", created_at: new Date().toISOString() }; db.tables.drafts.push(d); return d; } }));
  vi.doMock("@/lib/google-jobs", () => ({ createPostDraft: async () => { const d = { id: `p${++n}`, restaurant_id: R, kind: "google_post", status: "pending", created_at: new Date().toISOString() }; db.tables.drafts.push(d); return d; } }));
  vi.doMock("@/lib/campaigns", () => ({ recipientsFor: async () => ({ eligible: Array(subscribers).fill({}), excluded: [], limited: [] }) }));
});
afterEach(() => {
  vi.useRealTimers();
  for (const m of ["@/lib/supabase", "@/lib/claude", "@/lib/assistant", "@/lib/drafts", "@/lib/bot/flows", "@/lib/google-jobs", "@/lib/campaigns"]) vi.doUnmock(m);
});

describe("the events part", () => {
  test("the dates copied from code; one campaign and one post per event; emails held with nobody on the list", async () => {
    const { eventsPart } = await import("@/lib/review/parts/events");
    const out = await eventsPart({ review: { id: RV } as never, restaurant: db.tables.restaurants[0] as never, now: new Date(), connected: true, round: 0 });
    expect(db.tables.calendar_events.map((e) => e.key)).toEqual(CALENDAR_EVENTS.map((e) => e.key));
    expect(out).toEqual({ names: ["Bonfire Night", "Christmas party season", "Black Friday"], drafted: 6, emailsHeld: true });
    expect(db.tables.drafts.every((d) => d.business_review_id === RV)).toBe(true);
    expect(db.tables.time_saved_log.map((x) => x.action).sort()).toEqual(["campaign_draft", "campaign_draft", "campaign_draft", "google_post", "google_post", "google_post"]);
  });

  test("a Ramadan campaign that says lunch is written again; it never goes out saying lunch", async () => {
    const { draftForEvents } = await import("@/lib/review/parts/events");
    db.tables.restaurants[0].event_audiences = ["muslim"];
    const mothers = CALENDAR_EVENTS.find((e) => e.key === "mothers-day-2027")!;
    expect(await draftForEvents(db.tables.restaurants[0] as never, RV, [mothers])).toBe(2);
    expect(written.filter((w) => !w.startsWith("post")).map((w) => w.includes("Again"))).toEqual([false, true]);
  });
});

describe("asking which dates to plan for", () => {
  test("asked in the flow, one at a time; saved (UNDO-able); the new community dates get drafted", async () => {
    db.tables.business_reviews = [{ id: RV, restaurant_id: R, status: "sent", google_connected: false, flow_state: {}, created_at: new Date().toISOString() }];
    const out: { text: string; ids: string[] }[] = [];
    vi.doMock("@/lib/notify", () => ({ sendAndLog: async (_c: unknown, deliver: () => Promise<unknown>) => void (await deliver()) }));
    vi.doMock("@/lib/whatsapp", () => ({ sendDinaChoices: async (_f: string, _t: string, m: { body: string; kind: string; options: { id: string }[] }) => (out.push({ text: `${m.kind}: ${m.body}`, ids: m.options.map((o) => o.id) }), { sid: "S", body: m.body }) }));
    const flow = await import("@/lib/review/flow-run");
    const turn = { ctx: { restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }, channel: { restaurantId: R, from: "a", to: "b" }, owner: "b", send: async (t: string) => void out.push({ text: t, ids: [] }) } as never;
    await flow.handleReviewFlow(turn, "GO", undefined);
    expect(out[0].text).toMatch(/^list: 📅 \*Which dates should I plan for\?\*/);
    expect(out[0].ids).toEqual(["muslim", "hindu_sikh", "chinese_east_asian", "football"].map((a) => `review:${RV}:audiences:add-${a}`).concat(`review:${RV}:audiences:none`));
    await flow.handleReviewFlow(turn, "", `review:${RV}:audiences:add-hindu_sikh`);
    expect(out.at(-1)!.text).toMatch(/Got it: Diwali\. Anything else\?/);
    await flow.handleReviewFlow(turn, "", `review:${RV}:audiences:done`);
    expect(db.tables.restaurants[0].event_audiences).toEqual(["hindu_sikh"]);
    expect(db.tables.audit_log.find((a) => a.action === "setting")).toMatchObject({ actor: "owner", data: { field: "event_audiences", before: null, after: ["hindu_sikh"] } });
    expect(out.map((o) => o.text).join("\n")).toMatch(/I've drafted 2 more for Diwali/);
    for (const m of ["@/lib/notify", "@/lib/whatsapp"]) vi.doUnmock(m);
  });
});
