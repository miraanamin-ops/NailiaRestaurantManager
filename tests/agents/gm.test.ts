// GM tests, offline (every push): the router's and composer's plain-code rules, the
// rules code applies around the GM (5 cards and their order, quiet hours, one alert
// an hour), the saved cases, and every recorded answer. The live run is
// tests/agents-live/gm.eval.ts.
import { describe, expect, test } from "vitest";
import { alertTime, BRIEF_MAX_CARDS, buttonLabel, composerProblems, expectedLanguage, inQuietHours, languageOf, rankBriefItems, routerProblems, type RouterOutputType } from "@/lib/agents/gm-rules";
import { composerContext, judgeComposer, loadComposerCases, loadRouting, routingKey, routingProblems } from "./support/gm-cases";

describe("the router's rules", () => {
  const route = (o: Partial<RouterOutputType>): RouterOutputType => ({ route: "growth", request: "Fill a quiet Thursday", language: "English", question: null, options: [], ...o });
  test("a route restates the ask; only an ambiguous message gets a question and 2 or 3 buttons", () => {
    expect(routerProblems(route({}))).toEqual([]);
    expect(routerProblems(route({ request: "" })).join()).toMatch(/restate/);
    expect(routerProblems(route({ question: "Which?" })).join()).toMatch(/only an ambiguous message/);
    const ask = route({ route: "ambiguous", request: "", question: "What should I do for Saturday?", options: [{ label: "An offer", route: "growth" }, { label: "The numbers", route: "insights" }] });
    expect(routerProblems(ask)).toEqual([]);
    expect(routerProblems({ ...ask, options: [ask.options[0]] }).join()).toMatch(/2 or 3 options/);
    expect(buttonLabel("Google or social posts")).toBe("Google or social");
    expect(buttonLabel("An offer")).toBe("An offer");
  });
});

describe("the composer's rules", () => {
  const ctx = { kind: "card" as const, allowedNumbers: [18, 6, 37], language: "English" as const };
  test("no invented numbers, no 'just checking in', cards under 40 words, no em-dashes", () => {
    expect(composerProblems({ type: "card", message: "Thursday offer to 18 customers. Last similar offer: 6 redemptions from 37 sent." }, ctx)).toEqual([]);
    expect(composerProblems({ type: "card", message: "Thursday offer to 214 regulars." }, ctx).join()).toMatch(/"214" isn't in the receipts/);
    expect(composerProblems({ type: "card", message: "Just checking in on the Thursday offer." }, ctx).join()).toMatch(/every message carries a decision/);
    expect(composerProblems({ type: "card", message: Array.from({ length: 45 }, () => "word").join(" ") }, ctx).join()).toMatch(/under 40 words/);
  });
  test("the owner's language: Urdu, Roman Urdu or English", () => {
    expect(languageOf("اتوار کو ہم بارہ بجے کھلتے ہیں")).toBe("Urdu");
    expect(languageOf("abhi sign up offer kya hai?")).toBe("Roman Urdu");
    expect(languageOf("What time do we open?")).toBe("English");
    expect(expectedLanguage({ ownerMessage: "Eid ke liye kuch special karo" })).toBe("Roman Urdu");
    expect(expectedLanguage({ profileLanguage: "Urdu" })).toBe("Urdu");
    expect(expectedLanguage({ profileLanguage: "English, with Urdu replies welcome" })).toBe("English");
    expect(composerProblems({ type: "reply", message: "We open at midday on Sunday." }, { kind: "reply", allowedNumbers: [], language: "Urdu" }).join()).toMatch(/owner's language \(Urdu\)/);
  });
});

describe("rules code applies around the GM", () => {
  test("the brief: at most 5 cards, urgent first, then by send date, then oldest; the rest roll to tomorrow", () => {
    const item = (id: string, o: { urgent?: boolean; send_at?: string | null; created_at: string }) => ({ id, urgent: o.urgent ?? false, send_at: o.send_at ?? null, created_at: o.created_at });
    const items = [
      item("old", { created_at: "2026-10-01" }),
      item("newer", { created_at: "2026-10-05" }),
      item("urgent", { urgent: true, created_at: "2026-10-10" }),
      item("sends-fri", { send_at: "2026-10-16T10:00", created_at: "2026-10-09" }),
      item("sends-thu", { send_at: "2026-10-15T10:00", created_at: "2026-10-11" }),
      item("newest", { created_at: "2026-10-11" }),
    ];
    const { today, tomorrow } = rankBriefItems(items);
    expect(today.map((i) => i.id)).toEqual(["urgent", "sends-thu", "sends-fri", "old", "newer"]);
    expect(tomorrow.map((i) => i.id)).toEqual(["newest"]);
    expect(today).toHaveLength(BRIEF_MAX_CARDS);
  });
  test("quiet hours run over midnight; one alert an hour", () => {
    expect(inQuietHours(23 * 60 + 30, "23:00:00", "09:00:00")).toBe(true);
    expect(inQuietHours(8 * 60 + 59, "23:00:00", "09:00:00")).toBe(true);
    expect(inQuietHours(9 * 60, "23:00:00", "09:00:00")).toBe(false);
    expect(inQuietHours(21 * 60 + 30, "23:00:00", "09:00:00")).toBe(false);
    const now = new Date("2026-10-12T20:30:00Z");
    expect(alertTime({ now, londonMinutes: 21 * 60 + 30, quietStart: "23:00:00", quietEnd: "09:00:00", lastAlertAt: null })).toEqual({ send: "now" });
    expect(alertTime({ now, londonMinutes: 21 * 60 + 30, quietStart: "23:00:00", quietEnd: "09:00:00", lastAlertAt: new Date("2026-10-12T20:00:00Z") })).toEqual({ send: "later", reason: "hourly_limit" });
    expect(alertTime({ now, londonMinutes: 23 * 60 + 30, quietStart: "23:00:00", quietEnd: "09:00:00", lastAlertAt: null })).toEqual({ send: "later", reason: "quiet_hours" });
  });
});

const routing = loadRouting();
test("56 routing cases, covering every situation phase 4 lists and the agents going live", () => {
  expect(routing.cases).toHaveLength(56);
  const all = routing.cases.map((c) => `${c.message} ${c.note ?? ""}`).join("\n").toLowerCase();
  for (const kind of ["typo", "thursday dead", "urdu", "roman urdu", "how was last week", "job ad", "supplier", "we close at 10", "ignore your instructions"]) expect(all).toContain(kind);
  expect(routing.cases.filter((c) => c.routes.length === 1 && c.routes[0] === "ambiguous").length).toBeGreaterThanOrEqual(2);
  // Agents live: rota edits, finance, Google, calendar campaigns, typed edits on screen, a pasted review.
  for (const route of ["team", "insights", "reputation", "visibility", "growth", "edit"] as const) expect(routing.cases.some((c) => c.routes.includes(route))).toBe(true);
  expect(routing.cases.some((c) => c.on_screen)).toBe(true);
  expect(routing.cases.some((c) => c.pasted)).toBe(true);
  expect(new Set(routing.cases.map(routingKey)).size).toBe(routing.cases.length);
});

test("every recorded route is right", () => {
  const rec = routing.recorded;
  if (!rec) return;
  // A case added since the last recording is checked by the live run (npm run test:agents -- gm --record).
  const wrong = routing.cases.filter((c) => {
    const r = rec.results.find((x) => routingKey(x) === routingKey(c));
    return r && (routingProblems(c, r.output).length || routerProblems(r.output).length);
  });
  expect(wrong.map((c) => c.message)).toEqual([]);
});

const composer = loadComposerCases();
describe.each(composer)("composer case $file", ({ case: c }) => {
  test("is well formed", () => {
    expect(c.name && c.kind && c.owner.owner_name).toBeTruthy();
    expect(composerContext(c).allowedNumbers.length).toBeGreaterThanOrEqual(0);
  });
  if (c.recorded) test("its recorded message passes", () => expect(judgeComposer(c, c.recorded!.output)).toEqual([]));
});
