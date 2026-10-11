// The checker agent in shadow mode: which checks apply, when owner-only output
// is checked, and a full run with a stand-in Claude. The verdict and minor fixes
// are recorded next to today's checks, and nothing changes for the owner.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applicableChecks, audienceOf, makerFor, needsChecker } from "@/lib/agents/checker-rules";
import { memoryDb } from "../support/memory-db";

describe("which checks apply", () => {
  test("customer drafts: every check; brand checks only with a rendered preview (emails)", () => {
    expect(applicableChecks("customer", true).applicable).toHaveLength(22);
    const reply = applicableChecks(audienceOf("review_reply"), false);
    expect(reply.applicable).not.toContain("B1");
    expect(reply.skipped).toEqual(["B1", "B2", "B3", "B4"]);
  });

  test("owner-only output: facts and C6; profile changes: facts and C1", () => {
    expect(applicableChecks("owner_only", false).applicable).toEqual(["F1", "F2", "F3", "F4", "F5", "C6"]);
    expect(applicableChecks(audienceOf("hours_update"), false).applicable).toEqual(["F1", "F2", "F3", "F4", "F5", "C1"]);
  });

  test("owner-only output is checked only when it has figures or sources", () => {
    expect(needsChecker({ kind: "answer", figures: [{ metric: "net_sales" }] })).toBe(true);
    expect(needsChecker({ kind: "brief", sources_used: ["metrics:x"] })).toBe(true);
    expect(needsChecker({ kind: "reply", figures: [], sources_used: [] })).toBe(false);
    expect(needsChecker({ kind: "review_reply" })).toBe(true); // customer-facing: always
  });

  test("each draft is checked against its maker's rules", () => {
    expect(makerFor("review_reply")).toBe("reputation");
    expect(makerFor("email_campaign")).toBe("growth");
    expect(makerFor("google_post")).toBe("visibility");
  });
});

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const REPLY = "Thank you, Aisha — the lamb chops are £14 and we'd love to see you again. Bilal";

describe("a shadow run", () => {
  let db: ReturnType<typeof memoryDb>;
  const alerts: string[] = [];
  const sentToOwner: string[] = [];
  let answers: unknown[] = [];
  let requests: { system: { text: string }[]; messages: { content: { type: string; text?: string }[] }[] }[] = [];

  beforeEach(() => {
    vi.resetModules();
    alerts.length = 0;
    sentToOwner.length = 0;
    requests = [];
    db = memoryDb({
      restaurants: [
        {
          id: A, name: "Ember & Spice Grill", cuisine: "Halal grill", brand_voice: "Warm", sign_off_name: "Bilal", menu: [{ category: "Grill", items: [{ name: "Lamb chops", price: 14 }] }],
          opening_hours: {}, discount_cap_percent: 20, agent_modes: {}, profile_version: 2, recovery_offers: [], words_to_avoid: [], emoji_allowed: null,
        },
      ],
      reviews: [{ id: "rv1", restaurant_id: A, author_name: "Aisha K", rating: 5, text: "Best lamb chops in Ilford", review_date: "2026-10-08T10:00:00Z" }],
      drafts: [],
      agent_jobs: [],
      audit_log: [],
      profile_versions: [],
    });
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
    vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void sentToOwner.push(text) }));
    vi.doMock("@/lib/claude", () => ({
      MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
      MODEL: "claude-sonnet-5-5",
      MAX_TOKENS: 100,
      WITH_FALLBACK: {},
      fallbackFor: () => ({}),
      claude: () => ({
        beta: {
          messages: {
            parse: async (req: (typeof requests)[number]) => {
              requests.push(req);
              return { stop_reason: "end_turn", parsed_output: answers[requests.length - 1] ?? null };
            },
          },
        },
      }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/notify", "@/lib/claude"]) vi.doUnmock(m);
  });

  const ids = ["T1", "T2", "T3", "T4", "T5", "F1", "F2", "F3", "F4", "F5", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
  const verdict = (extra: Record<string, unknown> = {}) => ({
    verdict: "pass",
    checks: ids.map((id) => ({ id, result: "pass", reason: null, fix: null })),
    minor_fixes: [{ check: "T5", find: "Aisha —", replace: "Aisha," }],
    owner_question: null,
    notes: "",
    ...extra,
  });

  async function makeDraft() {
    const { createDraft } = await import("@/lib/drafts");
    return createDraft({ restaurantId: A, kind: "review_reply", content: REPLY, audience: "Google review by Aisha K", request: "Review check", reviewId: "rv1", checks: {}, mode: "hold" });
  }

  test("a new draft queues one checker job; the run records the verdict and changes nothing for the owner", async () => {
    answers = [verdict()];
    const draft = await makeDraft();
    expect(db.tables.agent_jobs).toHaveLength(1);
    expect(db.tables.agent_jobs[0]).toMatchObject({ job_key: `checker:${draft.id}:v1`, agent: "checker", kind: "checker_shadow", status: "queued" });

    const { runQueuedAgentJobs } = await import("@/lib/agents/checker");
    expect(await runQueuedAgentJobs(A)).toEqual([{ key: `checker:${draft.id}:v1`, status: "done" }]);

    const saved = db.tables.drafts[0];
    expect(saved.content).toBe(REPLY); // minor fixes recorded, not applied
    expect(saved.status).toBe("pending");
    expect(saved.agent_check).toMatchObject({ mode: "shadow", verdict: "pass", draft_version: 1, agent_version: "0.2", minor_fixes: [{ find: "Aisha —", replace: "Aisha," }] });
    // B1-B4 are listed as skipped for a review reply (no rendered preview).
    expect((saved.agent_check as { checks: { id: string; result: string }[] }).checks.filter((c) => c.result === "skipped").map((c) => c.id)).toEqual(["B1", "B2", "B3", "B4"]);
    expect(sentToOwner).toEqual([]);

    const log = db.tables.audit_log.find((e) => e.action === "checked");
    expect(log).toMatchObject({ actor: "checker", agent: "checker", agent_version: "0.2", verdict: "pass", job_id: db.tables.agent_jobs[0].id });
    expect(String(log!.detail)).toMatch(/Checker \(shadow, v0\.2\).*pass.*1 minor fix/);
  });

  test("the checker gets the draft, its resolved sources and the maker's rules, never the maker's reasoning", async () => {
    answers = [verdict()];
    await makeDraft();
    const { runQueuedAgentJobs } = await import("@/lib/agents/checker");
    await runQueuedAgentJobs(A);
    const system = requests[0].system[0].text;
    expect(system.startsWith("# House rules")).toBe(true);
    expect(system).toContain("You review every draft before the owner or a customer sees it");
    const user = requests[0].messages[0].content[0].text!;
    expect(user).toContain('"review:rv1"');
    expect(user).toContain("Best lamb chops in Ilford"); // the resolved review
    expect(user).toContain("Reply in the language the review is written in"); // Reputation's rules
    expect(user).toContain("Applicable checks");
  });

  test("an edit is a new version with its own job", async () => {
    answers = [verdict(), verdict()];
    const draft = await makeDraft();
    const { applyEdit } = await import("@/lib/drafts");
    await applyEdit(draft, "shorter", "Thanks, Aisha! Bilal", {});
    expect(db.tables.agent_jobs.map((j) => j.job_key)).toEqual([`checker:${draft.id}:v1`, `checker:${draft.id}:v2`]);
  });

  test("with the checker off, nothing is queued", async () => {
    db.tables.restaurants[0].agent_modes = { checker: "off" };
    await makeDraft();
    expect(db.tables.agent_jobs).toEqual([]);
  });

  test("invalid output twice: the job fails, the builder is alerted, the draft is untouched", async () => {
    answers = [verdict({ checks: [] }), verdict({ verdict: "fail" })];
    await makeDraft();
    const { runQueuedAgentJobs } = await import("@/lib/agents/checker");
    expect((await runQueuedAgentJobs(A))[0].status).toBe("failed");
    expect(alerts[0]).toMatch(/checker agent .* invalid output twice/);
    expect(db.tables.drafts[0].agent_check ?? null).toBeNull();
    expect(sentToOwner).toEqual([]);
  });
});
