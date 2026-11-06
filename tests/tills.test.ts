import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/bot/parse";
import { plannedJobs } from "@/lib/queue/rules";
import { dummyOrders } from "@/lib/tills/dummy";
import { mapEposNowTransactions, mapLightspeedSales, mapSquareOrders, mapToastOrders, ukLocalTime } from "@/lib/tills/map";
import { lightspeedBase, liveReady, missingSettings, squareBase } from "@/lib/tills/providers";
import { BACKFILL_DAYS, coversByDay, MAX_DAYS_PER_RUN, syncStatusLine, syncWindow, tillPlaceName, tillRows } from "@/lib/tills/rules";
import { londonYmd } from "@/lib/clock";

// Till connections (lib/tills): each provider's answer read into orders, the
// sync windows, and the sale lines saved (the same shape a POS file gives).

describe("Square orders", () => {
  it("reads completed orders: pence to pounds, variations, custom amounts", () => {
    const orders = mapSquareOrders([
      {
        id: "o1",
        state: "COMPLETED",
        closed_at: "2026-11-05T19:12:00Z",
        line_items: [
          { name: "Mixed grill", variation_name: "Regular", quantity: "2", total_money: { amount: 2900 } },
          { name: "Lassi", variation_name: "Large", quantity: "1", total_money: { amount: 450 } },
          { quantity: "1", total_money: { amount: 500 } },
        ],
      },
      { id: "o2", state: "OPEN", closed_at: null, line_items: [] },
      { id: "o3", state: "CANCELED", closed_at: "2026-11-05T19:00:00Z" },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0].lines).toEqual([
      { item: "Mixed grill", quantity: 2, amount: 29 },
      { item: "Lassi (Large)", quantity: 1, amount: 4.5 },
      { item: "Custom amount", quantity: 1, amount: 5 },
    ]);
  });
});

describe("Epos Now transactions", () => {
  it("reads UK-time dates, product names, discounts; skips held orders", () => {
    const names = new Map([[10, "Chicken wrap"]]);
    const orders = mapEposNowTransactions(
      [
        { Id: 1, DateTime: "2026-07-01T12:30:00", StatusId: 1, TransactionItems: [{ ProductId: 10, UnitPrice: 7.5, Quantity: 2, DiscountAmount: 1 }, { ProductId: 99, UnitPrice: 3, Quantity: 1 }] },
        { Id: 2, DateTime: "2026-07-01T13:00:00", StatusId: 7, TransactionItems: [] },
      ],
      names,
    );
    expect(orders).toHaveLength(1);
    // 12:30 in July is BST: 11:30 UTC.
    expect(orders[0].closedAt.toISOString()).toBe("2026-07-01T11:30:00.000Z");
    expect(orders[0].lines).toEqual([
      { item: "Chicken wrap", quantity: 2, amount: 14 },
      { item: "Other item", quantity: 1, amount: 3 },
    ]);
  });

  it("keeps a time that already says its zone", () => {
    expect(ukLocalTime("2026-01-10T20:00:00Z")?.toISOString()).toBe("2026-01-10T20:00:00.000Z");
    expect(ukLocalTime("2026-01-10T20:00:00")?.toISOString()).toBe("2026-01-10T20:00:00.000Z");
    expect(ukLocalTime("not a date")).toBeNull();
  });
});

describe("Lightspeed sales", () => {
  it("reads sales and refunds, covers, and drops free add-on lines and cancelled sales", () => {
    const orders = mapLightspeedSales([
      {
        accountFiscId: "A1.1",
        receiptId: "R1",
        timeClosed: "2026-11-05T20:00:00Z",
        type: "SALE",
        nbCovers: 4,
        salesLines: [
          { id: "l1", name: "Lamb chops", quantity: "1.000", totalNetAmountWithTax: "14.00" },
          { id: "l2", name: "No onion", quantity: "1", totalNetAmountWithTax: "0", parentLineId: "l1" },
          { id: "l3", name: "Extra cheese", quantity: "1", totalNetAmountWithTax: "1.00", parentLineId: "l1" },
        ],
      },
      { accountFiscId: "A1.2", timeClosed: "2026-11-05T21:00:00Z", type: "REFUND", nbCovers: 4, salesLines: [{ name: "Lamb chops", quantity: "-1", totalNetAmountWithTax: "-14.00" }] },
      { accountFiscId: "A1.3", timeClosed: "2026-11-05T21:00:00Z", type: "SALE", cancelled: true, salesLines: [{ name: "X", quantity: "1", totalNetAmountWithTax: "5" }] },
      { accountFiscId: "A1.4", timeClosed: "2026-11-05T21:00:00Z", type: "VOID", salesLines: [{ name: "X", quantity: "1", totalNetAmountWithTax: "5" }] },
    ]);
    expect(orders.map((o) => o.id)).toEqual(["A1.1", "A1.2:refund"]);
    expect(orders[0].lines.map((l) => l.item)).toEqual(["Lamb chops", "Extra cheese"]);
    expect(orders[0].covers).toBe(4);
    expect(orders[1].covers).toBeNull();
    expect(orders[1].lines[0].amount).toBe(-14);
  });
});

describe("Toast orders", () => {
  it("adds VAT only where the price doesn't include it, skips voided checks and selections", () => {
    const orders = mapToastOrders([
      {
        guid: "g1",
        closedDate: "2026-11-05T19:00:00.000+0000",
        numberOfGuests: 2,
        checks: [
          {
            selections: [
              { displayName: "Burger", quantity: 1, price: 12, tax: 2, taxInclusion: "INCLUDED" },
              { displayName: "Fries", quantity: 1, price: 3, tax: 0.6, taxInclusion: "NOT_INCLUDED" },
              { displayName: "Shake", quantity: 1, price: 5, voided: true },
            ],
          },
          { voided: true, selections: [{ displayName: "Gone", quantity: 1, price: 9 }] },
        ],
      },
      { guid: "g2", closedDate: null },
      { guid: "g3", closedDate: "2026-11-05T19:00:00Z", voided: true },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0].closedAt.toISOString()).toBe("2026-11-05T19:00:00.000Z");
    expect(orders[0].lines).toEqual([
      { item: "Burger", quantity: 1, amount: 12 },
      { item: "Fries", quantity: 1, amount: 3.6 },
    ]);
    expect(orders[0].covers).toBe(2);
  });
});

describe("sync windows", () => {
  const now = new Date("2026-11-05T15:00:00Z");

  it("a new connection reads 90 days back, a month per run, starting at London midnight", () => {
    const w = syncWindow(null, now);
    expect(w.days).toHaveLength(MAX_DAYS_PER_RUN);
    expect(w.days[0]).toBe("2026-08-07"); // 90 days before 5 Nov
    expect(BACKFILL_DAYS).toBe(90);
    expect(w.from.toISOString()).toBe("2026-08-06T23:00:00.000Z"); // BST midnight
    expect(w.caughtUp).toBe(false);
    expect(londonYmd(w.to)).toBe("2026-09-07");
  });

  it("carries on from where it stopped, and finishes at now", () => {
    let through: Date | null = null;
    let runs = 0;
    let w = syncWindow(through, now);
    while (!w.caughtUp && runs < 10) {
      through = w.to;
      w = syncWindow(through, now);
      runs++;
    }
    expect(w.caughtUp).toBe(true);
    expect(w.to).toEqual(now);
    expect(w.days.at(-1)).toBe("2026-11-05");
    expect(runs).toBeLessThanOrEqual(4);
  });

  it("a caught-up connection reads the last two days again", () => {
    const w = syncWindow(new Date("2026-11-05T14:00:00Z"), now);
    expect(w.days).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(w.caughtUp).toBe(true);
  });
});

describe("sale lines from orders", () => {
  const w = { from: new Date("2026-11-04T00:00:00Z"), to: new Date("2026-11-06T00:00:00Z") };
  const orders = [
    { id: "a", closedAt: new Date("2026-11-04T23:30:00Z"), lines: [{ item: "Wrap", quantity: 1, amount: 7 }, { item: "Chips", quantity: 2, amount: 6 }], covers: 2 },
    { id: "a", closedAt: new Date("2026-11-04T23:30:00Z"), lines: [{ item: "Wrap", quantity: 1, amount: 7 }], covers: 2 }, // the same order twice
    { id: "b", closedAt: new Date("2026-11-03T12:00:00Z"), lines: [{ item: "Old", quantity: 1, amount: 1 }], covers: 1 }, // before the window
    { id: "c", closedAt: new Date("2026-11-05T12:00:00Z"), lines: [{ item: "Grill", quantity: 1, amount: 15 }], covers: 3 },
  ];

  it("one row per line, London day and hour, stable keys, no doubles", () => {
    const rows = tillRows("square", "12345678-aaaa", orders, w);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ day: "2026-11-04", hour: 23, item: "Wrap", receipt: "a", row_key: "till:square:12345678:a:0" });
    expect(rows[2]).toMatchObject({ day: "2026-11-05", hour: 12, item: "Grill" });
    expect(tillRows("square", "12345678-aaaa", orders, w)).toEqual(rows);
  });

  it("guests per day", () => {
    expect(Object.fromEntries(coversByDay(orders, w))).toEqual({ "2026-11-04": 4, "2026-11-05": 3 });
  });
});

describe("dummy tills", () => {
  it("makes the same orders from the menu every time, only inside the window", () => {
    const from = new Date("2026-11-02T00:00:00Z");
    const to = new Date("2026-11-04T00:00:00Z");
    const a = dummyOrders("r1", [{ name: "Lamb chops", price: 14 }], from, to);
    expect(a.length).toBeGreaterThan(20);
    expect(a).toEqual(dummyOrders("r1", [{ name: "Lamb chops", price: 14 }], from, to));
    expect(a.every((o) => o.closedAt >= from && o.closedAt < to)).toBe(true);
    expect(a.every((o) => o.lines.every((l) => l.item === "Lamb chops"))).toBe(true);
    expect(dummyOrders("r1", [], from, to).length).toBeGreaterThan(0);
  });
});

describe("providers and settings", () => {
  it("knows what each needs before it can go live", () => {
    expect(missingSettings("square", {})).toEqual(["SQUARE_APPLICATION_ID", "SQUARE_APPLICATION_SECRET", "TILL_TOKEN_KEY"]);
    expect(liveReady("eposnow", { GOOGLE_TOKEN_KEY: "x" })).toBe(true);
    expect(liveReady("toast", { TILL_TOKEN_KEY: "x" })).toBe(false);
  });

  it("uses the test servers unless told production", () => {
    expect(squareBase({}).api).toBe("https://connect.squareupsandbox.com");
    expect(squareBase({ SQUARE_ENVIRONMENT: "production" }).api).toBe("https://connect.squareup.com");
    expect(lightspeedBase({}).api).toBe("https://api.trial.lsk.lightspeed.app");
    expect(lightspeedBase({ LIGHTSPEED_ENVIRONMENT: "production" }).token).toBe("https://auth.lsk-prod.app/realms/k-series/protocol/openid-connect/token");
  });

  it("says where the sync is up to", () => {
    const now = new Date("2026-11-05T15:00:00Z");
    expect(syncStatusLine({ status: "needs_reconnect", last_synced_at: null, last_error: null, synced_through: null }, now)).toMatch(/connect it again/);
    expect(syncStatusLine({ status: "ok", last_synced_at: null, last_error: null, synced_through: null }, now)).toMatch(/first sync/);
    expect(syncStatusLine({ status: "ok", last_synced_at: "2026-11-05T14:30:00Z", last_error: null, synced_through: "2026-11-05T14:30:00Z" }, now)).toBe("✅ Last synced 30 minutes ago.");
    expect(syncStatusLine({ status: "ok", last_synced_at: "2026-11-05T14:59:00Z", last_error: null, synced_through: "2026-09-01T00:00:00Z" }, now)).toMatch(/history/);
  });
});

describe("commands and the hourly job", () => {
  it("TILL and SYNC TILL", () => {
    expect(parseCommand("TILL", 0)).toEqual({ name: "till" });
    expect(parseCommand("sync till", 0)).toEqual({ name: "till_sync" });
    expect(parseCommand("RUN TILL SYNC", 0)).toEqual({ name: "till_sync" });
  });

  it("only restaurants with a till get the hourly till sync", () => {
    const now = new Date("2026-11-05T15:05:00Z");
    const types = (hasTill: boolean) => plannedJobs({ id: "r1", hasOwnerChannel: true, hasTill }, "hourly", now, "done").map((p) => p.type);
    expect(types(true)).toContain("till_sync");
    expect(types(false)).not.toContain("till_sync");
    expect(plannedJobs({ id: "r1", hasOwnerChannel: true, hasTill: true }, "daily", now, "done").map((p) => p.type)).not.toContain("till_sync");
  });
});

describe("till place names", () => {
  it("a repeated part shows once (Square names a one-shop account after its location)", () => {
    expect(tillPlaceName("Default Test Account", "Default Test Account")).toBe("Default Test Account");
    expect(tillPlaceName("Ember & Spice", "default test account", "Ember & Spice")).toBe("Ember & Spice, default test account");
    expect(tillPlaceName("Ember & Spice", "Whitechapel")).toBe("Ember & Spice, Whitechapel");
    expect(tillPlaceName(null, " ", undefined)).toBeNull();
  });
});
