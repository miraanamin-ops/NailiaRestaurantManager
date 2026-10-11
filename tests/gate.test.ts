// The release gate's new rules (agent organisation, phase 1): trust levels,
// TEST_MODE as a gate step, and the 7-day campaign limit. Plain code only.
import { describe, expect, test } from "vitest";
import { moneyAndRisk, type RuleDraft } from "@/lib/checks/money";
import { checkerPassed, gateApproval, looksLikeOffer, NEVER_AUTO, TASKS, trustLevel } from "@/lib/trust";

const restaurant = { paused: false, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00" };
const noonUk = new Date("2026-10-09T11:00:00Z");
const livePass = { mode: "live", verdict: "pass", draft_version: 1 };
const reply: RuleDraft = {
  kind: "review_reply",
  version: 1,
  status: "pending",
  approved_at: null,
  sent_at: null,
  scheduled_for: null,
  content: "Thank you, Aisha! See you again soon. Bilal",
  agent_check: livePass,
};

describe("trust levels", () => {
  test("every task defaults to Approve", () => {
    for (const task of TASKS) expect(trustLevel({}, task)).toBe("approve");
    expect(trustLevel(null, "review_reply")).toBe("approve");
    expect(trustLevel({ review_reply: "nonsense" }, "review_reply")).toBe("approve");
  });

  test("campaigns, offers, hours, menu and profile changes can never be Auto, whatever is stored", () => {
    for (const task of ["email_campaign", "promotion", "birthday_batch", "hours_update", "menu_update", "profile_change"] as const) {
      expect(NEVER_AUTO.has(task)).toBe(true);
      expect(trustLevel({ [task]: "auto" }, task)).toBe("approve");
    }
  });

  test("on Approve, nothing sends without the owner's tap (even if the checker passed)", () => {
    expect(moneyAndRisk(reply, restaurant, noonUk, "approve")).toMatchObject({ outcome: "blocked", reason: "not_approved" });
  });

  test("on Auto, a draft the live checker passed goes out without a tap", () => {
    const r = moneyAndRisk(reply, { ...restaurant, trust_levels: { review_reply: "auto" } }, noonUk, "queue");
    expect(r).toEqual({ outcome: "ok", approvedBy: "auto" });
  });

  test("Auto needs a live checker pass on this exact version", () => {
    const auto = { ...restaurant, trust_levels: { review_reply: "auto" } };
    expect(moneyAndRisk({ ...reply, agent_check: null }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(moneyAndRisk({ ...reply, agent_check: { ...livePass, mode: "shadow" } }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(moneyAndRisk({ ...reply, agent_check: { ...livePass, verdict: "fail" } }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(moneyAndRisk({ ...reply, version: 2 }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(checkerPassed({ ...reply, agent_check: { ...livePass, draft_version: 2 }, version: 2 })).toBe(true);
  });

  test("anything that reads as an offer never goes on Auto", () => {
    const auto = { ...restaurant, trust_levels: { review_reply: "auto", google_post: "auto" } };
    expect(moneyAndRisk({ ...reply, content: "Sorry! Free dessert on your next visit." }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(moneyAndRisk({ ...reply, kind: "google_post", content: "15% off grills this week" }, auto, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
    expect(looksLikeOffer("Half-price lassi")).toBe(true);
    expect(looksLikeOffer("Lamb chops, marinated for 24 hours")).toBe(false);
  });

  test("a campaign stored as Auto still needs the owner's tap", () => {
    const campaign = { ...reply, kind: "email_campaign", content: "New menu this week" };
    expect(moneyAndRisk(campaign, { ...restaurant, trust_levels: { email_campaign: "auto" } }, noonUk, "queue")).toMatchObject({ reason: "not_approved" });
  });

  test("Draft only: never sent, even after an Approve", () => {
    const approved = { ...reply, status: "approved", approved_at: "2026-10-09T10:00:00Z" };
    expect(moneyAndRisk(approved, { ...restaurant, trust_levels: { review_reply: "draft_only" } }, noonUk, "approve")).toMatchObject({
      outcome: "blocked",
      reason: "trust_level",
    });
  });

  test("Auto still obeys the other rules: PAUSE, sending hours, the cap, duplicates", () => {
    const auto = { ...restaurant, trust_levels: { review_reply: "auto" } };
    expect(moneyAndRisk(reply, { ...auto, paused: true }, noonUk, "queue")).toMatchObject({ outcome: "queued", reason: "paused" });
    expect(moneyAndRisk(reply, auto, new Date("2026-10-09T21:30:00Z"), "queue")).toMatchObject({ outcome: "queued", reason: "outside_window" });
    expect(moneyAndRisk({ ...reply, status: "sent", sent_at: "2026-10-09T10:00:00Z" }, auto, noonUk, "queue")).toMatchObject({ reason: "duplicate" });
  });

  test("an owner's Approve still works as before", () => {
    expect(gateApproval({ ...reply, approved_at: "2026-10-09T10:00:00Z" }, {})).toEqual({ ok: true, by: "owner" });
  });
});

describe("who can set trust levels", () => {
  test("an owner can't: only the builder", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ currentOwner: async () => ({ email: "owner@x.test", isBuilder: false, restaurantIds: ["r1"], allowed: true }) }));
    const { saveBuilderControls } = await import("@/app/settings/actions");
    const form = new FormData();
    form.set("r", "r1");
    form.set("trust_review_reply", "auto");
    await expect(saveBuilderControls(form)).rejects.toThrow(/Only the builder/);
    vi.doUnmock("@/lib/auth");
  });
});

describe("TEST_MODE as a gate step", () => {
  test("in test mode nothing is posted to live Google", async () => {
    const { testModeStep } = await import("@/lib/gate-rules");
    expect(testModeStep({ testMode: true, channel: "google", googleMode: "live" })).toMatchObject({ outcome: "simulate" });
    expect(testModeStep({ testMode: true, channel: "google", googleMode: "dummy" })).toMatchObject({ outcome: "ok" });
    expect(testModeStep({ testMode: false, channel: "google", googleMode: "live" })).toMatchObject({ outcome: "ok" });
  });

  test("emails go through the existing test routing (builder and owner only)", async () => {
    const { testModeStep } = await import("@/lib/gate-rules");
    const { routeEmail } = await import("@/lib/email/route");
    expect(testModeStep({ testMode: true, channel: "email", googleMode: "dummy" })).toMatchObject({ outcome: "ok" });
    expect(routeEmail("real.customer@gmail.com", { testMode: true, allowed: ["owner@x.co.uk"], builder: "builder@x.co.uk" })).toEqual({
      kind: "send",
      to: "builder@x.co.uk",
      redirectedFrom: "real.customer@gmail.com",
    });
  });

  test("WhatsApp to customers is off until Meta verification, test mode or not", async () => {
    const { channelFor, testModeStep } = await import("@/lib/gate-rules");
    expect(channelFor("promotion")).toBe("whatsapp");
    expect(testModeStep({ testMode: false, channel: "whatsapp", googleMode: "dummy" })).toMatchObject({ outcome: "simulate" });
  });
});

describe("TEST_MODE inside attemptSend", () => {
  test("with live Google in test mode, an approved reply is logged as simulated and never posted", async () => {
    const { vi } = await import("vitest");
    const { memoryDb } = await import("./support/memory-db");
    vi.resetModules();
    const A = "aaaaaaaa-0000-0000-0000-000000000001";
    const db = memoryDb({
      restaurants: [{ id: A, ...restaurant, trust_levels: {} }],
      drafts: [
        {
          id: "d1", restaurant_id: A, kind: "review_reply", review_id: "rv1", content: "Thank you, Aisha!", audience: "Google review by Aisha",
          status: "approved", approved_at: "2026-10-09T10:00:00Z", sent_at: null, scheduled_for: null, version: 1, checks: {}, customer_id: null,
        },
      ],
      sent_log: [],
      audit_log: [],
      blocked_sends: [],
    });
    const replyToReview = vi.fn();
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/google", () => ({ google: () => ({ mode: "live", replyToReview, publishPost: vi.fn() }) }));
    vi.stubEnv("TEST_MODE", "true");
    const { attemptSend } = await import("@/lib/send");
    const result = await attemptSend("d1", db.tables.restaurants[0] as never, noonUk, "approve");
    expect(result.outcome).toBe("sent");
    expect(replyToReview).not.toHaveBeenCalled();
    expect(db.tables.sent_log[0]).toMatchObject({ simulated: true });
    expect(JSON.stringify(db.tables.drafts[0].checks)).toContain("not posted to the live Google listing");
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/google");
  });
});
