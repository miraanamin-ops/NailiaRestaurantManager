// Onboarding with Dina: the state machine (src/lib/onboarding/flow.ts). Pure
// rules only: the order, skips, partials, re-entry, editing a finished step,
// steps waiting on someone else, finishing, and setup gaps (creation, closing,
// the nudge order, snooze and dismissal).
import { describe, expect, test } from "vitest";
import {
  availableSteps,
  canActivate,
  canFinish,
  complete,
  currentStep,
  enter,
  FLOW_STEPS,
  FlowError,
  gapReply,
  gapsFor,
  MAX_IGNORED_NUDGES,
  pickNudge,
  progress,
  skip,
  STEP_DEFS,
  statusOf,
  syncGaps,
  wait,
  type FlowState,
  type FlowStepKey,
  type Gap,
} from "@/lib/onboarding/flow";

const T = "2026-10-28T10:00:00.000Z";
const LATER = "2026-10-28T11:00:00.000Z";
const MILESTONE_A: FlowStepKey[] = ["hello", "google", "tone", "make_it_right", "menu", "hours_faqs"];

const hello = (s: FlowState = {}) => complete(s, "hello", "done", { owner_name: "Amina", restaurant_name: "Ember & Spice Grill" }, T);
const all = (fn: (s: FlowState, k: FlowStepKey) => FlowState, start: FlowState = hello()) => availableSteps().filter((k) => k !== "hello").reduce(fn, start);

describe("the steps", () => {
  test("twelve in the agreed order; only Hello can't be skipped and has no unlock line", () => {
    expect(FLOW_STEPS).toEqual(["hello", "google", "tone", "make_it_right", "menu", "hours_faqs", "sales", "team", "rewards", "customers_qr", "languages_dates", "approvals_timing"]);
    for (const k of FLOW_STEPS) {
      expect(STEP_DEFS[k].skippable).toBe(k !== "hello");
      expect(Boolean(STEP_DEFS[k].unlock)).toBe(k !== "hello");
    }
    expect(STEP_DEFS.google.unlock).toBe("Connect Google and I'll reply to your reviews, post updates and track calls and directions for you.");
  });

  test("milestone A asks steps 1 to 6; the rest aren't part of setup yet and can't be entered", () => {
    expect(availableSteps()).toEqual(MILESTONE_A);
    expect(() => enter({}, "sales", T)).toThrow(FlowError);
    expect(() => skip({}, "team", T)).toThrow(/isn't part of setup yet/);
  });

  test("no unlock line or step title has an em-dash", () => {
    for (const k of FLOW_STEPS) expect(`${STEP_DEFS[k].title} ${STEP_DEFS[k].unlock ?? ""}`).not.toMatch(/—/);
  });
});

describe("where the owner is", () => {
  test("starts at Hello and goes in order", () => {
    expect(currentStep({})).toBe("hello");
    expect(progress({})).toEqual({ total: 6, position: 1, done: 0, resolved: 0 });
    const s = hello();
    expect(currentStep(s)).toBe("google");
    expect(progress(s)).toMatchObject({ position: 2, done: 1 });
  });

  test("skipping, finishing in part and finishing all move Dina on", () => {
    let s = skip(hello(), "google", T);
    expect(currentStep(s)).toBe("tone");
    s = complete(s, "tone", "partial", { praise: "warm" }, T);
    expect(currentStep(s)).toBe("make_it_right");
    s = complete(s, "make_it_right", "done", { offers: ["Free dessert"] }, T);
    expect(currentStep(s)).toBe("menu");
    expect(progress(s)).toMatchObject({ position: 5, done: 2, resolved: 4 });
  });

  test("a step waiting on someone else (Google accepting our invite) doesn't hold the owner up", () => {
    const s = wait(hello(), "google", "google_acceptance", { invited: true }, T);
    expect(statusOf(s, "google")).toBe("in_progress");
    expect(currentStep(s)).toBe("tone");
    // Coming back to it keeps it waiting; finishing it later makes it done.
    expect(enter(s, "google", LATER)).toBe(s);
    const done = complete(s, "google", "done", { accepted: true }, LATER);
    expect(done.google).toMatchObject({ status: "done", waitingOn: null, data: { invited: true, accepted: true } });
  });

  test("a finished step can't be waited on again", () => {
    const s = complete(hello(), "google", "done", { connected: true }, T);
    expect(() => wait(s, "google", "google_acceptance", {}, T)).toThrow(/already done/);
  });
});

describe("entering steps", () => {
  test("entering starts a step once (the first start time is kept)", () => {
    const s = enter(hello(), "google", T);
    expect(s.google).toMatchObject({ status: "in_progress", startedAt: T });
    expect(enter(s, "google", LATER).google?.startedAt).toBe(T);
  });

  test("going back to a skipped step re-opens it; the owner can then skip it again", () => {
    let s = skip(hello(), "menu", T);
    s = enter(s, "menu", LATER);
    expect(s.menu).toMatchObject({ status: "in_progress", skippedAt: null });
    expect(currentStep(s)).toBe("google");
    s = skip(s, "menu", LATER);
    expect(statusOf(s, "menu")).toBe("skipped");
  });

  test("going back to a partial step re-opens it until it's saved again", () => {
    let s = complete(hello(), "tone", "partial", { praise: "warm" }, T);
    s = enter(s, "tone", LATER);
    expect(statusOf(s, "tone")).toBe("in_progress");
    s = complete(s, "tone", "done", { complaint: "polished" }, LATER);
    expect(s.tone).toMatchObject({ status: "done", data: { praise: "warm", complaint: "polished" }, completedAt: LATER });
  });

  test("editing a finished step keeps it finished; its new data replaces the old field by field", () => {
    let s = complete(hello(), "hours_faqs", "done", { hours: { mon: "12:00-23:00" }, parking: "street" }, T);
    s = enter(s, "hours_faqs", LATER);
    expect(statusOf(s, "hours_faqs")).toBe("done");
    s = complete(s, "hours_faqs", "done", { parking: "car park behind" }, LATER);
    expect(s.hours_faqs).toMatchObject({ status: "done", data: { hours: { mon: "12:00-23:00" }, parking: "car park behind" } });
  });

  test("Hello can't be skipped, and a finished step can't be skipped back", () => {
    expect(() => skip({}, "hello", T)).toThrow(expect.objectContaining({ code: "not_skippable" }));
    const s = complete(hello(), "menu", "done", { dishes: 12 }, T);
    expect(skip(s, "menu", LATER)).toBe(s);
  });

  test("the rules never change the state they're given", () => {
    const s = hello();
    const copy = JSON.stringify(s);
    skip(s, "google", T);
    enter(s, "tone", T);
    complete(s, "menu", "done", {}, T);
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe("activating and finishing", () => {
  test("nothing runs before Hello is done", () => {
    expect(canActivate({})).toBe(false);
    expect(canActivate(enter({}, "hello", T))).toBe(false);
    expect(canActivate(hello())).toBe(true);
  });

  test("everything skipped can finish, once WhatsApp is linked", () => {
    const s = all((st, k) => skip(st, k, T));
    expect(currentStep(s)).toBeNull();
    expect(canFinish(s, false)).toBe(false);
    expect(canFinish(s, true)).toBe(true);
    expect(progress(s)).toEqual({ total: 6, position: 6, done: 1, resolved: 6 });
  });

  test("a step still being worked on stops finishing", () => {
    const s = enter(all((st, k) => (k === "menu" ? st : skip(st, k, T))), "menu", T);
    expect(currentStep(s)).toBe("menu");
    expect(canFinish(s, true)).toBe(false);
  });
});

describe("setup gaps", () => {
  const gap = (step_key: string, extra: Partial<Gap> = {}): Gap => ({
    id: `gap-${step_key}`,
    step_key,
    unlock_text: STEP_DEFS[step_key as FlowStepKey]?.unlock ?? "",
    nudge_count: 0,
    last_nudged_at: null,
    snoozed_until: null,
    dismissed: false,
    dismissed_reason: null,
    resolved_at: null,
    ...extra,
  });

  test("every skipped or partial step is a gap with its unlock line; done, waiting and untouched ones aren't", () => {
    let s = skip(hello(), "google", T);
    s = complete(s, "tone", "partial", {}, T);
    s = complete(s, "make_it_right", "done", {}, T);
    s = wait(s, "menu", "something", {}, T);
    expect(gapsFor(s)).toEqual([
      { step_key: "google", unlock_text: STEP_DEFS.google.unlock },
      { step_key: "tone", unlock_text: STEP_DEFS.tone.unlock },
    ]);
  });

  test("all steps skipped: one gap per skippable step", () => {
    expect(gapsFor(all((st, k) => skip(st, k, T))).map((g) => g.step_key)).toEqual(MILESTONE_A.slice(1));
  });

  test("syncing: new gaps are added once, finished ones close, and skipping again re-opens a closed one", () => {
    let s = skip(hello(), "google", T);
    expect(syncGaps([], s)).toEqual({ add: [{ step_key: "google", unlock_text: STEP_DEFS.google.unlock }], reopen: [], resolve: [] });
    const saved = [gap("google")];
    expect(syncGaps(saved, s)).toEqual({ add: [], reopen: [], resolve: [] });
    s = complete(enter(s, "google", LATER), "google", "done", {}, LATER);
    expect(syncGaps(saved, s)).toEqual({ add: [], reopen: [], resolve: ["gap-google"] });
    // Re-entered but not finished yet: still closed (it's being worked on).
    const reentered = enter(skip(hello(), "menu", T), "menu", LATER);
    expect(syncGaps([gap("menu")], reentered).resolve).toEqual(["gap-menu"]);
    const closed = [gap("menu", { resolved_at: LATER })];
    expect(syncGaps(closed, skip(reentered, "menu", LATER))).toEqual({ add: [], reopen: ["gap-menu"], resolve: [] });
  });

  test("a dismissed gap stays dismissed when the step is skipped again", () => {
    const s = skip(hello(), "tone", T);
    expect(syncGaps([gap("tone", { dismissed: true, dismissed_reason: "not_relevant" })], s)).toEqual({ add: [], reopen: [], resolve: [] });
  });

  test("the nudge goes to the most valuable gap: Google, then sales history, then menu, then the rest in order", () => {
    const now = new Date(T);
    expect(pickNudge([gap("tone"), gap("menu"), gap("google")], now).pick?.step_key).toBe("google");
    expect(pickNudge([gap("hours_faqs"), gap("tone"), gap("menu")], now).pick?.step_key).toBe("menu");
    expect(pickNudge([gap("hours_faqs"), gap("make_it_right"), gap("tone")], now).pick?.step_key).toBe("tone");
    expect(STEP_DEFS.sales.gapPriority).toBeLessThan(STEP_DEFS.menu.gapPriority);
    expect(STEP_DEFS.google.gapPriority).toBeLessThan(STEP_DEFS.sales.gapPriority);
    expect(pickNudge([], now)).toEqual({ pick: null, autoDismiss: [] });
  });

  test("snoozed, dismissed and closed gaps aren't nudged; a snooze ends", () => {
    const now = new Date(T);
    const gaps = [
      gap("google", { snoozed_until: "2026-11-01T00:00:00Z" }),
      gap("menu", { dismissed: true, dismissed_reason: "not_relevant" }),
      gap("tone", { resolved_at: T }),
      gap("hours_faqs"),
    ];
    expect(pickNudge(gaps, now).pick?.step_key).toBe("hours_faqs");
    expect(pickNudge(gaps, new Date("2026-11-02T00:00:00Z")).pick?.step_key).toBe("google");
  });

  test("after 3 ignored nudges a gap is dismissed instead of nudged again", () => {
    const res = pickNudge([gap("google", { nudge_count: MAX_IGNORED_NUDGES }), gap("menu", { nudge_count: 2 })], new Date(T));
    expect(res).toMatchObject({ autoDismiss: ["gap-google"], pick: { step_key: "menu" } });
  });

  test("answers: Do it now resumes the step, Later snoozes 7 days, Not relevant dismisses; any answer resets the ignored count", () => {
    const now = new Date(T);
    const g = gap("menu", { nudge_count: 2 });
    expect(gapReply(g, "now", now)).toEqual({ gap: { ...g, nudge_count: 0 }, resume: "menu" });
    expect(gapReply(g, "later", now)).toEqual({ gap: { ...g, nudge_count: 0, snoozed_until: "2026-11-04T10:00:00.000Z" }, resume: null });
    expect(gapReply(g, "not_relevant", now)).toEqual({ gap: { ...g, nudge_count: 0, dismissed: true, dismissed_reason: "not_relevant" }, resume: null });
  });
});
