// "How was your visit?" emails and what happens to private feedback; double
// opt-in sign-ups; customer data export and deletion. All plain code.
import { describe, expect, test, vi } from "vitest";
import { anonymisedCustomer, csvCell, customersCsv } from "@/lib/customer-csv";
import { briefLines, feedbackDecision, isNegative, negativeAlert, parseRating } from "@/lib/feedback-rules";
import { parseCommand } from "@/lib/bot/parse";
import { isTestCommand } from "@/lib/test-mode";

vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
const { signupPlan, confirmExpired } = await import("@/lib/signups");

const HOUR = 3_600_000;
const due = new Date("2026-10-10T14:00:00Z"); // 3pm UK
const ok = {
  dueAt: due,
  now: new Date(due.getTime() + 10 * 60_000),
  customer: { email: "sam@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null, deleted_at: null },
  lastSentAt: null,
  enabled: true,
  paused: false,
  inSendWindow: true,
};

describe("when a feedback email goes out", () => {
  test("3 hours after the redemption, inside sending hours", () => {
    expect(feedbackDecision(ok)).toEqual({ action: "send" });
    expect(feedbackDecision({ ...ok, now: new Date(due.getTime() - 60_000) }).action).toBe("wait");
  });
  test("at most one per customer every 30 days", () => {
    expect(feedbackDecision({ ...ok, lastSentAt: new Date(ok.now.getTime() - 29 * 24 * HOUR) }).action).toBe("skip");
    expect(feedbackDecision({ ...ok, lastSentAt: new Date(ok.now.getTime() - 31 * 24 * HOUR) }).action).toBe("send");
  });
  test("never to unconfirmed, unsubscribed or deleted customers, or when switched off", () => {
    expect(feedbackDecision({ ...ok, customer: { ...ok.customer, email_confirmed_at: null } }).action).toBe("skip");
    expect(feedbackDecision({ ...ok, customer: { ...ok.customer, unsubscribed_at: "2026-10-02T00:00:00Z" } }).action).toBe("skip");
    expect(feedbackDecision({ ...ok, customer: { ...ok.customer, deleted_at: "2026-10-02T00:00:00Z" } }).action).toBe("skip");
    expect(feedbackDecision({ ...ok, customer: null }).action).toBe("skip");
    expect(feedbackDecision({ ...ok, enabled: false }).action).toBe("skip");
  });
  test("waits for sending hours and PAUSE; gives up if more than a day late", () => {
    expect(feedbackDecision({ ...ok, inSendWindow: false }).action).toBe("wait");
    expect(feedbackDecision({ ...ok, paused: true }).action).toBe("wait");
    expect(feedbackDecision({ ...ok, now: new Date(due.getTime() + 25 * HOUR) }).action).toBe("skip");
  });
});

describe("private feedback", () => {
  test("1-3 stars are negative and reach the owner at once, with the email to reply to", () => {
    expect([1, 2, 3].every(isNegative)).toBe(true);
    expect([4, 5].some(isNegative)).toBe(false);
    const alert = negativeAlert({ rating: 2, comment: "Cold chips", name: "Sam", email: "sam@gmail.com" });
    expect(alert).toContain("2★ from Sam");
    expect(alert).toContain('"Cold chips"');
    expect(alert).toContain("sam@gmail.com");
  });
  test("4-5 stars wait for the brief", () => {
    expect(briefLines([])).toEqual([]);
    expect(briefLines([{ rating: 5, comment: "Lovely lamb", name: "Sam" }])).toEqual(["💬 *Private feedback since yesterday:*", '- Sam ⭐⭐⭐⭐⭐: _"Lovely lamb"_']);
  });
  test("ratings must be 1 to 5", () => {
    expect(parseRating("4")).toBe(4);
    expect(parseRating("0")).toBeNull();
    expect(parseRating("6")).toBeNull();
    expect(parseRating("2.5")).toBeNull();
    expect(parseRating(null)).toBeNull();
  });
});

describe("double opt-in sign-ups", () => {
  const confirmed = { email_confirmed_at: "2026-10-01T00:00:00Z", marketing_opt_in: true, unsubscribed_at: null };
  test("new and unconfirmed people get the confirm email", () => {
    expect(signupPlan(null, true)).toBe("new");
    expect(signupPlan({ ...confirmed, email_confirmed_at: null }, false)).toBe("reconfirm");
  });
  test("a confirmed customer ticking the box for the first time confirms that too", () => {
    expect(signupPlan({ ...confirmed, marketing_opt_in: false }, true)).toBe("consent_confirm");
    expect(signupPlan({ ...confirmed, unsubscribed_at: "2026-10-02T00:00:00Z" }, true)).toBe("consent_confirm");
    expect(signupPlan(confirmed, true)).toBe("repeat");
    expect(signupPlan({ ...confirmed, marketing_opt_in: false }, false)).toBe("repeat");
  });
  test("confirm links work for 7 days", () => {
    const sent = "2026-10-01T12:00:00Z";
    expect(confirmExpired({ confirm_sent_at: sent, email_confirmed_at: null }, new Date("2026-10-08T11:00:00Z"))).toBe(false);
    expect(confirmExpired({ confirm_sent_at: sent, email_confirmed_at: null }, new Date("2026-10-08T13:00:00Z"))).toBe(true);
    expect(confirmExpired({ confirm_sent_at: sent, email_confirmed_at: sent }, new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("customer data", () => {
  test("the export is a safe CSV: formulas can't run, commas and quotes are escaped", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell(null)).toBe("");
    const csv = customersCsv([
      { name: "Sam", email: "sam@gmail.com", phone: null, birthday: "1990-10-12", source: "signup", created_at: "2026-10-01T10:00:00Z", email_confirmed_at: "2026-10-01T10:05:00Z", marketing_opt_in: true, unsubscribed_at: null, visit_count: 2, last_visit: "2026-10-09", reward_redeemed_at: "2026-10-02T19:00:00Z" },
      { name: "Jo", email: "jo@gmail.com", phone: null, birthday: null, source: "signup", created_at: "2026-10-03T10:00:00Z", email_confirmed_at: null, marketing_opt_in: true, unsubscribed_at: null, visit_count: 0, last_visit: null, reward_redeemed_at: null },
    ]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Name,Email,Phone,Birthday,Signed up,How they joined,Email confirmed,Gets marketing emails,Unsubscribed,Visits,Last visit,Welcome reward used");
    expect(lines[1]).toBe("Sam,sam@gmail.com,,1990-10-12,2026-10-01,Sign-up form,Yes,Yes,,2,2026-10-09,2026-10-02");
    expect(lines[2]).toContain(",No,No,"); // unconfirmed: no marketing emails
  });
  test("deleting keeps nothing that identifies the person", () => {
    const a = anonymisedCustomer(new Date("2026-10-10T12:00:00Z"));
    expect(a).toMatchObject({ name: "Deleted customer", email: null, phone: null, birthday: null, notes: null, marketing_opt_in: false, confirm_token: null });
    expect(a.deleted_at).toBe("2026-10-10T12:00:00.000Z");
  });
});

describe("WhatsApp commands", () => {
  test("EXPORT CUSTOMERS, EMAIL PREVIEWS, RUN FEEDBACK", () => {
    expect(parseCommand("export customers", 6)).toEqual({ name: "export_customers" });
    expect(parseCommand("EXPORT MY CUSTOMER LIST", 6)).toEqual({ name: "export_customers" });
    expect(parseCommand("Email previews", 6)).toEqual({ name: "email_previews" });
    expect(parseCommand("RUN FEEDBACK", 6)).toEqual({ name: "run_feedback" });
    expect(isTestCommand("run_feedback")).toBe(true);
    expect(isTestCommand("export_customers")).toBe(false);
  });
});
