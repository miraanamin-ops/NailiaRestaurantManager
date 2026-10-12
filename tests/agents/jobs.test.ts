// Agent jobs: unique keys, one run per job, the audit log records job, agent,
// version and verdict, and failures retry then alert the builder.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "../support/fake-supabase";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
let db: ReturnType<typeof memoryDb>;
const alerts: string[] = [];

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({ agent_jobs: [], audit_log: [] });
  alerts.length = 0;
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/builder-alerts");
});

const job = (restaurantId: string, key: string) => ({ restaurantId, key, agent: "checker", kind: "test_kind", trigger: "draft_created", draftId: "d1" });
const ok = async () => ({ output: { verdict: "pass" }, agentVersion: "0.2", verdict: "pass", detail: "Checker (shadow): pass", actor: "checker" as const });

describe("agent jobs", () => {
  test("a job runs once, and the log records job id, agent, version and verdict", async () => {
    const { enqueueAgentJob, runAgentJobs } = await import("@/lib/agents/jobs");
    const queued = await enqueueAgentJob(job(A, "checker:d1:v1"));
    const handler = vi.fn(ok);
    expect(await runAgentJobs(A, { test_kind: handler })).toEqual([{ key: "checker:d1:v1", status: "done" }]);
    expect(await runAgentJobs(A, { test_kind: handler })).toEqual([]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: "done", verdict: "pass", agent_version: "0.2", attempts: 1 });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "checked", actor: "checker", job_id: queued!.id, agent: "checker", agent_version: "0.2", verdict: "pass" });
  });

  test("the same key can't be queued twice (the database refuses it)", async () => {
    const fake = fakeSupabase(() => ({ error: { message: "duplicate key", code: "23505" } }));
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => fake.client }));
    const { enqueueAgentJob } = await import("@/lib/agents/jobs");
    expect(await enqueueAgentJob(job(A, "checker:d1:v1"))).toBeNull();
  });

  test("a restaurant's run only touches its own jobs", async () => {
    const { enqueueAgentJob, runAgentJobs } = await import("@/lib/agents/jobs");
    await enqueueAgentJob(job(A, "a1"));
    await enqueueAgentJob(job(B, "b1"));
    await runAgentJobs(A, { test_kind: ok });
    expect(db.tables.agent_jobs.find((j) => j.job_key === "b1")).toMatchObject({ status: "queued", attempts: 0 });
  });

  test("an error is retried, and after the last try the builder is alerted (never the owner)", async () => {
    const { enqueueAgentJob, runAgentJobs, MAX_ATTEMPTS } = await import("@/lib/agents/jobs");
    await enqueueAgentJob(job(A, "k"));
    const failing = async () => {
      throw new Error("API down");
    };
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(await runAgentJobs(A, { test_kind: failing })).toEqual([{ key: "k", status: "retry" }]);
    expect(alerts).toEqual([]);
    expect(await runAgentJobs(A, { test_kind: failing })).toEqual([{ key: "k", status: "failed" }]);
    expect(alerts[0]).toMatch(/checker agent job k failed after 3 tries/);
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "agent_failed", actor: "system", agent: "checker" });
  });

  test("invalid output twice is final at once (the agent call already alerted)", async () => {
    const { enqueueAgentJob, runAgentJobs } = await import("@/lib/agents/jobs");
    const { AgentOutputError } = await import("@/lib/agents/run");
    await enqueueAgentJob(job(A, "k"));
    const invalid = async () => {
      throw new AgentOutputError("checker", ["bad"]);
    };
    expect(await runAgentJobs(A, { test_kind: invalid })).toEqual([{ key: "k", status: "failed" }]);
    expect(alerts).toEqual([]);
  });

  test("a job whose run crashed (lock passed) is picked up again", async () => {
    const { enqueueAgentJob, runAgentJobs } = await import("@/lib/agents/jobs");
    await enqueueAgentJob(job(A, "k"));
    Object.assign(db.tables.agent_jobs[0], { status: "running", attempts: 1, locked_until: "2020-01-01T00:00:00Z" });
    expect(await runAgentJobs(A, { test_kind: ok })).toEqual([{ key: "k", status: "done" }]);
  });
});

describe("agent modes", () => {
  test("the checker defaults to shadow and can't be set live; Reputation can (its checklist guards it)", async () => {
    const { agentMode } = await import("@/lib/agents/modes");
    expect(agentMode({ agent_modes: {} }, "checker")).toBe("shadow");
    expect(agentMode({ agent_modes: { checker: "off" } }, "checker")).toBe("off");
    expect(agentMode({ agent_modes: { checker: "live" } }, "checker")).toBe("shadow");
    expect(agentMode({ agent_modes: { reputation: "live" } }, "reputation")).toBe("live");
    expect(agentMode({ agent_modes: {} }, "reputation")).toBe("shadow");
    expect(agentMode({ agent_modes: { gm: "live" } }, "gm")).toBe("off");
  });
});
