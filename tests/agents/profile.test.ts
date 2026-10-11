// Profile v1: the field registry matches docs/profile-schema.md, each agent sees
// only its fields, every change is a new version, Revert puts one field back,
// and drafts record the profile version they were written with.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { profileChangeProblems } from "@/lib/agents/schema";
import { columnsFor, fieldForColumn, missingPilotFields, PROFILE_FIELD_NAMES, PROFILE_FIELDS, profileFieldRule, profileView } from "@/lib/profile/fields";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

const restaurantRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Ember & Spice Grill",
  address: "1 High St",
  cuisine: "Halal grill",
  website: null,
  owner_name: "Bilal",
  owner_whatsapp: "whatsapp:+447700900111",
  brand_voice: "Warm and proud of the grill",
  menu: [{ category: "Grill", items: [{ name: "Lamb chops", price: 14, allergens: ["milk"], allergens_confirmed: false }] }],
  opening_hours: { Monday: "12:00 – 22:00" },
  phone: "020 7946 0000",
  signup_reward: "Free mango lassi",
  discount_cap_percent: 20,
  send_window_start: "09:00:00",
  send_window_end: "21:00:00",
  logo_url: null,
  brand_color: "#c2410c",
  brand_dark: "#1c1917",
  sign_off_name: null,
  greeting: null,
  complaint_contact: null,
  halal_statement: null,
  allergen_statement: null,
  recovery_offers: [],
  words_to_avoid: [],
  emoji_allowed: null,
  profile_version: 0,
  paused: false,
  ...extra,
});

describe("profile fields", () => {
  test("every field is in docs/profile-schema.md with the same rule", () => {
    const doc = readFileSync("docs/profile-schema.md", "utf8");
    const RULE = { auto: "Auto", confirm: "Confirm", settings: "Settings" };
    for (const name of PROFILE_FIELD_NAMES) {
      const row = doc.split("\n").find((l) => l.startsWith(`| \`${name}\``));
      expect(row, name).toBeTruthy();
      expect(row, name).toContain(`| ${RULE[PROFILE_FIELDS[name].rule]}`);
    }
  });

  test("columns map back to their field", () => {
    expect(fieldForColumn("brand_voice")).toBe("tone_notes");
    expect(fieldForColumn("brand_dark")).toBe("colours");
    expect(fieldForColumn("paused")).toBeNull();
    expect(columnsFor("colours", { brand_color: "#000000" })).toEqual({ brand_color: "#000000" });
    expect(columnsFor("hours", { Monday: "Closed" })).toEqual({ opening_hours: { Monday: "Closed" } });
  });

  test("Reputation sees what it needs and nothing about money or Google settings it doesn't read", () => {
    const view = profileView(restaurantRow(A, { sign_off_name: "Bilal" }), "reputation", (m) => m);
    expect(view).toMatchObject({ name: "Ember & Spice Grill", sign_off_name: "Bilal", tone_notes: "Warm and proud of the grill" });
    expect(view).toHaveProperty("complaint_contact");
    expect(view).toHaveProperty("recovery_offers");
    expect(view).not.toHaveProperty("discount_cap");
    expect(view).not.toHaveProperty("hours");
    expect(view).not.toHaveProperty("owner_whatsapp");
  });

  test("the checker sees every field; the menu always goes through the customer-safe filter", () => {
    const safe = vi.fn(() => "SAFE MENU");
    const view = profileView(restaurantRow(A), "checker", safe);
    expect(Object.keys(view).sort()).toEqual([...PROFILE_FIELD_NAMES].sort());
    expect(view.menu).toBe("SAFE MENU");
    expect(view.emoji_allowed).toEqual({ review_replies: 0, posts: 2, campaigns: 2 });
  });

  test("missing pilot fields are listed", () => {
    const missing = missingPilotFields(restaurantRow(A));
    expect(missing).toEqual(expect.arrayContaining(["sign_off_name", "halal_statement", "complaint_contact", "recovery_offers"]));
    expect(missing).not.toContain("name");
    expect(missing).not.toContain("hours");
  });

  test("the profile keeper's changes are checked against the real fields", () => {
    const change = { type: "profile_change", from: 20, to: 25, evidence: ["dec_1"], summary_line: "Raised the cap." };
    expect(profileChangeProblems({ ...change, section: "controls", field: "discount_cap", apply: "after_owner_confirms" }, profileFieldRule).join()).toMatch(/only in settings/);
    expect(profileChangeProblems({ ...change, section: "voice", field: "greeting", from: "Hi", to: "Salaam", apply: "now" }, profileFieldRule)).toEqual([]);
  });
});

describe("profile versions", () => {
  let db: ReturnType<typeof memoryDb>;
  beforeEach(() => {
    vi.resetModules();
    db = memoryDb({ restaurants: [restaurantRow(A), restaurantRow(B)], profile_versions: [], audit_log: [], drafts: [] });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.doUnmock("@/lib/supabase"));

  const rowOf = (id: string) => db.tables.restaurants.find((r) => r.id === id)!;

  test("a change from settings is a new version, with who and the old and new value", async () => {
    const { saveProfileFields } = await import("@/lib/profile-edits");
    await saveProfileFields({ ...rowOf(A) } as never, { sign_off_name: "Bilal and the team", phone: "020 1111 2222" }, "Changed in settings");
    expect(rowOf(A).profile_version).toBe(2);
    expect(db.tables.profile_versions.map((v) => [v.version, v.field, v.old_value, v.new_value, v.changed_by])).toEqual([
      [1, "sign_off_name", null, "Bilal and the team", "owner"],
      [2, "phone", "020 7946 0000", "020 1111 2222", "owner"],
    ]);
    expect(rowOf(B).profile_version).toBe(0);
  });

  test("settings that aren't profile fields (PAUSE, the test clock) make no version", async () => {
    const { logSetting } = await import("@/lib/audit");
    await logSetting(A, "paused", false, true, "Paused all sending");
    expect(db.tables.profile_versions).toEqual([]);
  });

  test("Revert puts the field back as a new version and marks the change reverted", async () => {
    const { saveProfileFields, revertProfileChange } = await import("@/lib/profile-edits");
    await saveProfileFields({ ...rowOf(A) } as never, { greeting: "Salaam" }, "Changed in settings");
    const first = db.tables.profile_versions[0];
    const result = await revertProfileChange({ ...rowOf(A) } as never, String(first.id));
    expect(result.ok).toBe(true);
    expect(rowOf(A).greeting).toBeNull();
    expect(first.reverted_at).toBeTruthy();
    expect(db.tables.profile_versions[1]).toMatchObject({ version: 2, field: "greeting", old_value: "Salaam", new_value: null, reverts: first.id });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "profile_reverted", actor: "owner" });
  });

  test("Revert is refused once the field has changed again, or for another restaurant's change", async () => {
    const { saveProfileFields, revertProfileChange } = await import("@/lib/profile-edits");
    await saveProfileFields({ ...rowOf(A) } as never, { greeting: "Salaam" }, "Changed in settings");
    await saveProfileFields({ ...rowOf(A) } as never, { greeting: "Hello" }, "Changed in settings");
    const [first] = db.tables.profile_versions;
    expect(await revertProfileChange({ ...rowOf(A) } as never, String(first.id))).toMatchObject({ ok: false, reason: expect.stringMatching(/changed again/) });
    const latest = db.tables.profile_versions[1];
    expect(await revertProfileChange({ ...rowOf(B) } as never, String(latest.id))).toMatchObject({ ok: false });
    expect(rowOf(B).greeting).toBeNull();
  });

  test("Revert is only offered on each field's latest change", async () => {
    const { revertable } = await import("@/lib/profile/versions");
    const v = (id: string, field: string, version: number, reverted_at: string | null = null) => ({ id, field, version, reverted_at }) as never;
    expect([...revertable([v("1", "greeting", 1), v("2", "greeting", 2), v("3", "phone", 3, "x")])]).toEqual(["2"]);
  });

  test("UNDO of a profile change is recorded as a version too", async () => {
    const { saveProfileFields } = await import("@/lib/profile-edits");
    const { undoLast } = await import("@/lib/undo");
    await saveProfileFields({ ...rowOf(A) } as never, { greeting: "Salaam" }, "Changed in settings");
    const text = await undoLast({ ...rowOf(A) } as never, new Date());
    expect(text).toMatch(/greeting is back/);
    expect(rowOf(A).greeting).toBeNull();
    expect(db.tables.profile_versions.at(-1)).toMatchObject({ field: "greeting", old_value: "Salaam", new_value: null });
  });

  test("a new draft records the profile version it was written with", async () => {
    vi.doMock("@/lib/audit", async (orig) => ({ ...(await orig<object>()), logAction: async () => {} }));
    rowOf(A).profile_version = 7;
    const { createDraft } = await import("@/lib/drafts");
    const d = await createDraft({ restaurantId: A, kind: "other", content: "Hi", audience: "Owner", request: null, checks: {}, mode: "hold" });
    expect(d.profile_version).toBe(7);
    vi.doUnmock("@/lib/audit");
  });
});
