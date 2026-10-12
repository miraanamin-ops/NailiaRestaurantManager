// Visibility in shadow mode, with a stand-in Claude: the weekly post, photos
// (into the library, usable or not), the go-live checklist, and the comparison.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { missingForGoLive } from "@/lib/profile/fields";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const LONG = "Our Lamb Chops are marinated in yoghurt and spices, then finished over real charcoal until they're smoky at the edges. Four pieces for £13.95, with warm Garlic Naan and Masala Chips on the side if you're hungry. Bring the family this week and make an evening of it. We'd love to see you.";
const CHECKS = ["T1", "T2", "T3", "T4", "T5", "F1", "F2", "F3", "F4", "F5", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "B1", "B2", "B3", "B4"];
const passOn = (ids: string[]) => ({ verdict: "pass", checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })), minor_fixes: [], owner_question: null, notes: "" });
const pass = passOn(CHECKS);
// A profile change gets the facts checks and C1 only.
const profilePass = passOn(["F1", "F2", "F3", "F4", "F5", "C1"]);
const draft = (extra: Record<string, unknown> = {}) => ({
  type: "google_post", channel: "google", content: { text: LONG, cta: "Book", hashtags: [] }, photo_id: null, change: null, publish_at: null,
  photo_check: null, shoots: [], needs_owner_input: null, sources_used: ["profile:menu"], ...extra,
});

let db: ReturnType<typeof memoryDb>;
let answers: unknown[];
let messages: { to: string; text: string; buttons: unknown }[];
beforeEach(() => {
  vi.resetModules();
  answers = [];
  messages = [];
  db = memoryDb({
    restaurants: [
      {
        id: A, name: "Ember & Spice Grill", agent_modes: {}, active: true, owner_whatsapp: "whatsapp:+447700900111", whatsapp_from: "whatsapp:+14155238886", trust_levels: {}, menu: [], opening_hours: { Monday: "12:00 – 23:00" }, special_hours: {}, photo_library: [], brand_color: "#c2410c", brand_dark: "#1c1917",
        logo_url: null, emoji_allowed: { posts: 2 }, words_to_avoid: [], profile_version: 1, discount_cap_percent: 20,
      },
    ],
    google_posts: [], drafts: [], agent_jobs: [], audit_log: [], shadow_drafts: [], profile_versions: [], draft_feedback: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "ok" }));
  vi.doMock("@/lib/notify", () => ({
    messageOwner: async (channel: { to: string }, text: string, buttons: unknown = false) => {
      messages.push({ to: channel.to, text, buttons });
    },
  }));
  vi.doMock("@/lib/google/post-preview", () => ({ postPreviewPng: async () => ({ media_type: "image/png", data: "AAAA" }) }));
  vi.doMock("@/lib/claude", () => ({
    MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
    MODEL: "claude-sonnet-5-5",
    MAX_TOKENS: 100,
    WITH_FALLBACK: {},
    fallbackFor: () => ({}),
    claude: () => ({
      beta: {
        messages: {
          parse: async () => {
            const next = answers.shift();
            if (next === undefined) throw new Error("No more stand-in answers");
            return { stop_reason: "end_turn", parsed_output: next, usage: { input_tokens: 1000, output_tokens: 200 }, model: "claude-sonnet-5-5" };
          },
        },
      },
    }),
  }));
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  vi.spyOn(console, "error").mockImplementation((...a) => void (process.env.SHOW_ERRORS && process.stderr.write(`${a.map(String).join(" ")}\n`)));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/claude", "@/lib/google/post-preview", "@/lib/notify"]) vi.doUnmock(m);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const restaurant = () => ({ ...db.tables.restaurants[0] }) as never;

describe("shadow runs", () => {
  test("a weekly post: Visibility's own post and the checker's verdict are saved next to today's", async () => {
    const { queueVisibilityShadow } = await import("@/lib/agents/visibility");
    await queueVisibilityShadow(restaurant(), { task: "google_post", slot: "Monday", legacy_draft_id: "d1", legacy_text: "Today's post" });
    answers = [draft(), pass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    expect((await runQueuedAgentJobs(A)).map((r) => r.status)).toEqual(["done"]);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ agent: "visibility", source: "google_post", task: "google_post", legacy_text: "Today's post", outcome: "reply", revisions: 0 });
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: "done", verdict: "pass" });
    expect(Number(db.tables.agent_jobs[0].cost_usd)).toBeGreaterThan(0);
    expect(db.tables.audit_log.find((e) => e.action === "agent_drafted")).toMatchObject({ actor: "visibility" });
  });

  test("an unusable staff photo: no checker call, the reason is saved", async () => {
    const { queueVisibilityShadow } = await import("@/lib/agents/visibility");
    await queueVisibilityShadow(restaurant(), { task: "photo", photo: { url: "https://storage.test/p.jpg", content_type: "image/jpeg", note: "", sender: "staff", staff_number: "whatsapp:+447700900333" } });
    answers = [draft({ type: "google_photo", content: { text: "", cta: null, hashtags: [] }, sources_used: [], photo_check: { usable: false, reason_code: "too_dark", reason: "Too dark to see the food." } })];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect(db.tables.shadow_drafts[0]).toMatchObject({ source: "staff_photo", outcome: "unusable", checker: null });
    expect(answers).toEqual([]);
  });

  test("the owner's photo goes into the photo library (logged by the system, not the owner)", async () => {
    const { addToPhotoLibrary } = await import("@/lib/agents/visibility");
    await addToPhotoLibrary(restaurant(), "https://storage.test/p.jpg", "owner", "Mixed grill");
    expect(db.tables.restaurants[0].photo_library).toMatchObject([{ url: "https://storage.test/p.jpg", source: "owner", caption: "Mixed grill" }]);
    expect(db.tables.audit_log[0]).toMatchObject({ actor: "system", action: "setting" });
    await addToPhotoLibrary({ ...db.tables.restaurants[0] } as never, "https://storage.test/p.jpg", "owner", null);
    expect((db.tables.restaurants[0].photo_library as unknown[]).length).toBe(1);
  });

  test("with Visibility off, nothing is queued", async () => {
    db.tables.restaurants[0].agent_modes = { visibility: "off" };
    const { queueVisibilityShadow } = await import("@/lib/agents/visibility");
    expect(await queueVisibilityShadow(restaurant(), { task: "google_post", slot: "Monday" })).toBeNull();
  });

  test("the comparison shows today's post, Visibility's and the verdict", async () => {
    db.tables.shadow_drafts.push({
      id: "s1", restaurant_id: A, agent: "visibility", source: "staff_photo", task: "photo", review: null, subject: { photo_url: "https://storage.test/p.jpg", sender: "staff" },
      legacy_draft_id: null, legacy_text: null, outcome: "unusable", output: { photo_check: { usable: false, reason_code: "too_dark", reason: "Too dark." } }, question: null, checker: null,
      revisions: 0, steps: [], agent_version: "0.2", checker_version: null, created_at: "2026-10-12T10:00:00Z",
    });
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { AgentCompare } = await import("@/app/log/agent-compare");
    const html = renderToStaticMarkup(await AgentCompare({ restaurantId: A, agent: "visibility" }));
    expect(html).toContain("A photo from staff");
    expect(html).toContain("Photo can&#x27;t be used: Too dark.");
    expect(html).toContain("too dark to use");
    expect(html).toContain("(nothing today: this is new work)");
  });
});

describe("the go-live checklist", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    logo_url: "https://x.test/logo.png", brand_color: "#123456", brand_dark: "#000000", opening_hours: { Monday: "12:00 – 23:00" },
    emoji_allowed: { review_replies: 1, posts: 2, campaigns: 2 }, photo_library: [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}` })), ...extra,
  });
  test("logo, colours, hours, emoji setting and at least 5 photos", () => {
    expect(missingForGoLive(row(), "visibility")).toEqual([]);
    expect(missingForGoLive(row({ logo_url: null, photo_library: [] }), "visibility")).toEqual(["logo", "photo_library"]);
  });
  test("the app's default colours and emoji setting only count once the owner has saved them", () => {
    const defaults = row({ brand_color: "#c2410c", brand_dark: "#1c1917", emoji_allowed: { review_replies: 0, posts: 2, campaigns: 2 } });
    expect(missingForGoLive(defaults, "visibility")).toEqual(["colours", "emoji_allowed"]);
    expect(missingForGoLive(defaults, "visibility", new Set(["colours", "emoji_allowed"]))).toEqual([]);
  });
  test("Visibility set to live stays in shadow until the checklist passes, and outside TEST_MODE", async () => {
    vi.stubEnv("TEST_MODE", "true");
    db.tables.restaurants[0].agent_modes = { visibility: "live" };
    const { visibilityMode } = await import("@/lib/agents/visibility");
    expect(await visibilityMode(restaurant())).toBe("shadow");
    Object.assign(db.tables.restaurants[0], row());
    expect(await visibilityMode(restaurant())).toBe("live");
    vi.stubEnv("TEST_MODE", "false");
    expect(await visibilityMode(restaurant())).toBe("shadow");
  });
});

describe("profile changes", () => {
  test("hours, special hours and the menu, in words (from and to)", async () => {
    const { describeProfileChange } = await import("@/lib/agents/visibility-rules");
    expect(describeProfileChange("hours", { Friday: "14:00 – 00:00", Saturday: "14:00 – 00:00" }, { Friday: "12:00 – 23:00", Saturday: "14:00 – 00:00" })).toEqual({
      field: "hours",
      from: "Friday: 14:00 – 00:00",
      to: "Friday: 12:00 – 23:00",
    });
    expect(describeProfileChange("special_hours", {}, { "2026-12-25": { label: "Christmas Day", hours: "Closed" } })).toEqual({
      field: "special_hours",
      from: "Christmas Day (2026-12-25): usual hours",
      to: "Christmas Day (2026-12-25): Closed",
    });
    const menu = (items: { name: string; price: number }[]) => [{ category: "Wraps", items: items.map((i) => ({ ...i, description: null })) }];
    expect(describeProfileChange("menu", menu([{ name: "Smash Burger", price: 8.95 }]), menu([{ name: "Smash Burger", price: 9.5 }, { name: "Lamb Kofta Wrap", price: 7.95 }]))).toEqual({
      field: "menu",
      from: "Smash Burger: £8.95; Lamb Kofta Wrap: not on the menu",
      to: "Smash Burger: £9.50; Lamb Kofta Wrap: added, £7.95",
    });
    // Only allergens confirmed: nothing Google shows changed.
    expect(describeProfileChange("menu", menu([{ name: "Naan", price: 2 }]), [{ category: "Wraps", items: [{ name: "Naan", price: 2, description: null, allergens_confirmed: true }] }])).toBeNull();
  });

  test("a logged hours change queues Visibility (shadow) with the change in words", async () => {
    const { logSetting } = await import("@/lib/audit");
    await logSetting(A, "opening_hours", { Monday: "12:00 – 23:00" }, { Monday: "12:00 – 22:00" }, "Changed Monday hours");
    expect(db.tables.agent_jobs).toHaveLength(1);
    expect(db.tables.agent_jobs[0]).toMatchObject({
      kind: "visibility_shadow",
      trigger: "profile_changed",
      input: { task: "profile_changed", event: { field: "hours", from: "Monday: 12:00 – 23:00", to: "Monday: 12:00 – 22:00" } },
    });
  });

  test("not while the restaurant is still onboarding", async () => {
    db.tables.restaurants[0].active = false;
    const { logSetting } = await import("@/lib/audit");
    await logSetting(A, "opening_hours", { Monday: "12:00 – 23:00" }, { Monday: "12:00 – 22:00" }, "Changed Monday hours");
    expect(db.tables.agent_jobs).toHaveLength(0);
  });
});

describe("live mode (TEST_MODE only)", () => {
  const ready = () => {
    vi.stubEnv("TEST_MODE", "true");
    Object.assign(db.tables.restaurants[0], {
      agent_modes: { visibility: "live" },
      logo_url: "https://x.test/logo.png",
      brand_color: "#123456",
      brand_dark: "#000000",
      emoji_allowed: { review_replies: 1, posts: 2, campaigns: 2 },
      photo_library: [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, url: `https://x.test/${i}.jpg` })),
    });
  };
  const staffPhoto = { url: "https://storage.test/p.jpg", content_type: "image/jpeg", note: "", sender: "staff" as const, staff_number: "whatsapp:+447700900333" };

  test("an hours change becomes an Approve-only draft showing from and to", async () => {
    ready();
    const { logSetting } = await import("@/lib/audit");
    await logSetting(A, "opening_hours", { Monday: "12:00 – 23:00" }, { Monday: "12:00 – 22:00" }, "Changed Monday hours");
    answers = [
      draft({
        type: "hours_update",
        content: { text: "Your Monday closing time on Google changes to 10pm.", cta: null, hashtags: [] },
        change: { field: "hours", from: "Monday: 12:00 – 23:00", to: "Monday: 12:00 – 22:00" },
        sources_used: ["profile:hours"],
      }),
      profilePass,
    ];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    expect((await runQueuedAgentJobs(A)).map((r) => r.status)).toEqual(["done"]);
    const d = db.tables.drafts[0];
    expect(d).toMatchObject({ kind: "hours_update", status: "pending", waiting_for: "decision" });
    expect(d.content).toContain("On Google now: Monday: 12:00 – 23:00");
    expect(d.content).toContain("After you approve: Monday: 12:00 – 22:00");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: "whatsapp:+447700900111", buttons: true });
  });

  test("an unusable staff photo: the fixed tip goes to the staff number that sent it", async () => {
    ready();
    const { queueVisibilityLive } = await import("@/lib/agents/visibility");
    await queueVisibilityLive(restaurant(), { task: "photo", photo: staffPhoto });
    answers = [draft({ type: "google_photo", content: { text: "", cta: null, hashtags: [] }, sources_used: [], photo_check: { usable: false, reason_code: "too_dark", reason: "Too dark to see the food." } })];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    const { PHOTO_TIPS } = await import("@/lib/agents/visibility-rules");
    expect(messages).toEqual([{ to: "whatsapp:+447700900333", text: PHOTO_TIPS.too_dark, buttons: false }]);
    expect(db.tables.drafts).toHaveLength(0);
  });

  test("a usable staff photo: into the library, and a post held for the brief", async () => {
    ready();
    const { queueVisibilityLive } = await import("@/lib/agents/visibility");
    await queueVisibilityLive(restaurant(), { task: "photo", photo: staffPhoto });
    answers = [draft({ photo_check: { usable: true, reason_code: "ok", reason: "Bright and sharp." } }), pass];
    const { runQueuedAgentJobs } = await import("@/lib/agents/handlers");
    await runQueuedAgentJobs(A);
    expect(db.tables.drafts[0]).toMatchObject({ kind: "google_post", waiting_for: null });
    expect(db.tables.google_posts[0]).toMatchObject({ photo_url: "https://storage.test/p.jpg" });
    expect((db.tables.restaurants[0].photo_library as { url: string }[]).some((p) => p.url === "https://storage.test/p.jpg")).toBe(true);
    expect(messages).toHaveLength(0);
  });
});
