// The four checks: the plain-code ones directly, the AI ones with Claude replaced by a stand-in.
import { describe, expect, test, vi } from "vitest";
import { segmentRecipients } from "@/lib/campaigns";
import { emailComplianceProblems, misleadingClaims } from "@/lib/checks/compliance";
import { moneyAndRisk, moneyAtDraft, type RuleDraft } from "@/lib/checks/money";
import { checkNoteLines, checkResult, checksLine } from "@/lib/checks/types";

const restaurant = { paused: false, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00" };
const approved: RuleDraft = { status: "approved", approved_at: "2026-10-09T10:00:00Z", sent_at: null, scheduled_for: null, content: "15% off grills" };
const noonUk = new Date("2026-10-09T11:00:00Z"); // 12:00 in London (BST)
const lateUk = new Date("2026-10-09T21:30:00Z"); // 22:30 in London

describe("money and risk: every send rule", () => {
  test("an approved draft inside sending hours can go", () => {
    expect(moneyAndRisk(approved, restaurant, noonUk, "approve")).toEqual({ outcome: "ok" });
  });
  test("nothing sends without an Approve", () => {
    const r = moneyAndRisk({ ...approved, status: "pending", approved_at: null }, restaurant, noonUk, "test");
    expect(r).toMatchObject({ outcome: "blocked", reason: "not_approved" });
  });
  test("no duplicates: already sent, or already queued", () => {
    expect(moneyAndRisk({ ...approved, status: "sent", sent_at: "2026-10-09T10:05:00Z" }, restaurant, noonUk, "approve")).toMatchObject({ outcome: "blocked", reason: "duplicate" });
    expect(moneyAndRisk({ ...approved, status: "queued" }, restaurant, noonUk, "approve")).toMatchObject({ outcome: "blocked", reason: "duplicate" });
    // ...but the queue itself may release a queued draft
    expect(moneyAndRisk({ ...approved, status: "queued" }, restaurant, noonUk, "queue")).toEqual({ outcome: "ok" });
  });
  test("discount cap", () => {
    expect(moneyAndRisk({ ...approved, content: "25% off everything" }, restaurant, noonUk, "approve")).toMatchObject({ outcome: "blocked", reason: "discount_cap" });
    expect(moneyAndRisk({ ...approved, content: "25% off everything" }, { ...restaurant, discount_cap_percent: 30 }, noonUk, "approve")).toEqual({ outcome: "ok" });
  });
  test("PAUSE holds everything until RESUME", () => {
    expect(moneyAndRisk(approved, { ...restaurant, paused: true }, noonUk, "approve")).toMatchObject({ outcome: "queued", reason: "paused", scheduledFor: null });
  });
  test("outside 9am-9pm UK it's queued for the next morning", () => {
    const r = moneyAndRisk(approved, restaurant, lateUk, "approve");
    expect(r).toMatchObject({ outcome: "queued", reason: "outside_window" });
    expect(r.outcome === "queued" && r.scheduledFor?.toISOString()).toBe("2026-10-10T08:00:00.000Z");
  });
  test("the cap is also flagged when the draft is made", () => {
    expect(moneyAtDraft("Half price wings tonight", 20)).toHaveLength(1);
    expect(moneyAtDraft("10% off kunafa", 20)).toHaveLength(0);
  });
});

describe("compliance", () => {
  test("misleading claims are flagged, normal hospitality isn't", () => {
    expect(misleadingClaims("The best lamb chops in East London!")).toHaveLength(1);
    expect(misleadingClaims("Satisfaction guaranteed or your money back")).toHaveLength(1);
    expect(misleadingClaims("Our guilt-free healthy grill")).toHaveLength(1);
    expect(misleadingClaims("Thanks so much, Aisha! So glad you loved the lamb chops. See you soon 🙏")).toHaveLength(0);
    expect(misleadingClaims("15% off all grills this Thursday")).toHaveLength(0);
  });
  test('"today only" on a multi-day offer is false urgency', () => {
    const flags = misleadingClaims("Today only: 15% off!", { validFrom: "2026-10-10", validUntil: "2026-10-12" });
    expect(flags.some((f) => f.includes("runs 2026-10-10 to 2026-10-12"))).toBe(true);
    expect(misleadingClaims("15% off this weekend", { validFrom: "2026-10-10", validUntil: "2026-10-12" })).toHaveLength(0);
  });
  test("emails need someone with consent, and an unsubscribe link for everyone", () => {
    expect(emailComplianceProblems({ eligible: 12, excluded: 2, missingUnsubscribe: 0 })).toEqual([]);
    expect(emailComplianceProblems({ eligible: 0, excluded: 3, missingUnsubscribe: 0 })[0]).toMatch(/No customers.*3 left out/);
    expect(emailComplianceProblems({ eligible: 5, excluded: 0, missingUnsubscribe: 1 })[0]).toMatch(/without an unsubscribe link/);
  });
});

describe("consent filtering for campaigns", () => {
  const c = (id: string, extra: Partial<Parameters<typeof segmentRecipients>[0][number]> = {}) => ({
    id, name: id, email: `${id}@example.com`, birthday: null, marketing_opt_in: true, unsubscribed_at: null, source: "signup", ...extra,
  });
  const now = new Date("2026-10-09T12:00:00Z");
  const people = [
    c("yes"),
    c("no-consent", { marketing_opt_in: false }),
    c("unsubscribed", { unsubscribed_at: "2026-10-01T00:00:00Z" }),
    c("no-email", { email: null }),
    c("birthday", { birthday: "1990-10-12" }),
    c("seeded", { source: "seed" }),
  ];
  test("everyone: only consented, subscribed customers with an email", () => {
    const r = segmentRecipients(people, "everyone", now, new Set());
    expect(r.eligible.map((x) => x.id)).toEqual(["yes", "birthday", "seeded"]);
    expect(r.excluded).toBe(2); // no-consent and unsubscribed (no-email isn't in the segment at all)
  });
  test("birthdays in the next 7 days", () => {
    expect(segmentRecipients(people, "birthdays_7d", now, new Set()).eligible.map((x) => x.id)).toEqual(["birthday"]);
  });
  test("unredeemed sign-ups: only sign-ups whose reward is unused, and still only with consent", () => {
    const r = segmentRecipients(people, "unredeemed_signups", now, new Set(["yes", "no-consent", "seeded"]));
    expect(r.eligible.map((x) => x.id)).toEqual(["yes"]);
    expect(r.excluded).toBe(1);
  });
});

describe("how checks show on WhatsApp", () => {
  test("one line for all four, then each fix and flag with its check's name", () => {
    const checks = {
      tone: checkResult([], []),
      facts: checkResult(["Lamb Chops price £9.95 → £13.95"], []),
      compliance: checkResult([], ["promises a guarantee the restaurant may not be able to keep"]),
      money: checkResult([], []),
    };
    expect(checksLine(checks)).toBe("✅ Brand & tone · 🔧 Facts · ⚠️ Compliance · ✅ Money & risk");
    expect(checkNoteLines(checks)).toEqual([
      "🔍 _Facts fixed: Lamb Chops price £9.95 → £13.95_",
      "⚠️ _Compliance: promises a guarantee the restaurant may not be able to keep_",
    ]);
  });
});

describe("the AI checks (Claude replaced by a stand-in)", () => {
  const ctx = {
    restaurantName: "Ember & Spice Grill",
    discountCapPercent: 20,
    today: "Friday, 9 October 2026",
    data: { restaurant: { name: "Ember & Spice Grill", address: "", phone: "", opening_hours: {}, menu: [], brand_voice: "Warm" } },
  } as never;

  test("facts runs first, then tone checks the corrected text; each records what it did", async () => {
    const calls: string[] = [];
    vi.doMock("@/lib/claude", () => ({
      MODEL: "test",
      MAX_TOKENS: 100,
      WITH_FALLBACK: {},
      claude: () => ({
        beta: {
          messages: {
            parse: async (req: { system: { text: string }[]; messages: { content: string }[] }) => {
              const isFacts = req.system[0].text.includes("FACTS");
              calls.push(isFacts ? "facts" : "tone");
              const input = req.messages[0].content;
              return isFacts
                ? { stop_reason: "end_turn", parsed_output: { fields: { content: "Lamb chops £13.95" }, fixes: ["price £9.95 → £13.95"], flags: [] } }
                : { stop_reason: "end_turn", parsed_output: { fields: { content: input.includes("£13.95") ? "Lamb chops £13.95 🔥" : "WRONG" }, fixes: [], flags: ["a bit pushy"] } };
            },
          },
        },
      }),
    }));
    vi.resetModules();
    const { checkDraft } = await import("@/lib/checks");
    const out = await checkDraft(ctx, { kind: "promotion", audience: "everyone", content: "Lamb chops £9.95 — best in London!" });
    expect(calls).toEqual(["facts", "tone"]);
    expect(out.content).toBe("Lamb chops £13.95 🔥");
    expect(out.checks.facts?.status).toBe("fixed");
    expect(out.checks.tone?.status).toBe("flagged");
    expect(out.checks.compliance?.status).toBe("pass"); // the claim was removed by the checks
    expect(out.checks.money?.status).toBe("pass");
    vi.doUnmock("@/lib/claude");
  });

  test("if an AI check can't run, the draft is unchanged and flagged for a careful read", async () => {
    vi.doMock("@/lib/claude", () => ({
      MODEL: "test",
      MAX_TOKENS: 100,
      WITH_FALLBACK: {},
      claude: () => ({ beta: { messages: { parse: async () => { throw new Error("API down"); } } } }),
    }));
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkDraft } = await import("@/lib/checks");
    const out = await checkDraft(ctx, { kind: "promotion", audience: "everyone", content: "Satisfaction guaranteed!" });
    expect(out.content).toBe("Satisfaction guaranteed!");
    expect(out.checks.facts?.status).toBe("failed");
    expect(out.checks.tone?.status).toBe("failed");
    expect(out.checks.compliance?.status).toBe("flagged"); // the code check still runs
    vi.doUnmock("@/lib/claude");
  });
});
