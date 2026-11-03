import { describe, expect, test } from "vitest";
import { betterDataLine, parseTypedTakings, typedConfirmQuestion, typedRead, typedSavedLine } from "@/lib/sales/typed";
import { checkZReport } from "@/lib/sales/z-check";

const TODAY = "2026-11-04"; // a Wednesday
const MORNING = 10;
const EVENING = 22;
const p = (body: string, hour = MORNING) => parseTypedTakings(body, TODAY, hour);

describe("a day's sales typed on WhatsApp", () => {
  test("the usual ways of saying it", () => {
    expect(p("we took £2,340 yesterday, 180 orders")).toEqual({ business_date: "2026-11-03", amount: 2340, basis: "gross", transactions: 180 });
    expect(p("£2,340, 180 orders")).toEqual({ business_date: "2026-11-03", amount: 2340, basis: "gross", transactions: 180 });
    expect(p("Takings 1850.50")).toEqual({ business_date: "2026-11-03", amount: 1850.5, basis: "gross", transactions: null });
    expect(p("sales yesterday £1,920 net, 140 transactions")).toEqual({ business_date: "2026-11-03", amount: 1920, basis: "net", transactions: 140 });
    expect(p("did 2.3k on Monday")).toEqual({ business_date: "2026-11-02", amount: 2300, basis: "gross", transactions: null });
    expect(p("Saturday's takings £3,105 ex VAT")).toMatchObject({ business_date: "2026-10-31", amount: 3105, basis: "net" });
    expect(p("£1,200 on 1 Nov")).toMatchObject({ business_date: "2026-11-01", amount: 1200 });
    expect(p("z report 2/11 £1,450")).toMatchObject({ business_date: "2026-11-02", amount: 1450 });
    expect(p("£2,340")).toMatchObject({ business_date: "2026-11-03", amount: 2340 });
    expect(p("we took 2340 pounds, 95 covers")).toMatchObject({ amount: 2340, transactions: null }); // covers are guests, not orders
  });

  test("no day given: yesterday in the morning, today in the evening (the night's takings)", () => {
    expect(p("£2,340", MORNING)?.business_date).toBe("2026-11-03");
    expect(p("£2,340", EVENING)?.business_date).toBe("2026-11-04");
    expect(p("took £2,340 tonight", MORNING)?.business_date).toBe("2026-11-04");
    expect(p("took £2,340 last night", EVENING)?.business_date).toBe("2026-11-03");
  });

  test("chat is left alone: questions, offers, costs, other periods, two amounts, menus", () => {
    for (const body of [
      "how much did we take yesterday?",
      "what were sales on Friday",
      "send a £5 off offer for Thursday",
      "20% off mains on Monday",
      "wages were £800 yesterday",
      "we took £14,000 last week",
      "add lamb chops, £14",
      "change the reward to a £5 voucher",
      "Thursday is quiet",
      "£2,340 gross and £1,950 net",
      "Aisha can't do Friday",
      "add Ali, kitchen, £13, weekdays",
      "yes",
      "made £300 profit from the campaign",
      "the new grill cost £2,000 but it's worth it for the kitchen",
      "took £2,340 next friday",
    ]) {
      expect(p(body), body).toBeNull();
    }
  });

  test("read as a till report would be, so the same checks apply (VAT worked out at 20%)", () => {
    const typed = p("we took £2,340 yesterday, 180 orders")!;
    const result = checkZReport(typedRead(typed), TODAY);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.figures).toMatchObject({ gross_sales: 2340, net_sales: 1950, transactions: 180, net_estimated: true });
    expect(typedConfirmQuestion(result.figures, [], TODAY, "daily")).toBe(
      [
        "🧾 *Tue 3 Nov*: £2,340.00 including VAT (about £1,950.00 before VAT), 180 orders. Save it?",
        'Reply *YES* to save it, or *NO*. If £2,340.00 was before VAT, reply *NO* and type it with "net". Another day? Reply with the day, e.g. *Monday*.',
        "💡 Even better: your till's sales-by-item export (CSV or Excel), or failing that sales by the hour, shows which dishes and hours make you the most, so I can find you more profit. Send it here whenever you can.",
      ].join("\n"),
    );
    expect(typedSavedLine(result.figures, TODAY)).toBe("Tue 3 Nov: £2,340.00 including VAT (about £1,950.00 before VAT), 180 orders. Saved. 👍");
  });

  test("the better-data tip: item sales first, then by the hour; nothing for restaurants already sending item sales", () => {
    expect(betterDataLine("items")).toBeNull();
    expect(betterDataLine("hours")).toContain("sales-by-item export (CSV or Excel) shows");
    expect(betterDataLine("none")).toContain("or failing that sales by the hour");
  });
});
