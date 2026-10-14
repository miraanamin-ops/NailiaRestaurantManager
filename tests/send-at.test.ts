// Growth's send time: an approved campaign with a send time still ahead waits for
// it, then goes through every rule again; one whose time has passed goes at approval.
import { describe, expect, test } from "vitest";
import { londonSendAt } from "@/lib/campaigns";
import { moneyAndRisk } from "@/lib/checks/money";

const restaurant = { paused: false, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00" };
const draft = { kind: "email_campaign", status: "approved", approved_at: "2026-10-12T09:00:00Z", sent_at: null, scheduled_for: null, content: "A Thursday treat." };

describe("the send time", () => {
  test("London time to a moment, in summer and winter time", () => {
    expect(londonSendAt("2026-10-15T10:00")).toBe("2026-10-15T09:00:00.000Z");
    expect(londonSendAt("2026-11-12T10:00")).toBe("2026-11-12T10:00:00.000Z");
    expect(londonSendAt(null)).toBeNull();
    expect(londonSendAt("Thursday morning")).toBeNull();
  });

  test("ahead: held until then; passed: sent at approval", () => {
    const now = new Date("2026-10-12T11:00:00Z");
    expect(moneyAndRisk({ ...draft, send_at: "2026-10-15T09:00:00.000Z" }, restaurant, now, "approve")).toMatchObject({
      outcome: "queued",
      reason: "scheduled",
      scheduledFor: new Date("2026-10-15T09:00:00.000Z"),
    });
    expect(moneyAndRisk({ ...draft, send_at: "2026-10-12T09:00:00.000Z" }, restaurant, now, "approve")).toMatchObject({ outcome: "ok" });
  });

  test("when the time comes, every rule still applies (PAUSE, the cap)", () => {
    const at = new Date("2026-10-15T09:05:00Z");
    const scheduled = { ...draft, status: "queued", send_at: "2026-10-15T09:00:00.000Z" };
    expect(moneyAndRisk(scheduled, restaurant, at, "queue")).toMatchObject({ outcome: "ok" });
    expect(moneyAndRisk(scheduled, { ...restaurant, paused: true }, at, "queue")).toMatchObject({ outcome: "queued", reason: "paused" });
    expect(moneyAndRisk({ ...scheduled, content: "40% off everything" }, restaurant, at, "queue")).toMatchObject({ outcome: "blocked", reason: "discount_cap" });
  });
});
