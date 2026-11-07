import { describe, expect, test } from "vitest";
import {
  ago,
  birthdayOn,
  busyness,
  changeLabel,
  compare,
  decidableOnWeb,
  firstName,
  greeting,
  heatmap,
  initials,
  plainText,
  shortName,
  sparkPath,
  todaySummary,
  topDishes,
  weatherWords,
} from "@/lib/dashboard/rules";

describe("comparisons", () => {
  test("percent and direction", () => {
    expect(compare(106, 100)).toEqual({ now: 106, before: 100, pct: 6, dir: "up" });
    expect(compare(5, 0).pct).toBeNull();
    expect(compare(3, 3).dir).toBe("same");
  });
  test("labels", () => {
    expect(changeLabel(compare(106, 100))).toBe("▲ 6%");
    expect(changeLabel(compare(26, 29), "diff")).toBe("▼ 3");
    expect(changeLabel(compare(4.6, 4.5), "diff")).toBe("▲ 0.1");
    expect(changeLabel(compare(4, 0))).toBe("▲ 4");
    expect(changeLabel(compare(2, 2))).toBe("Same as last week");
  });
});

describe("names and greetings", () => {
  test("greeting by London hour", () => {
    expect(greeting(9)).toBe("Morning");
    expect(greeting(14)).toBe("Afternoon");
    expect(greeting(20)).toBe("Evening");
  });
  test("names", () => {
    expect(firstName("ahmed khan")).toBe("Ahmed");
    expect(firstName(null)).toBeNull();
    expect(initials("Ahmed Khan")).toBe("AK");
    expect(initials("")).toBe("?");
    expect(shortName("Priya Sharma")).toBe("Priya S.");
    expect(shortName("Daniel")).toBe("Daniel");
  });
});

describe("today", () => {
  test("busyness against a normal day", () => {
    expect(busyness(40, 60)).toBe("quiet");
    expect(busyness(80, 60)).toBe("busy");
    expect(busyness(60, 60)).toBe("normal");
    expect(busyness(null, 60)).toBe("unknown");
    expect(busyness(0, 60)).toBe("closed");
  });
  test("summary sentence", () => {
    expect(todaySummary({ waiting: 2, urgent: 0, forecastOrders: 40, busy: "quiet", event: "West Ham v Arsenal" })).toBe(
      "A quieter day than usual is expected, and 2 things are waiting for you. West Ham v Arsenal today.",
    );
    expect(todaySummary({ waiting: 3, urgent: 1, forecastOrders: null, busy: "unknown", event: null })).toBe("1 thing needs attention now.");
    expect(todaySummary({ waiting: 0, urgent: 0, forecastOrders: null, busy: "unknown", event: null })).toBe("Nothing is waiting for you.");
  });
});

describe("web decisions", () => {
  test("drafts the website may approve or skip", () => {
    expect(decidableOnWeb({ kind: "review_reply" })).toBe(true);
    expect(decidableOnWeb({ kind: "email_campaign" })).toBe(true);
    expect(decidableOnWeb({ kind: "review_question" })).toBe(false);
    expect(decidableOnWeb({ kind: "rota" })).toBe(false);
    expect(decidableOnWeb({ kind: "profile_change" })).toBe(false);
    expect(decidableOnWeb({ kind: "review_reply", business_review_id: "x" })).toBe(false);
  });
  test("WhatsApp formatting comes off", () => {
    expect(plainText("✅ *Approved* and _sent_.")).toBe("✅ Approved and sent.");
  });
});

describe("shapes", () => {
  test("sparkline path", () => {
    expect(sparkPath([1])).toBe("");
    expect(sparkPath([0, 10], 100, 28)).toBe("M0.0 26.0 L100.0 2.0");
  });
  test("heatmap levels", () => {
    const h = heatmap([
      { weekday: 4, hour: 19, value: 100 },
      { weekday: 0, hour: 19, value: 30 },
      { weekday: 0, hour: 9, value: 999 }, // outside the hours shown
    ]);
    expect(h.hours[0]).toBe(12);
    expect(h.levels[4][7]).toBe(4);
    expect(h.levels[0][7]).toBe(2);
    expect(h.levels[1][0]).toBe(0);
    expect(heatmap([]).empty).toBe(true);
  });
  test("top dishes by money", () => {
    const top = topDishes([
      { item: "Lamb chops", quantity: 2, amount: 28 },
      { item: "Wings", quantity: 5, amount: 25 },
      { item: "lamb chops ", quantity: 1, amount: 14 },
    ]);
    expect(top[0]).toEqual({ item: "Lamb chops", sold: 3, amount: 42 });
    expect(top).toHaveLength(2);
  });
});

describe("dates", () => {
  test("ago", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(ago("2026-11-07T10:00:00Z", now)).toBe("2 hours ago");
    expect(ago("2026-11-06T12:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-11-07T11:59:50Z", now)).toBe("just now");
  });
  test("weather words", () => {
    expect(weatherWords(0)).toBe("Clear");
    expect(weatherWords(63)).toBe("Rain");
    expect(weatherWords(null)).toBeNull();
  });
  test("birthday on a day, any year", () => {
    expect(birthdayOn("1990-11-07", "2026-11-07")).toBe(true);
    expect(birthdayOn(null, "2026-11-07")).toBe(false);
  });
});

describe("sales headline", () => {
  test("top two days and the gap", async () => {
    const { salesHeadline } = await import("@/lib/dashboard/rules");
    const week = [
      { day: "2026-11-02", net: 700 }, // Mon
      { day: "2026-11-03", net: 600 }, // Tue
      { day: "2026-11-04", net: 900 },
      { day: "2026-11-05", net: 650 }, // Thu
      { day: "2026-11-06", net: 2200 }, // Fri
      { day: "2026-11-07", net: 2600 }, // Sat
      { day: "2026-11-08", net: 800 },
    ];
    expect(salesHeadline(week)).toBe("Friday and Saturday did 57% of the takings. Tuesday and Thursday were the quietest.");
    expect(salesHeadline(week.slice(0, 3))).toBeNull();
  });
});
