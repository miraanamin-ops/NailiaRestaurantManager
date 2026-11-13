// The founder dashboard's sums (lib/founder/metrics.ts) on made-up histories.
import { describe, expect, test } from "vitest";
import { delta, funnel, healthOf, monthly, mrr, retention, standingAt, timelineFor, type HistoryRow, type HealthSignals } from "@/lib/founder/metrics";
import { alertRestaurantId } from "@/lib/builder-alerts-rules";
import { founderEmails, isFounderEmail } from "@/lib/founder/emails";
import { storePayment } from "@/lib/billing/store-events";
import { weeklyDue, weeklyText } from "@/lib/founder/weekly-rules";

const NOW = new Date("2026-11-13T12:00:00Z");
const s = (restaurant_id: string, at: string, standing: string): HistoryRow => ({ restaurant_id, at, kind: "standing", standing, amount_pence: null, store_fee_pence: null });
const pay = (restaurant_id: string, at: string, pence: number, fee = 0): HistoryRow => ({ restaurant_id, at, kind: "payment", standing: null, amount_pence: pence, store_fee_pence: fee });
const tl = (rows: HistoryRow[], current: string) => timelineFor(rows, current, rows[0]?.at ?? "2026-01-01T00:00:00Z", NOW);

describe("timeline", () => {
  test("history in order, repeats merged, today's standing added if the last event was missed", () => {
    const t = tl([s("a", "2026-09-01", "trialing"), s("a", "2026-10-01", "active"), s("a", "2026-10-02", "active")], "past_due");
    expect(t.map((p) => p.standing)).toEqual(["trialing", "active", "past_due"]);
    expect(standingAt(t, Date.parse("2026-09-15"))).toBe("trialing");
    expect(standingAt(t, Date.parse("2026-08-15"))).toBe("none");
  });
  test("no history: today's standing from sign-up", () => {
    const t = timelineFor([], "pilot", "2026-05-01T00:00:00Z", NOW);
    expect(t).toEqual([{ at: Date.parse("2026-05-01T00:00:00Z"), standing: "pilot" }]);
  });
});

describe("monthly", () => {
  // 10 clients paying since August; one cancels in October.
  const clients = Array.from({ length: 10 }, (_, i) => {
    const rows = [s(`c${i}`, "2026-07-01", "trialing"), s(`c${i}`, "2026-08-01", "active")];
    if (i === 0) rows.push(s("c0", "2026-10-20", "ended"));
    return { timeline: tl(rows, i === 0 ? "ended" : "active"), payments: [pay(`c${i}`, "2026-10-01", i < 5 ? 5000 : 9900)] };
  });
  const months = monthly(clients, NOW, 6);
  const oct = months.find((m) => m.key === "2026-10")!;
  const aug = months.find((m) => m.key === "2026-08")!;
  const jul = months.find((m) => m.key === "2026-07")!;

  test("10 paying, 1 cancels = 10% churn", () => {
    expect(oct.payingAtStart).toBe(10);
    expect(oct.churned).toBe(1);
    expect(oct.churnRate).toBeCloseTo(0.1);
    expect(oct.payingAtEnd).toBe(9);
  });
  test("trials that ended in August all converted; new clients counted in July", () => {
    expect(aug.trialsEnded).toBe(10);
    expect(aug.conversionRate).toBe(1);
    expect(jul.newClients).toBe(10);
    expect(aug.newClients).toBe(0);
  });
  test("revenue is what was paid that month", () => {
    expect(oct.revenuePence).toBe(5 * 5000 + 5 * 9900);
    expect(months.find((m) => m.key === "2026-11")!.revenuePence).toBe(0);
  });
  test("a trial that ended without paying is free-to-paid churn", () => {
    const m = monthly([{ timeline: tl([s("x", "2026-09-01", "trialing"), s("x", "2026-10-01", "ended")], "ended"), payments: [] }], NOW, 3);
    const o = m.find((r) => r.key === "2026-10")!;
    expect([o.trialsEnded, o.converted, o.conversionRate]).toEqual([1, 0, 0]);
    expect(o.churned).toBe(0); // never paid, so not paid churn
  });
});

describe("retention and MRR", () => {
  test("average paid months and still paying after 1 and 3 months", () => {
    const a = tl([s("a", "2026-05-13T12:00:00Z", "active")], "active"); // 6 months so far
    const b = tl([s("b", "2026-08-13T12:00:00Z", "active"), s("b", "2026-09-13T12:00:00Z", "ended")], "ended"); // 1 month
    const c = tl([s("c", "2026-11-01T12:00:00Z", "trialing")], "trialing"); // never paid
    const r = retention([a, b, c], NOW);
    expect(r.payers).toBe(2);
    expect(r.avgMonths).toBeCloseTo((184 + 31) / 2 / 30.4375, 1);
    expect(r.still[1]).toMatchObject({ months: 3, eligible: 2, rate: 0.5 });
  });
  test("MRR uses each payer's last payment, else the list price; store cut taken off after fees", () => {
    const m = mrr(
      [
        { standing: "active", payments: [pay("a", "2026-11-01", 5000)] },
        { standing: "active", payments: [pay("b", "2026-11-02", 9900, 1485)] },
        { standing: "active", payments: [] },
        { standing: "trialing", payments: [] },
      ],
      NOW,
      9900,
    );
    expect(m).toEqual({ pence: 5000 + 9900 + 9900, afterFeesPence: 5000 + 9900 - 1485 + 9900, vatPence: Math.round(24800 / 6), estimated: 1 });
  });
});

describe("health", () => {
  const ok: HealthSignals = {
    standing: "active", active: true, setupFinished: true, paymentFailed: false, googleBroken: false, deadJobs: 0, failedJobs7d: 0, briefMissing: false,
    lastSeenAt: "2026-11-12T10:00:00Z", trialEndsAt: null, approvals7d: 5, setupGaps: 0, unanswered7d: 0, bounces30d: 0, agentsShadow: 0, closing: false,
  };
  test("green when nothing's wrong", () => expect(healthOf(ok, NOW)).toEqual({ light: "green", reasons: [] }));
  test("red for a failed payment or a broken Google login", () => {
    expect(healthOf({ ...ok, standing: "past_due" }, NOW).light).toBe("red");
    expect(healthOf({ ...ok, googleBroken: true }, NOW).reasons[0].text).toMatch(/Google/);
  });
  test("amber when quiet for a week, or a trial ending with little use", () => {
    expect(healthOf({ ...ok, lastSeenAt: "2026-11-01T10:00:00Z" }, NOW).reasons.map((r) => r.text)).toEqual(["Quiet for 12 days"]);
    const trial = healthOf({ ...ok, standing: "trialing", trialEndsAt: "2026-11-15T12:00:00Z", approvals7d: 0 }, NOW);
    expect(trial.light).toBe("amber");
    expect(trial.reasons[0].text).toBe("Trial ends in 2 days with little use");
  });
});

test("funnel counts how far each client got, so it never widens", () => {
  const f = funnel([
    { setupStarted: true, googleLinked: true, menuDone: true, setupFinished: true, firstApproval: true, firstPaid: false },
    { setupStarted: true, googleLinked: false, menuDone: false, setupFinished: false, firstApproval: false, firstPaid: false },
    // An older restaurant: finished and approving, but never through today's Google or menu steps.
    { setupStarted: false, googleLinked: false, menuDone: false, setupFinished: true, firstApproval: true, firstPaid: false },
  ]);
  expect(f.map((x) => x.count)).toEqual([3, 3, 2, 2, 2, 2, 0]);
});

test("delta text", () => {
  expect(delta(12, 10)).toEqual({ dir: "up", text: "+2" });
  expect(delta(10, 10)).toBeNull();
  expect(delta(0.05, 0.1, "rate")?.text).toBe("−5 pts");
});

test("an alert key's restaurant id is found", () => {
  expect(alertRestaurantId("billing:invoice.payment_failed:7E57C0DE-0000-0000-0000-000000000001")).toBe("7e57c0de-0000-0000-0000-000000000001");
  expect(alertRestaurantId("job-stuck:review_check")).toBeNull();
});

test("only FOUNDER_EMAIL (default miraan@dinerai.co.uk) is the founder", () => {
  const env = { FOUNDER_EMAIL: " Miraan@DinerAI.co.uk " };
  expect(founderEmails(env)).toEqual(["miraan@dinerai.co.uk"]);
  expect(isFounderEmail("miraan@dinerai.co.uk", env)).toBe(true);
  expect(isFounderEmail("miraan+x@dinerai.co.uk", env)).toBe(false);
  // Not set: the owner's own address.
  expect(isFounderEmail("miraan@dinerai.co.uk", {})).toBe(true);
  expect(isFounderEmail("someone@dinerai.co.uk", {})).toBe(false);
});

test("an app store paid month is recorded in the owner's currency with the 15% cut", () => {
  expect(storePayment({ id: "e1", type: "RENEWAL", period_type: "NORMAL", price: 125.4, price_in_purchased_currency: 99, currency: "GBP" })).toEqual({
    amountPence: 9900, storeFeePence: 1485, currency: "gbp", externalId: "store:e1",
  });
  expect(storePayment({ id: "e2", type: "INITIAL_PURCHASE", period_type: "TRIAL", price: 0 })).toBeNull();
});

describe("the Monday email", () => {
  test("due from 8am UK on a Monday, once", () => {
    expect(weeklyDue(new Date("2026-11-16T07:59:00Z"), null)).toBeNull(); // 7:59 UK (GMT)
    expect(weeklyDue(new Date("2026-11-16T08:05:00Z"), null)).toBe("2026-11-16");
    expect(weeklyDue(new Date("2026-11-16T09:05:00Z"), "2026-11-16")).toBeNull();
    expect(weeklyDue(new Date("2026-11-17T08:05:00Z"), null)).toBeNull(); // Tuesday
  });
  test("says the headline numbers and who needs a call", () => {
    const month = { label: "Oct 26", newClients: 2, churned: 1, payingAtStart: 10, churnRate: 0.1, trialsEnded: 4, converted: 3, conversionRate: 0.75 };
    const { subject, text } = weeklyText(
      {
        counts: { active: 12, trialing: 3, paying: 8, pilot: 1, inSetup: 2, pastDue: 1 },
        months: [month, { ...month, label: "Nov 26" }],
        mrr: { afterFeesPence: 70000 },
        aiThisMonthUsd: 12.345,
        attention: [{ r: { name: "Ember" }, health: { light: "red", reasons: [{ text: "Payment failed" }] } }],
        trialsEnding: [],
      },
      "https://app.dinerai.co.uk",
    );
    expect(subject).toBe("DinerAI this week: 8 paying, £700 MRR");
    expect(text).toContain("paid churn 10% (1 of 10), trial to paid 75% (3 of 4)");
    expect(text).toContain("- Ember: Payment failed");
    expect(text).toContain("https://app.dinerai.co.uk/admin");
    expect(text.split("\n").some((l, i, all) => l === "" && all[i + 1] === "")).toBe(false);
  });
});

describe("what billing history keeps from a Stripe event", () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, created: 1_760_000_000, data: { object } }) as never;
  test("a paid invoice: amount, VAT and discount in pence", async () => {
    const { stripeHistory } = await import("@/lib/billing/events");
    const h = stripeHistory(ev("invoice.paid", { id: "in_1", amount_paid: 5000, currency: "gbp", total_taxes: [{ amount: 833 }], total_discount_amounts: [{ amount: 4900 }] }));
    expect(h).toEqual({ cancelReason: null, payment: { amountPence: 5000, taxPence: 833, discountPence: 4900, currency: "gbp", externalId: "stripe:in_1" } });
    expect(stripeHistory(ev("invoice.paid", { id: "in_0", amount_paid: 0 })).payment).toBeNull(); // the free month
  });
  test("a cancellation with the owner's reason", async () => {
    const { stripeHistory } = await import("@/lib/billing/events");
    const h = stripeHistory(ev("customer.subscription.updated", { cancel_at_period_end: true, cancellation_details: { feedback: "too_expensive", comment: "Quiet winter" } }));
    expect(h.cancelReason).toBe("too expensive: Quiet winter");
    expect(stripeHistory(ev("customer.subscription.updated", { cancel_at_period_end: false, cancellation_details: { feedback: "too_expensive" } })).cancelReason).toBeNull();
  });
});
