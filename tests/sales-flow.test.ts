// Sales, start to finish, against the in-memory database: till report photos
// (saved, confirmed, replaced, unreadable, missing a date), staff numbers, and
// POS files (the column check the first time, straight in the second time).
// Claude is replaced: the tests say what it "read".
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import type { ZRead } from "@/lib/sales/z-check";
import type { PosMapping } from "@/lib/sales/pos-table";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER_A = "whatsapp:+447700900111";
const STAFF_A = "whatsapp:+447700900555";
const SANDBOX = "whatsapp:+14155238886";
const NOW = new Date("2026-10-10T10:00:00Z"); // Saturday morning
const CSV = readFileSync("public/samples/pos-export-sample.csv");

const MAPPING: PosMapping = { date: "Date", time: "Time", item: "Item", quantity: "Qty", price: "Line Total", price_is: "line_total", receipt: "Receipt No", date_order: "dmy" };
const read = (over: Partial<ZRead> = {}): ZRead => ({
  is_till_report: true,
  business_date: "2026-10-08",
  gross_sales: 2808,
  net_sales: 2340,
  vat: 468,
  transactions: 118,
  card: 2312.4,
  cash: 495.6,
  other_payments: null,
  discounts: 42.5,
  refunds: 0,
  hourly: [],
  unclear: [],
  ...over,
});

let db: ReturnType<typeof memoryDb>;
const readZReport = vi.fn(async () => read());
const suggestMapping = vi.fn(async () => ({ mapping: MAPPING, posName: "TillPoint", problem: null }));
const sent: { to: string; text: string }[] = [];

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  readZReport.mockReset().mockResolvedValue(read());
  suggestMapping.mockClear();
  db = memoryDb({
    restaurants: [
      {
        id: A,
        name: "Ember & Spice Grill",
        slug: "ember-spice",
        owner_whatsapp: OWNER_A,
        whatsapp_from: SANDBOX,
        opening_hours: { Friday: "14:00 – 00:00" },
        menu: [],
        paused: false,
        active: true,
        is_demo: true,
      },
    ],
    staff_numbers: [{ id: "s1", restaurant_id: A, whatsapp: STAFF_A, added_at: "2026-10-01T00:00:00Z", removed_at: null }],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/sales/ai", () => ({ readZReport, suggestMapping }));
  vi.doMock("@/lib/notify", () => ({
    messageOwner: async (channel: { to: string }, text: string) => {
      sent.push({ to: channel.to, text });
    },
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/sales/ai");
  vi.doUnmock("@/lib/notify");
});

const replies: string[] = [];
const owner = (number = OWNER_A, role: "owner" | "staff" = "owner") => {
  replies.length = 0;
  return { restaurantId: A, number, role, reply: async (t: string) => void replies.push(t) };
};
const photo = { bytes: Buffer.from("jpeg"), contentType: "image/jpeg" as const };

async function sendPhoto(sender: ReturnType<typeof owner>) {
  const { receiveZReport } = await import("@/lib/sales/z-reports");
  return receiveZReport(sender, photo, "", NOW);
}
async function answer(sender: ReturnType<typeof owner>, body: string) {
  const { salesReply } = await import("@/lib/sales/whatsapp");
  return salesReply(sender, body, NOW);
}
const zRows = () => db.tables.z_reports ?? [];
const day = (d: string) => db.tables.sales_days?.find((r) => r.day === d);

describe("till report photos", () => {
  test("a clean report is saved with a one-line reply, and the photo is kept", async () => {
    const sender = owner();
    expect(await sendPhoto(sender)).toBe(true);
    expect(replies).toEqual(["Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved."]);
    expect(zRows()[0]).toMatchObject({ status: "saved", business_date: "2026-10-08", net_sales: 2340, sent_by: OWNER_A });
    expect(day("2026-10-08")).toMatchObject({ net_sales: 2340, transactions: 118, source: "z_report", is_dummy: false });
    expect([...db.files.keys()][0]).toMatch(new RegExp(`^sales-files/${A}/z-reports/`));
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "sales_saved", actor: "owner" });
  });

  test("numbers that don't add up ask to confirm; YES saves them", async () => {
    readZReport.mockResolvedValue(read({ cash: 355.6 }));
    const sender = owner();
    await sendPhoto(sender);
    expect(replies[0]).toMatch(/doesn't add up/);
    expect(day("2026-10-08")).toBeUndefined();
    expect(await answer(sender, "yes")).toBe(true);
    expect(replies[1]).toBe("Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved.");
    expect(day("2026-10-08")?.net_sales).toBe(2340);
  });

  test("a photo that can't be read asks for another; nothing is saved", async () => {
    readZReport.mockResolvedValue(read({ gross_sales: null, net_sales: null, vat: null, unclear: ["the totals"] }));
    const sender = owner();
    await sendPhoto(sender);
    expect(replies[0]).toMatch(/couldn't read the totals/);
    expect(zRows()[0].status).toBe("unreadable");
    expect(db.tables.sales_days ?? []).toEqual([]);
    expect(await answer(sender, "yes")).toBe(false); // nothing to say yes to: normal chat
  });

  test("no date: asks which day, and 'yesterday' saves it", async () => {
    readZReport.mockResolvedValue(read({ business_date: null }));
    const sender = owner();
    await sendPhoto(sender);
    expect(replies[0]).toMatch(/couldn't see the date/);
    expect(await answer(sender, "yesterday")).toBe(true);
    expect(replies[1]).toBe("Fri 9 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved.");
  });

  test("a second report for the same day asks to replace; REPLACE swaps it, KEEP doesn't", async () => {
    const sender = owner();
    await sendPhoto(sender);
    readZReport.mockResolvedValue(read({ net_sales: 2400, vat: 480, gross_sales: 2880, card: 2384.4, transactions: 121 }));
    await sendPhoto(sender);
    expect(replies.at(-1)).toMatch(/You already sent a report for \*Thu 8 Oct\* \(£2,808\.00 sales, £468\.00 VAT, £2,340\.00 net, 118 transactions\)\. This one says £2,880\.00 sales, £480\.00 VAT, £2,400\.00 net, 121 transactions/);
    expect(await answer(sender, "REPLACE")).toBe(true);
    expect(replies.at(-1)).toBe("Thu 8 Oct: £2,880.00 sales, £480.00 VAT, £2,400.00 net, 121 transactions. Saved.");
    expect(zRows().map((z) => z.status)).toEqual(["replaced", "saved"]);
    expect(day("2026-10-08")?.net_sales).toBe(2400);

    readZReport.mockResolvedValue(read({ net_sales: 1000, vat: 200, gross_sales: 1200, card: 704.4, transactions: 50 }));
    await sendPhoto(sender);
    expect(await answer(sender, "keep")).toBe(true);
    expect(replies.at(-1)).toMatch(/Kept the earlier report/);
    expect(day("2026-10-08")?.net_sales).toBe(2400);
  });

  test("the same report sent twice changes nothing", async () => {
    const sender = owner();
    await sendPhoto(sender);
    await sendPhoto(sender);
    expect(replies.at(-1)).toMatch(/already saved with the same numbers/);
    expect(zRows().filter((z) => z.status === "saved")).toHaveLength(1);
  });

  test("a photo that isn't a till report is passed on (the owner's becomes a Google post)", async () => {
    readZReport.mockResolvedValue(read({ is_till_report: false }));
    expect(await sendPhoto(owner())).toBe(false);
    expect(zRows()).toEqual([]);
  });

  test("the morning brief nudges when yesterday's report is missing", async () => {
    const { zNudgeFor } = await import("@/lib/sales/z-reports");
    const r = db.tables.restaurants[0] as never;
    expect(await zNudgeFor(r, NOW)).toBeNull(); // never sent one: no nudge
    await sendPhoto(owner()); // Thursday's
    expect(await zNudgeFor(r, NOW)).toBe("🧾 No till report for yesterday (Fri 9 Oct) yet. Send a photo of it when you can.");
    readZReport.mockResolvedValue(read({ business_date: "2026-10-09" }));
    await sendPhoto(owner());
    expect(await zNudgeFor(r, NOW)).toBeNull();
  });
});

describe("staff numbers", () => {
  async function staffSays(body: string, media: { url: string; contentType: string } | null = null) {
    vi.doMock("@/lib/photos", async (orig) => ({ ...(await orig<object>()), downloadTwilioMedia: async () => Buffer.from("jpeg") }));
    const { handleStaffMessage } = await import("@/lib/sales/whatsapp");
    await handleStaffMessage({ restaurantId: A, staffNumber: STAFF_A, sandbox: SANDBOX, body, media });
    vi.doUnmock("@/lib/photos");
  }

  test("can send a till report, and gets the reply themselves", async () => {
    await staffSays("", { url: "https://api.twilio.test/media/1", contentType: "image/jpeg" });
    expect(sent).toEqual([{ to: STAFF_A, text: "Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved." }]);
    expect(zRows()[0]).toMatchObject({ sender_role: "staff", sent_by: STAFF_A });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "staff" });
  });

  test("can't do anything else: commands just get the help line", async () => {
    await staffSays("PAUSE");
    await staffSays("Draft an offer for Thursday");
    expect(sent.map((m) => m.text)).toEqual([expect.stringMatching(/can send \*till report photos\*/), expect.stringMatching(/can send \*till report photos\*/)]);
    expect(db.tables.restaurants[0].paused).toBe(false);
    expect(db.tables.drafts ?? []).toEqual([]);
  });

  test("the owner's YES doesn't answer a question asked of a staff member", async () => {
    readZReport.mockResolvedValue(read({ cash: 355.6 }));
    await staffSays("", { url: "https://api.twilio.test/media/1", contentType: "image/jpeg" });
    expect(await answer(owner(), "yes")).toBe(false);
    await staffSays("yes");
    expect(sent.at(-1)?.text).toBe("Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved.");
  });

  test("ADD STAFF, REMOVE STAFF, and UNDO puts them back", async () => {
    const { addStaff, removeStaff } = await import("@/lib/sales/staff");
    const r = db.tables.restaurants[0] as never;
    expect(await addStaff(r, "07700 900666")).toMatch(/Added \*\+44 7700 900666\* as staff/);
    expect(await addStaff(r, "07700 900666")).toMatch(/already on your staff list/);
    expect(await addStaff(r, "+447700900111")).toMatch(/your own number/);
    expect(await removeStaff(r, "+447700900666")).toMatch(/Removed/);
    db.tables.audit_log.at(-1)!.created_at = new Date(Date.now() + 1000).toISOString(); // a moment later
    const { undoLast } = await import("@/lib/undo");
    expect(await undoLast(r, new Date())).toMatch(/back on your staff list/);
    expect((db.tables.staff_numbers ?? []).filter((s) => s.whatsapp === "whatsapp:+447700900666" && !s.removed_at)).toHaveLength(1);
  });
});

describe("POS files", () => {
  async function upload(channel: "web" | "whatsapp" = "whatsapp") {
    const { receivePosFile } = await import("@/lib/sales/pos-import");
    return receivePosFile({ restaurantId: A, bytes: CSV, contentType: "text/csv", fileName: "export.csv", channel, sentBy: OWNER_A, actor: "owner" });
  }

  test("a new layout asks about the columns; YES imports; the next file goes straight in", async () => {
    const first = await upload();
    expect(first.status).toBe("needs_mapping");
    expect(first.message).toMatch(/looks like TillPoint/);
    expect(first.message).toMatch(/Reply \*YES\* to import 522 sales lines \(Mon 5 Oct to Wed 7 Oct\)/);
    expect(db.tables.sales_items ?? []).toEqual([]);

    expect(await answer(owner(), "yes")).toBe(true);
    expect(replies[0]).toBe("📊 Imported 522 sales lines, Mon 5 Oct to Wed 7 Oct (£4,571 including VAT).\n1 row wasn't a sale (totals or blanks).");
    expect(db.tables.sales_items).toHaveLength(522);
    expect(db.tables.pos_layouts).toHaveLength(1);
    const days = db.tables.sales_days.map((d) => [d.day, d.source, d.net_estimated]);
    expect(days).toEqual([
      ["2026-10-05", "pos", true],
      ["2026-10-06", "pos", true],
      ["2026-10-07", "pos", true],
    ]);
    expect(db.tables.sales_days.reduce((s, d) => s + Number(d.transactions), 0)).toBe(212);
    expect((db.tables.sales_hours ?? []).filter((h) => h.day === "2026-10-05").length).toBeGreaterThan(5);

    // The same period again: recognised, and nothing is counted twice.
    const again = await upload("web");
    expect(again).toMatchObject({ status: "imported", message: "📊 Those sales are already in (522 lines, Mon 5 Oct to Wed 7 Oct). Nothing new to add." });
    expect(suggestMapping).toHaveBeenCalledTimes(1);
    expect(db.tables.sales_items).toHaveLength(522);
  });

  test("real data replaces dummy data for the same day, but a till report wins over a POS file", async () => {
    db.tables.sales_days = [
      { id: "d1", restaurant_id: A, day: "2026-10-05", net_sales: 999, source: "seed", is_dummy: true },
      { id: "d2", restaurant_id: A, day: "2026-10-06", net_sales: 1234, source: "z_report", is_dummy: false },
    ];
    db.tables.sales_items = [{ id: "i1", restaurant_id: A, day: "2026-10-05", item: "Dummy", quantity: 5, amount: 50, row_key: "seed:x", is_dummy: true }];
    const first = await upload();
    const { confirmImport } = await import("@/lib/sales/pos-import");
    await confirmImport(A, first.importId!, MAPPING);
    expect(day("2026-10-05")).toMatchObject({ source: "pos", is_dummy: false });
    expect(day("2026-10-06")).toMatchObject({ source: "z_report", net_sales: 1234 });
    expect(db.tables.sales_items.some((i) => i.is_dummy)).toBe(false);
  });

  test("files that aren't sales are turned away politely", async () => {
    const { receivePosFile } = await import("@/lib/sales/pos-import");
    const xls = await receivePosFile({ restaurantId: A, bytes: Buffer.from("d0cf11e0a1b11ae1", "hex"), contentType: "application/vnd.ms-excel", channel: "web", sentBy: null, actor: "owner" });
    expect(xls.message).toMatch(/old Excel file/);
    suggestMapping.mockResolvedValueOnce({ mapping: null as never, posName: null, problem: "It's a customer list." });
    const list = await receivePosFile({ restaurantId: A, bytes: Buffer.from("Name,Email,Phone\nA,a@b.c,1\nB,b@c.d,2\n"), contentType: "text/csv", channel: "web", sentBy: null, actor: "owner" });
    expect(list.message).toBe("I couldn't use that file: It's a customer list.");
  });
});
