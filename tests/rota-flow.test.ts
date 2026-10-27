// The rota suggester end to end against an in-memory database (src/lib/rota/build.ts,
// staff.ts): a team added by WhatsApp wording, next week's draft, plain-English
// edits that re-fill it, approval publishing it on an unguessable link, UNDO,
// and the under-8-weeks fallback. No network: the forecast is the dummy week.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { dummyWeekAhead } from "@/lib/forecast/week-ahead-rules";
import { parseStaffCommand, type StaffInput } from "@/lib/rota/staff-input";

const R = "7e57c0de-0000-4000-8000-000000000000";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-29T10:05:00Z"); // Thursday; next week starts Mon 2 Nov
const TODAY = "2026-10-29";
const WEEK = "2026-11-02";

const restaurant = {
  id: R,
  name: "Test Kitchen",
  slug: "test-kitchen",
  is_demo: true,
  active: true,
  brand_color: "#c2410c",
  opening_hours: { Monday: "12:00 – 22:00", Tuesday: "12:00 – 22:00", Wednesday: "12:00 – 22:00", Thursday: "12:00 – 22:00", Friday: "12:00 – 23:00", Saturday: "12:00 – 23:00", Sunday: "Closed" },
  special_hours: null,
  rota_settings: null,
};

const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function seed(firstSalesDaysAgo: number) {
  return memoryDb({
    restaurants: [restaurant, { ...restaurant, id: OTHER, name: "Other", slug: "other" }],
    sales_days: [{ restaurant_id: R, day: daysAgo(firstSalesDaysAgo), net_sales: 1000 }],
    staff: [],
    staff_pay_rates: [],
    staff_availability: [],
    staff_time_off: [],
    rota_rules: [
      { restaurant_id: R, role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 },
      { restaurant_id: R, role: "front", min_on_shift: 1, orders_per_extra_staff: 15 },
    ],
    rota_weeks: [],
    rota_shifts: [],
    drafts: [],
  });
}

let db: ReturnType<typeof memoryDb>;
const sent: { text: string; buttons: unknown; media?: string | null }[] = [];
const send = async (text: string, buttons: unknown = false, media: string | null = null) => void sent.push({ text, buttons, media });
const logged: { action: string; detail: string; data?: unknown }[] = [];

async function load(firstSalesDaysAgo = 400) {
  vi.resetModules();
  db = seed(firstSalesDaysAgo);
  sent.length = 0;
  logged.length = 0;
  vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/forecast/week-ahead", () => ({ getWeekAhead: vi.fn(async (id: string, ws: string) => dummyWeekAhead(id, ws)) }));
  vi.doMock("@/lib/audit", () => ({ logAction: vi.fn(async (e: { action: string; detail: string; data?: unknown }) => void logged.push(e)) }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: vi.fn(async (_c: unknown, text: string, _b: unknown, o?: { mediaUrl?: string }) => void sent.push({ text, buttons: false, media: o?.mediaUrl ?? null })) }));
  vi.doMock("@/lib/agents/enqueue", () => ({ queueDraftCheck: vi.fn(async () => {}) }));
  vi.doMock("@/lib/profile/versions", () => ({ currentProfileVersion: vi.fn(async () => null) }));
  vi.doMock("@/lib/dummy-data", () => ({ dummyDataAllowed: vi.fn(async () => false) }));
  const build = await import("@/lib/rota/build");
  const staff = await import("@/lib/rota/staff");
  return { build, staff };
}

const add = async (staff: Awaited<ReturnType<typeof load>>["staff"], text: string) => {
  const cmd = parseStaffCommand(text);
  if (cmd?.name !== "add_rota_staff") throw new Error(`not an add: ${text}`);
  return staff.saveStaff(R, cmd.input as StaffInput, { today: TODAY, source: "owner_message", actor: "owner" });
};

async function team(staff: Awaited<ReturnType<typeof load>>["staff"]) {
  await add(staff, "add Ali, kitchen, £12, weekdays");
  await add(staff, "add Bilal, kitchen, £13, every day");
  await add(staff, "add Chen, kitchen, £14, every day");
  await add(staff, "add Sara, front of house, £12, every day");
  await add(staff, "add Dee, front of house, £13, every day");
}

const rows = (t: string) => db.tables[t] ?? [];
const draft = () => rows("drafts").find((d) => d.kind === "rota" && d.status === "pending")!;
const idOf = (name: string) => rows("staff").find((s) => s.display_name === name)!.id as string;
const shiftsOn = (date: string) => rows("rota_shifts").filter((s) => s.business_date === date);

describe("rota suggester flow", () => {
  beforeEach(() => vi.useRealTimers());

  test("staff by WhatsApp: a person, their pay from today and their availability", async () => {
    const { staff } = await load();
    const { member, created } = await add(staff, "add Ali, kitchen, £13, weekdays");
    expect(created).toBe(true);
    expect(member).toMatchObject({ name: "Ali", roles: ["kitchen"], ratePence: 1300, maxHours: null });
    expect(member.availability.map((a) => a.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(staff.memberLine(member)).toBe("- *Ali*: kitchen, £13.00/h; Mon–Fri all day");
    // the same name again updates: a new rate is a new row, the old one stays
    const again = await add(staff, "add Ali, kitchen, £14");
    expect(again.created).toBe(false);
    expect(again.member.ratePence).toBe(1400);
    expect(rows("staff_pay_rates")).toHaveLength(2);
    expect(rows("staff")).toHaveLength(1);
    expect(logged.map((l) => l.action)).toEqual(["rota_staff", "rota_staff"]);
    // a name typed in lower case gets its capitals
    const lower = await staff.saveStaff(R, { name: "bilal o'neil", roles: ["front"], ratePence: 1250, maxHours: null, days: null, starts: null, ends: null }, { today: TODAY, source: "owner_message", actor: "owner" });
    expect(lower.member.name).toBe("Bilal O'Neil");
  });

  test("Thursday: next week's draft, saved as shifts, sent with buttons", async () => {
    const { build, staff } = await load();
    await team(staff);
    const out = await build.suggestRota(restaurant as never, { now: NOW, send, mode: "urgent", actor: "scheduled job", rebuild: false });
    expect(out).toMatchObject({ weekStart: WEEK, basis: "forecast" });
    const week = rows("rota_weeks")[0];
    expect(week).toMatchObject({ restaurant_id: R, week_start: WEEK, status: "draft" });
    expect(draft()).toMatchObject({ kind: "rota", waiting_for: "decision", restaurant_id: R });
    expect(week.draft_id).toBe(draft().id);
    // Sunday is closed; every open day has at least one kitchen and one front of house
    expect(shiftsOn("2026-11-08")).toEqual([]);
    for (const d of ["2026-11-02", "2026-11-06"]) {
      expect(shiftsOn(d).some((s) => s.role === "kitchen")).toBe(true);
      expect(shiftsOn(d).some((s) => s.role === "front")).toBe(true);
    }
    // the cheapest kitchen person (Ali, £12, weekdays) has Monday
    expect(shiftsOn("2026-11-02").filter((s) => s.role === "kitchen").map((s) => s.staff_id)).toContain(idOf("Ali"));
    // UTC times: Monday 12:00 London (GMT in November) = 12:00Z
    expect(shiftsOn("2026-11-02").find((s) => s.staff_id === idOf("Ali"))!.starts_at).toBe("2026-11-02T12:00:00.000Z");
    expect(sent.map((m) => m.buttons)).toEqual([false, true]);
    expect(sent[0].text).toContain("Who's on");
    expect(sent[1].text).toContain("Rota for next week");
    expect(sent[1].text).toMatch(/Labour \*£[\d,]+\* · \*\d+\.\d%\* of forecast sales/);
    // the Thursday job doesn't redo a week that already has a draft
    expect(await build.suggestRota(restaurant as never, { now: NOW, send, mode: "urgent", actor: "scheduled job", rebuild: false })).toEqual({ skipped: `the rota for ${WEEK} is already drafted` });
  });

  test("edits by WhatsApp re-run the fill and resend; anything else isn't an edit", async () => {
    const { build, staff } = await load();
    await team(staff);
    await build.suggestRota(restaurant as never, { now: NOW, send, mode: "present", actor: "owner", rebuild: true });
    sent.length = 0;

    expect(await build.reviseRota(restaurant as never, draft() as never, "Ali can't do Friday", { now: NOW, send, useClaude: false })).toBe(true);
    expect(shiftsOn("2026-11-06").map((s) => s.staff_id)).not.toContain(idOf("Ali"));
    expect(rows("rota_weeks")[0].adjustments).toEqual([{ type: "unavailable", staffId: idOf("Ali"), dates: ["2026-11-06"] }]);
    expect(draft().version).toBe(2);
    expect(sent.at(-1)!.text).toContain("✏️ Changed: Ali off Friday");
    expect(logged.at(-1)).toMatchObject({ action: "edited", data: { before_adjustments: [] } });

    // swap: Sara and Dee change places on Saturday (both front of house)
    const sat = "2026-11-07";
    const before = shiftsOn(sat).filter((s) => [idOf("Sara"), idOf("Dee")].includes(s.staff_id as string)).map((s) => [s.staff_id, s.starts_at]);
    await build.reviseRota(restaurant as never, draft() as never, "swap Sara and Dee on Saturday", { now: NOW, send, useClaude: false });
    const after = shiftsOn(sat).filter((s) => [idOf("Sara"), idOf("Dee")].includes(s.staff_id as string)).map((s) => [s.staff_id, s.starts_at]);
    const swapped = before.map(([id, at]) => [id === idOf("Sara") ? idOf("Dee") : idOf("Sara"), at]);
    expect(after.sort()).toEqual(swapped.sort());
    // the earlier edit still holds
    expect(shiftsOn("2026-11-06").map((s) => s.staff_id)).not.toContain(idOf("Ali"));
    expect(draft().version).toBe(3);

    // not an edit: left for the assistant (on screen), or a hint (after tapping Edit)
    const n = sent.length;
    expect(await build.reviseRota(restaurant as never, draft() as never, "how busy will Friday be?", { now: NOW, send, useClaude: false, quietIfNotEdit: true })).toBe(false);
    expect(sent.length).toBe(n);
    await build.reviseRota(restaurant as never, draft() as never, "Zed can't do Monday", { now: NOW, send, useClaude: false });
    expect(sent.at(-1)!.text).toContain("I don't know *zed*");
    expect(draft().version).toBe(3);

    // UNDO of the swap puts the edits back as they were
    const undoText = await build.restoreRotaEdit(restaurant as never, draft() as never, [{ type: "unavailable", staffId: idOf("Ali"), dates: ["2026-11-06"] }], NOW);
    expect(undoText).toContain("Undone");
    const restored = shiftsOn(sat).filter((s) => [idOf("Sara"), idOf("Dee")].includes(s.staff_id as string)).map((s) => [s.staff_id, s.starts_at]);
    expect(restored.sort()).toEqual(before.sort());
  });

  test("approve publishes it on an unguessable link with a PDF; the team page shows no pay; UNDO switches it off", async () => {
    const { build, staff } = await load();
    await team(staff);
    await build.suggestRota(restaurant as never, { now: NOW, send, mode: "present", actor: "owner", rebuild: true });
    const d = draft();
    sent.length = 0;
    await build.approveRota(restaurant as never, d as never, send, { restaurantId: R, from: "whatsapp:+1", to: "whatsapp:+2" });
    const week = rows("rota_weeks")[0];
    expect(week.status).toBe("published");
    expect(String(week.share_token)).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(rows("drafts").find((x) => x.id === d.id)).toMatchObject({ status: "approved", waiting_for: null });
    expect(sent[0].text).toContain(`https://app.test/rota/${week.share_token}`);
    expect(sent[0].text).toContain(`https://app.test/rota/${week.share_token}/pdf`);
    expect(sent[1].media).toBe(`https://app.test/rota/${week.share_token}/pdf`);

    const found = await build.rotaByToken(String(week.share_token));
    expect(found?.id).toBe(week.id);
    expect(await build.rotaByToken("not-a-real-token-at-all-xx")).toBeNull();
    const { rotaView } = await import("@/lib/rota/view");
    const view = rotaView(found!.summary!, { restaurant: "Test Kitchen", week: "x" });
    expect(JSON.stringify(view)).not.toMatch(/£|pence|cost|labour/i);
    expect(view.people.map((p) => p.name)).toContain("Ali");
    const { renderRotaPdf } = await import("@/lib/rota/pdf");
    const pdf = await renderRotaPdf(view, "#c2410c");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    expect(await build.unpublishRota(restaurant as never, rows("drafts").find((x) => x.id === d.id) as never)).toContain("Undone");
    expect(await build.rotaByToken(String(week.share_token))).toBeNull();
  });

  test("under 8 weeks of sales: opening hours and minimums only, and the draft says so", async () => {
    const { build, staff } = await load(20);
    await team(staff);
    const out = await build.suggestRota(restaurant as never, { now: NOW, send, mode: "present", actor: "owner", rebuild: true });
    expect(out).toMatchObject({ basis: "minimum" });
    expect(sent.at(-1)!.text).toContain("less than 8 weeks of sales history");
    // one kitchen and one front of house (more only where a long day needs two overlapping shifts)
    for (const d of ["2026-11-02", "2026-11-07"]) {
      expect(shiftsOn(d).filter((s) => s.role === "kitchen").length).toBeGreaterThanOrEqual(1);
      const at = (iso: string, role: string) => shiftsOn(d).filter((s) => s.role === role && String(s.starts_at) <= iso && iso < String(s.ends_at)).length;
      expect(at(`${d}T15:00:00.000Z`, "kitchen")).toBe(1);
      expect(at(`${d}T15:00:00.000Z`, "front")).toBe(1);
    }
  });

  test("no team: says how to add one, saves nothing", async () => {
    const { build } = await load();
    await build.suggestRota(restaurant as never, { now: NOW, send, mode: "present", actor: "owner", rebuild: true });
    expect(sent.at(-1)!.text).toContain("add Ali, kitchen, £13, weekdays");
    expect(rows("drafts")).toEqual([]);
    expect(rows("rota_shifts")).toEqual([]);
  });

  test("removing someone takes them off the next rota", async () => {
    const { build, staff } = await load();
    await team(staff);
    expect(await staff.removeStaff(R, idOf("Ali"), { today: TODAY, actor: "owner" })).toBe("Ali");
    expect((await staff.team(R, TODAY)).map((m) => m.name)).not.toContain("Ali");
    await build.suggestRota(restaurant as never, { now: NOW, send, mode: "present", actor: "owner", rebuild: true });
    expect(rows("rota_shifts").map((s) => s.staff_id)).not.toContain(idOf("Ali"));
  });
});

describe("anything the owner says about the team, read by Claude (stubbed here)", () => {
  type Action = Record<string, unknown>;
  const act = (a: Action) => ({ person: null, other_person: null, roles: [], hourly_rate_pounds: null, max_hours_week: null, days: [], from: null, until: null, week: "next", ...a });
  let readings: { actions: Action[]; question: string | null }[] = [];
  const seen: string[] = [];
  let parse: ReturnType<typeof vi.fn>;

  async function loadWithClaude(first = 400) {
    const loaded = await load(first);
    seen.length = 0;
    parse = vi.fn(async (req: { messages: { content: string }[] }) => {
      seen.push(req.messages[0].content);
      const r = readings.shift()!;
      return { stop_reason: "end_turn", parsed_output: { actions: r.actions.map(act), question: r.question } };
    });
    vi.doMock("@/lib/claude", () => ({
      MODEL: "m",
      MAX_TOKENS: 1,
      WITH_FALLBACK: {},
      claude: () => ({ beta: { messages: { parse } } }),
    }));
    const understand = await import("@/lib/rota/understand");
    return { ...loaded, understand };
  }

  test("'add Ali, 12.50£ an hour, available monday to friday all day': no role, so it asks; the answer saves everything", async () => {
    const { understand, staff } = await loadWithClaude();
    readings = [{ actions: [{ kind: "save_person", person: "Ali", hourly_rate_pounds: 12.5, days: [1, 2, 3, 4, 5] }], question: null }];
    expect(await understand.handleTeamMessage(restaurant as never, "add Ali, 12.50£ an hour, available monday to friday all day", { now: NOW, send })).toBe(true);
    expect(sent.at(-1)!.text).toBe("What does Ali do: manager, kitchen, front of house, delivery? (Nothing's saved yet.)");
    expect(rows("staff")).toEqual([]);
    // the owner answers "kitchen": Claude reads it with the recent messages
    readings = [{ actions: [{ kind: "save_person", person: "Ali", roles: ["kitchen"], hourly_rate_pounds: 12.5, days: [1, 2, 3, 4, 5] }], question: null }];
    await understand.handleTeamMessage(restaurant as never, "kitchen", { now: NOW, send });
    expect(sent.at(-1)!.text).toContain("- *Ali*: kitchen, £12.50/h; Mon–Fri all day");
    expect((await staff.team(R, TODAY))[0]).toMatchObject({ name: "Ali", roles: ["kitchen"], ratePence: 1250 });
  });

  test("Claude only gets names and roles, never pay", async () => {
    const { understand, staff } = await loadWithClaude();
    await add(staff, "add Ali, kitchen, £12.50, weekdays");
    readings = [{ actions: [{ kind: "show_team" }], question: null }];
    await understand.handleTeamMessage(restaurant as never, "who's on my team?", { now: NOW, send });
    expect(sent.at(-1)!.text).toContain("*Your rota team*");
    const call = parse.mock.calls[0][0] as { system: string };
    const teamLine = call.system.split("\n").find((l) => l.startsWith("The team now:"));
    expect(teamLine).toBe("The team now: Ali (kitchen).");
  });

  test("a pay rise, someone leaving, and nonsense left for the assistant", async () => {
    const { understand, staff } = await loadWithClaude();
    await add(staff, "add Sara, front of house, £12, every day");
    await add(staff, "add Bilal, front of house, £12, every day");
    readings = [{ actions: [{ kind: "save_person", person: "sara", hourly_rate_pounds: 13 }, { kind: "remove_person", person: "Bilal" }], question: null }];
    await understand.handleTeamMessage(restaurant as never, "Sara's going up to 13 quid an hour and Bilal's left", { now: NOW, send });
    const now = await staff.team(R, TODAY);
    expect(now.map((m) => [m.name, m.ratePence])).toEqual([["Sara", 1300]]);
    readings = [{ actions: [], question: null }];
    expect(await understand.handleTeamMessage(restaurant as never, "thanks!", { now: NOW, send })).toBe(false);
  });

  test("a rota change in any wording re-fills a drafted week; for a week not suggested yet it's kept for Thursday", async () => {
    const { understand, staff, build } = await loadWithClaude();
    await team(staff);
    // not suggested yet: noted on the week
    readings = [{ actions: [{ kind: "cant_work", person: "ali", days: [5] }], question: null }];
    await understand.handleTeamMessage(restaurant as never, "ali's got a wedding on friday so he's out", { now: NOW, send });
    expect(sent.at(-1)!.text).toContain("Noted for Mon 2 – Sun 8 Nov: Ali off Friday");
    expect(rows("rota_weeks")[0].adjustments).toEqual([{ type: "unavailable", staffId: idOf("Ali"), dates: ["2026-11-06"] }]);
    // Thursday's suggestion uses it
    await build.suggestRota(restaurant as never, { now: NOW, send, mode: "urgent", actor: "scheduled job", rebuild: false });
    expect(shiftsOn("2026-11-06").map((s) => s.staff_id)).not.toContain(idOf("Ali"));
    // then another change re-fills the same draft
    const v = draft().version;
    readings = [{ actions: [{ kind: "swap", person: "Sara", other_person: "Dee", days: [6] }], question: null }];
    await understand.handleTeamMessage(restaurant as never, "can sara and dee switch on saturday", { now: NOW, send, rotaOnScreen: true });
    expect(draft().version).toBe(v + 1);
    expect(sent.at(-1)!.text).toContain("Sara ⇄ Dee on Saturday");
  });
});
