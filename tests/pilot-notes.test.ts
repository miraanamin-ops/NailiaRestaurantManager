// The Pilot Zero log (lib/pilot-notes.ts): "#note ..." saved with the simulated
// date when the builder's restaurant is simulating, else today's; a repeat
// delivery noted once; the CSV formula-safe. The webhook side: tests/webhook.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isNoteCommand, noteText } from "@/lib/feeds/builder-parse";
import { memoryDb } from "./support/memory-db";

describe("reading #note", () => {
  test("the text after #note, any case, with or without a colon; nothing to note is null", () => {
    expect(noteText("#note the brief came at 9:02")).toBe("the brief came at 9:02");
    expect(noteText("#NOTE: Dina asked two questions at once")).toBe("Dina asked two questions at once");
    expect(noteText("  #note - rota looked thin on Friday ")).toBe("rota looked thin on Friday");
    expect(noteText("#note")).toBeNull();
    expect(noteText("#notes are great")).toBeNull();
    expect(noteText("my #note")).toBeNull();
    expect(isNoteCommand("#note x")).toBe(true);
    expect(noteText(`#note ${"x".repeat(3000)}`)?.length).toBe(2000);
  });
});

const PZ = "aaaaaaaa-0000-0000-0000-0000000000e1";
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({ restaurants: [{ id: PZ, name: "Pilot Zero Hall", pilot_zero: true, fake_now: null }], pilot_notes: [] }, { unique: ["pilot_notes.message_sid"] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

describe("saving notes", () => {
  test("today's date normally; the simulated date while simulating; a repeat delivery once", async () => {
    const { saveNote } = await import("@/lib/pilot-notes");
    const now = new Date("2026-11-03T23:30:00Z"); // still 3 Nov in London (GMT)
    expect(await saveNote({ body: "#note real day", restaurantId: PZ, messageSid: "SM1", now })).toBe("📝 Noted for 2026-11-03.");
    Object.assign(db.tables.restaurants[0], { fake_now: "2026-11-12T12:00:00Z" });
    expect(await saveNote({ body: "#note simulated Thursday", restaurantId: PZ, messageSid: "SM2", now })).toBe("📝 Noted for 2026-11-12 (simulated day).");
    expect(await saveNote({ body: "#note simulated Thursday", restaurantId: PZ, messageSid: "SM2", now })).toBeNull();
    expect(await saveNote({ body: "#note no restaurant yet", restaurantId: null, messageSid: "SM3", now })).toBe("📝 Noted for 2026-11-03.");
    expect(await saveNote({ body: "#note", restaurantId: PZ, messageSid: "SM4", now })).toMatch(/Nothing to note/);
    expect(db.tables.pilot_notes.map((n) => [n.day, n.simulated, n.note, n.restaurant_id])).toEqual([
      ["2026-11-03", false, "real day", PZ],
      ["2026-11-12", true, "simulated Thursday", PZ],
      ["2026-11-03", false, "no restaurant yet", null],
    ]);
  });

  test("the CSV: oldest first, the restaurant's name, and a note that looks like a formula can't run", async () => {
    const { saveNote, notesCsv } = await import("@/lib/pilot-notes");
    await saveNote({ body: "#note =HYPERLINK(\"x\")", restaurantId: PZ, messageSid: "SM1", now: new Date("2026-11-03T10:00:00Z") });
    await saveNote({ body: "#note second, with a comma", restaurantId: null, messageSid: "SM2", now: new Date("2026-11-03T11:00:00Z") });
    const { csv, count } = await notesCsv();
    expect(count).toBe(2);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Simulated,Restaurant,Note,Written at (UK time)");
    expect(lines[1]).toMatch(/^2026-11-03,No,Pilot Zero Hall,"'=HYPERLINK\(""x""\)",/);
    expect(lines[2]).toMatch(/^2026-11-03,No,,"second, with a comma",/);
  });
});
