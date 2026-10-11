// The shared draft shape, the profile keeper's change shape, the checker's
// verdict shape, and calling an agent: retry once, then fail and alert the builder.
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { applyMinorFixes, draftProblems, profileChangeProblems, verdictProblems, type CheckId } from "@/lib/agents/schema";
import { parseSourceRef } from "@/lib/agents/sources";

const draft = (extra: Record<string, unknown> = {}) => ({
  type: "review_reply",
  channel: "google",
  content: { text: "Thank you, Aisha! See you soon. Bilal" },
  needs_owner_input: null,
  sources_used: ["review:abc123", "profile:sign_off_name"],
  ...extra,
});

describe("shared draft shape", () => {
  test("a good draft passes", () => {
    expect(draftProblems(draft())).toEqual([]);
  });

  test("content must be an object", () => {
    expect(draftProblems(draft({ content: "the reply text" })).join()).toMatch(/content/);
  });

  test("agent-specific fields are allowed alongside the shared ones", () => {
    expect(draftProblems(draft({ review_id: "abc123", rating: 5, alert: false }))).toEqual([]);
  });

  test("code-only fields are refused", () => {
    expect(draftProblems(draft({ draft_id: "drf_1" }))).toEqual(["draft_id is set by code; leave it out"]);
  });

  test("a question for the owner means no customer-facing text", () => {
    expect(draftProblems(draft({ needs_owner_input: "Reply publicly or privately?" })).join()).toMatch(/content must be empty/);
    expect(draftProblems(draft({ needs_owner_input: "Reply publicly or privately?", content: {}, sources_used: [] }))).toEqual([]);
  });

  test("a customer-facing draft needs sources, in kind:id form", () => {
    expect(draftProblems(draft({ sources_used: [] })).join()).toMatch(/sources_used is empty/);
    expect(draftProblems(draft({ sources_used: ["the review"] })).join()).toMatch(/kind:id/);
  });

  test("empty content is refused", () => {
    expect(draftProblems(draft({ content: { text: " " } })).join()).toMatch(/content is empty/);
  });
});

describe("source references", () => {
  test("known kinds parse", () => {
    expect(parseSourceRef("profile:sign_off_name")).toEqual({ kind: "profile", id: "sign_off_name" });
    expect(parseSourceRef("history:cmp_0012")).toEqual({ kind: "history", id: "cmp_0012" });
  });
  test("anything else doesn't", () => {
    expect(parseSourceRef("website:foo")).toBeNull();
    expect(parseSourceRef("review")).toBeNull();
  });
});

describe("profile changes", () => {
  const fields: Record<string, { section: "voice" | "facts" | "controls"; rule: "auto" | "confirm" | "settings" }> = {
    greeting: { section: "voice", rule: "auto" },
    menu: { section: "facts", rule: "confirm" },
    discount_cap: { section: "controls", rule: "settings" },
  };
  const lookup = (f: string) => fields[f] ?? null;
  const change = (extra: Record<string, unknown> = {}) => ({
    type: "profile_change",
    section: "voice",
    field: "greeting",
    from: "Hi",
    to: "Salaam",
    evidence: ["dec_1", "dec_2", "dec_3"],
    apply: "now",
    summary_line: "You've switched 'Hi' to 'Salaam' three times, so replies now open with 'Salaam'.",
    ...extra,
  });

  test("a learned voice change can apply now", () => {
    expect(profileChangeProblems(change(), lookup)).toEqual([]);
  });
  test("facts need the owner's yes first", () => {
    expect(profileChangeProblems(change({ section: "facts", field: "menu", apply: "now" }), lookup).join()).toMatch(/owner's yes/);
    expect(profileChangeProblems(change({ section: "facts", field: "menu", apply: "after_owner_confirms" }), lookup)).toEqual([]);
  });
  test("settings-only fields can never be changed by an agent", () => {
    expect(profileChangeProblems(change({ section: "controls", field: "discount_cap", apply: "after_owner_confirms" }), lookup).join()).toMatch(/only in settings/);
  });
  test("unknown fields, wrong sections and missing evidence are refused", () => {
    expect(profileChangeProblems(change({ field: "favourite_colour" }), lookup)).toEqual(["favourite_colour isn't a profile field"]);
    expect(profileChangeProblems(change({ section: "facts" }), lookup).join()).toMatch(/voice section/);
    expect(profileChangeProblems(change({ evidence: [] }), lookup).join()).toMatch(/evidence is empty/);
  });
});

describe("checker verdicts", () => {
  const applicable: CheckId[] = ["T1", "F1", "F2", "C1"];
  const input = { applicable, skipped: ["B1", "B2", "B3", "B4"] as CheckId[], draftText: "Come in tonight — book now. Lamb chops £14." };
  const ok = (id: CheckId) => ({ id, result: "pass" as const, reason: null, fix: null });
  const verdict = (extra: Record<string, unknown> = {}) => ({
    verdict: "pass",
    checks: applicable.map(ok),
    minor_fixes: [],
    owner_question: null,
    notes: "",
    ...extra,
  });

  test("a complete pass is valid", () => {
    expect(verdictProblems(verdict(), input)).toEqual([]);
  });
  test("every applicable check must be listed", () => {
    expect(verdictProblems(verdict({ checks: [ok("T1")] }), input).join()).toMatch(/missing.*F1, F2, C1/);
  });
  test("verdict and check results must agree", () => {
    const failing = [...applicable.slice(1).map(ok), { id: "T1", result: "fail", reason: "Generic", fix: "Mention the dish" }];
    expect(verdictProblems(verdict({ checks: failing }), input).join()).toMatch(/verdict is pass but T1 failed/);
    expect(verdictProblems(verdict({ verdict: "fail" }), input).join()).toMatch(/no check failed/);
    expect(verdictProblems(verdict({ verdict: "escalate" }), input).join()).toMatch(/no owner question/);
  });
  test("minor fixes: only small exact replacements under T3, T5, F2, F3, F4", () => {
    const good = { check: "T5", find: "tonight — book now", replace: "tonight. Book now" };
    expect(verdictProblems(verdict({ minor_fixes: [good] }), input)).toEqual([]);
    expect(verdictProblems(verdict({ minor_fixes: [{ ...good, check: "T1" }] }), input).join()).toMatch(/only T3, T5, F2, F3, F4/);
    expect(verdictProblems(verdict({ minor_fixes: [{ ...good, find: "tonight - book now" }] }), input).join()).toMatch(/isn't in the draft/);
    expect(verdictProblems(verdict({ minor_fixes: [{ ...good, replace: "tonight — now" }] }), input).join()).toMatch(/em-dash/);
  });
  test("minor fixes apply as exact find-and-replace", () => {
    expect(applyMinorFixes(input.draftText, [{ find: "tonight — book now", replace: "tonight. Book now" }, { find: "£14", replace: "£15" }])).toBe(
      "Come in tonight. Book now. Lamb chops £15.",
    );
  });
});

describe("calling an agent", () => {
  afterEach(() => vi.resetModules());

  async function withAnswers(answers: unknown[]) {
    const requests: { model: string; messages: { content: { type: string; text?: string }[] }[]; fallbacks?: unknown }[] = [];
    const alerts: string[] = [];
    vi.resetModules();
    vi.doMock("@/lib/claude", () => ({
      MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
      MAX_TOKENS: 100,
      fallbackFor: (t: string) => (t === "haiku" ? {} : { fallbacks: "default" }),
      claude: () => ({
        beta: {
          messages: {
            parse: async (req: (typeof requests)[number]) => {
              requests.push(req);
              return { stop_reason: "end_turn", parsed_output: answers[requests.length - 1] ?? null };
            },
          },
        },
      }),
    }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
    const { callAgent, AgentOutputError } = await import("@/lib/agents/run");
    const schema = z.object({ answer: z.string() });
    const run = () =>
      callAgent({
        agent: "checker",
        content: [{ type: "text", text: "Check this" }],
        schema,
        validate: (o) => (o.answer === "good" ? [] : [`answer "${o.answer}" isn't good`]),
        label: "draft d1",
      });
    return { run, requests, alerts, AgentOutputError };
  }

  test("valid first time: one call, on the agent's model, with the fallback", async () => {
    const t = await withAnswers([{ answer: "good" }]);
    const res = await t.run();
    expect(res).toMatchObject({ output: { answer: "good" }, attempts: 1, model: "claude-sonnet-5-5" });
    expect(t.requests[0].fallbacks).toBe("default");
    expect(t.alerts).toEqual([]);
  });

  test("invalid once: retried with the problems listed", async () => {
    const t = await withAnswers([{ answer: "bad" }, { answer: "good" }]);
    const res = await t.run();
    expect(res.attempts).toBe(2);
    expect(JSON.stringify(t.requests[1].messages)).toContain('answer \\"bad\\" isn\'t good');
  });

  test("invalid twice: fails and alerts the builder", async () => {
    const t = await withAnswers([{ answer: "bad" }, { answer: "worse" }]);
    await expect(t.run()).rejects.toBeInstanceOf(t.AgentOutputError);
    expect(t.requests).toHaveLength(2);
    expect(t.alerts[0]).toMatch(/checker agent .* invalid output twice for draft d1/);
  });

  test("no answer at all counts as invalid", async () => {
    const t = await withAnswers([null, null]);
    await expect(t.run()).rejects.toThrow(/no usable answer/);
  });
});
