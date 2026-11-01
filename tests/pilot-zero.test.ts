// Pilot Zero (docs/pilot-zero.md): the Google dry run rules, the builder's
// switch (lib/pilot-zero.ts: only a test restaurant or one on the builder's own
// number can be marked; going live names the profile), Google writes never on
// Auto for a Pilot Zero restaurant, and nothing but the admin console can change
// the switches. Dry run against the mocked Google API: tests/google-live.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dryRunNote, googleDryRun, googleWriteRefused, writeKindForCall, writeKindForDraft } from "@/lib/gate-rules";
import { moneyAndRisk, type RuleDraft } from "@/lib/checks/money";
import { memoryDb } from "./support/memory-db";

describe("the dry run rules", () => {
  test("off for everyone unless set; on by default for a Pilot Zero restaurant", () => {
    expect(googleDryRun({}, "replies")).toBe(false);
    expect(googleDryRun({}, "profile")).toBe(false);
    expect(googleDryRun(null, "replies")).toBe(false);
    expect(googleDryRun({ pilot_zero: true }, "replies")).toBe(true);
    expect(googleDryRun({ pilot_zero: true }, "profile")).toBe(true);
    expect(googleDryRun({ google_dry_run: true }, "replies")).toBe(true);
    expect(googleDryRun({ google_dry_run: true }, "profile")).toBe(true);
  });

  test("Pilot Zero: replies live doesn't make hours and photos live; both switches do", () => {
    expect(googleDryRun({ pilot_zero: true, google_dry_run: false }, "replies")).toBe(false);
    expect(googleDryRun({ pilot_zero: true, google_dry_run: false }, "profile")).toBe(true);
    expect(googleDryRun({ pilot_zero: true, google_profile_writes: true }, "profile")).toBe(true);
    expect(googleDryRun({ pilot_zero: true, google_dry_run: false, google_profile_writes: true }, "profile")).toBe(false);
  });

  test("which writes are profile writes", () => {
    expect(writeKindForDraft("hours_update")).toBe("profile");
    expect(writeKindForDraft("menu_update")).toBe("profile");
    expect(writeKindForDraft("review_reply")).toBe("replies");
    expect(writeKindForDraft("google_post")).toBe("replies");
    expect(writeKindForCall("POST", "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/media")).toBe("profile");
    expect(writeKindForCall("PATCH", "https://mybusinessbusinessinformation.googleapis.com/v1/locations/2?updateMask=regularHours")).toBe("profile");
    expect(writeKindForCall("PUT", "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/g1/reply")).toBe("replies");
    expect(writeKindForCall("DELETE", "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts/p1")).toBe("replies");
  });

  test("the wall: reads always pass, dry-run writes are refused", () => {
    const pilot = { pilot_zero: true, google_dry_run: false };
    expect(googleWriteRefused("GET", { pilot_zero: true }, "https://x/reviews")).toBeNull();
    expect(googleWriteRefused("PUT", pilot, "https://x/reviews/g1/reply")).toBeNull();
    expect(googleWriteRefused("POST", pilot, "https://x/media")).toMatch(/dry run/);
    expect(googleWriteRefused("PUT", { pilot_zero: true }, "https://x/reviews/g1/reply")).toMatch(/dry run/);
    expect(googleWriteRefused("PUT", { is_test: true, google_dry_run: false }, "https://x/reviews/g1/reply")).toMatch(/Test sites/);
  });

  test("the owner's note says 'would have', names the profile, and follows Dina's style rules", () => {
    const notes = [
      dryRunNote({ kind: "review_reply", content: "Thank you!", profile: "Maison Noor" }),
      dryRunNote({ kind: "google_post", content: "Lamb chops are back", profile: "Maison Noor" }),
      dryRunNote({ kind: "hours_update", content: "x" }),
      dryRunNote({ kind: "review_reply", content: "Sorry", simulatedReview: true }),
    ];
    expect(notes[0]).toBe('🧪 Dry run: nothing changed on Google. Would have posted this reply on Google (Maison Noor): "Thank you!"');
    expect(notes[1]).toMatch(/Would have posted this on Google \(Maison Noor\) as a post: "Lamb chops are back"/);
    expect(notes[2]).toMatch(/Would have updated your hours on Google$/);
    expect(notes[3]).toMatch(/^🧪 Simulated review, so never replied to on Google\./);
    for (const n of notes) expect(n).not.toMatch(/[—–]|\bsaved\b|\bI am a person\b/);
    expect(dryRunNote({ kind: "review_reply", content: "x".repeat(500) }).length).toBeLessThan(400);
  });
});

describe("Google writes never go on Auto for a Pilot Zero restaurant", () => {
  const restaurant = { paused: false, discount_cap_percent: 20, send_window_start: "09:00:00", send_window_end: "21:00:00", trust_levels: { review_reply: "auto", google_post: "auto" } };
  const noonUk = new Date("2026-10-09T11:00:00Z");
  const reply: RuleDraft = { kind: "review_reply", version: 1, status: "pending", approved_at: null, sent_at: null, scheduled_for: null, content: "Thank you, Aisha!", agent_check: { mode: "live", verdict: "pass", draft_version: 1 } };

  test("Auto with a live checker pass sends for others, but needs the owner's tap for Pilot Zero", () => {
    expect(moneyAndRisk(reply, restaurant, noonUk, "queue")).toEqual({ outcome: "ok", approvedBy: "auto" });
    expect(moneyAndRisk(reply, { ...restaurant, pilot_zero: true }, noonUk, "queue")).toMatchObject({ outcome: "blocked", reason: "not_approved" });
    expect(moneyAndRisk({ ...reply, kind: "google_post" }, { ...restaurant, pilot_zero: true }, noonUk, "queue")).toMatchObject({ outcome: "blocked", reason: "not_approved" });
    // The owner's Approve still sends it.
    expect(moneyAndRisk({ ...reply, status: "approved", approved_at: "2026-10-09T10:00:00Z" }, { ...restaurant, pilot_zero: true }, noonUk, "approve")).toEqual({ outcome: "ok" });
  });
});

// ---------- The builder's switch ----------

const TEST_SITE = "aaaaaaaa-0000-0000-0000-000000000001";
const MINE = "aaaaaaaa-0000-0000-0000-000000000002"; // on the builder's own number
const REAL = "aaaaaaaa-0000-0000-0000-000000000003"; // a real pilot's restaurant
const EMBER = "11111111-1111-1111-1111-111111111111";
const OLD_DB = "aaaaaaaa-0000-0000-0000-000000000004"; // a database before 056

let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BUILDER_WHATSAPP", "+447463775130");
  const base = { pilot_zero: false, google_dry_run: null, google_profile_writes: null, is_demo: false, is_test: false, google_location_id: null, google_location_title: null };
  db = memoryDb({
    restaurants: [
      { ...base, id: TEST_SITE, name: "Test Hall", is_test: true, is_demo: true, owner_whatsapp: null },
      { ...base, id: MINE, name: "Maison Noor Pilot", owner_whatsapp: "whatsapp:+447463775130", google_location_id: "locations/9", google_location_title: "Maison Noor" },
      { ...base, id: REAL, name: "A real pilot", owner_whatsapp: "whatsapp:+447700900555" },
      { ...base, id: EMBER, name: "Ember & Spice Grill", is_demo: true, owner_whatsapp: "whatsapp:+447700900401" },
      { id: OLD_DB, name: "Before 056", owner_whatsapp: "whatsapp:+447463775130x" },
    ],
    audit_log: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase");
});

const row = (id: string) => db.tables.restaurants.find((r) => r.id === id)!;

describe("marking a restaurant for Pilot Zero", () => {
  test("only a test restaurant or one on the builder's number can be marked; never a real pilot or a demo", async () => {
    const { markPilotZero, pilotZeroOverview } = await import("@/lib/pilot-zero");
    expect((await pilotZeroOverview())!.markable.map((r) => r.id).sort()).toEqual([TEST_SITE, MINE].sort());
    await expect(markPilotZero(REAL, "me@builder.dev")).rejects.toThrow(/can't be your Pilot Zero restaurant/);
    await expect(markPilotZero(EMBER, "me@builder.dev")).rejects.toThrow(/can't be/);
    expect(row(REAL).pilot_zero).toBe(false);
    expect(row(EMBER).pilot_zero).toBe(false);

    await markPilotZero(MINE, "me@builder.dev");
    expect(row(MINE)).toMatchObject({ pilot_zero: true, google_dry_run: null });
    expect(googleDryRun(row(MINE), "replies")).toBe(true);
    expect(db.tables.audit_log).toEqual([expect.objectContaining({ restaurant_id: MINE, actor: "builder", detail: expect.stringMatching(/Marked for Pilot Zero.*dry run/) })]);
  });

  test("on a database before 056 it says so and changes nothing", async () => {
    const { markPilotZero } = await import("@/lib/pilot-zero");
    await expect(markPilotZero(OLD_DB, "me@builder.dev")).rejects.toThrow(/056_pilot_zero/);
    expect("pilot_zero" in row(OLD_DB)).toBe(false);
  });
});

describe("switching Google writes", () => {
  test("going live needs the profile's name typed exactly; back to dry run needs nothing; all logged", async () => {
    const { markPilotZero, setGoogleDryRun } = await import("@/lib/pilot-zero");
    await markPilotZero(MINE, "me@builder.dev");
    const go = (confirm?: string) => setGoogleDryRun({ restaurantId: MINE, kind: "replies", dryRun: false, confirm, builderEmail: "me@builder.dev" });
    await expect(go()).rejects.toThrow(/type the profile's name exactly \(Maison Noor\)/);
    await expect(go("Maison")).rejects.toThrow(/exactly/);
    expect(row(MINE).google_dry_run).toBeNull();

    expect(await go("  maison noor ")).toEqual({ replies: false, profile: true });
    expect(row(MINE).google_dry_run).toBe(false);
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "builder", action: "google", detail: expect.stringMatching(/review replies and posts on Maison Noor: LIVE/) });

    // Hours and photos: their own switch, also named.
    expect(await setGoogleDryRun({ restaurantId: MINE, kind: "profile", dryRun: false, confirm: "Maison Noor", builderEmail: "me@builder.dev" })).toEqual({ replies: false, profile: false });
    expect(row(MINE).google_profile_writes).toBe(true);

    // Back to dry run: no confirmation, and hours follow replies.
    expect(await setGoogleDryRun({ restaurantId: MINE, kind: "replies", dryRun: true, builderEmail: "me@builder.dev" })).toEqual({ replies: true, profile: true });
    expect(db.tables.audit_log.filter((a) => a.action === "google")).toHaveLength(3);
  });

  test("can't go live without a connected profile, or on a restaurant that isn't marked", async () => {
    const { markPilotZero, setGoogleDryRun } = await import("@/lib/pilot-zero");
    await markPilotZero(TEST_SITE, "me@builder.dev");
    await expect(setGoogleDryRun({ restaurantId: TEST_SITE, kind: "replies", dryRun: false, confirm: "", builderEmail: "me@builder.dev" })).rejects.toThrow(/Connect the Google profile first/);
    await expect(setGoogleDryRun({ restaurantId: REAL, kind: "replies", dryRun: true, builderEmail: "me@builder.dev" })).rejects.toThrow(/isn't marked/);
    expect(row(REAL).google_dry_run).toBeNull();
  });
});

// ---------- Only the admin console can change the switches ----------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("nothing on WhatsApp, Dina or the owner's settings can change them", () => {
  test("only lib/pilot-zero.ts writes the columns (others only read them through the rules)", () => {
    const allowed = new Set(["src/lib/pilot-zero.ts", "src/lib/gate-rules.ts", "src/lib/supabase.ts", "src/lib/checks/money.ts"]);
    const offenders = sourceFiles("src")
      .map((p) => p.replace(/\\/g, "/"))
      .filter((p) => !allowed.has(p) && /\b(google_dry_run|google_profile_writes|pilot_zero)\b/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
    // money.ts only reads pilot_zero.
    expect(readFileSync("src/lib/checks/money.ts", "utf8")).not.toMatch(/(google_dry_run|google_profile_writes)/);
  });

  test("they aren't profile fields (so no message, Dina tool or settings form can set them) and UNDO can't restore them", async () => {
    const { PROFILE_FIELDS } = await import("@/lib/profile/fields");
    for (const f of ["pilot_zero", "google_dry_run", "google_profile_writes"]) expect(Object.keys(PROFILE_FIELDS)).not.toContain(f);
    expect(readFileSync("src/lib/undo-plan.ts", "utf8")).not.toMatch(/google_dry_run|google_profile_writes|pilot_zero/);
  });

  test("the admin actions check for the builder", () => {
    const actions = readFileSync("src/app/onboarding/(wizard)/admin/pilot-zero/actions.ts", "utf8");
    expect(actions).toMatch(/if \(!owner\.isBuilder\) throw/);
  });
});
