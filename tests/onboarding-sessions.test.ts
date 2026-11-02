// Onboarding with Dina, saved (src/lib/onboarding/sessions.ts) on the in-memory
// database: startOnboarding is the one entry point and safe to repeat; each
// change saves the step, where the owner is and the setup gaps; one restaurant's
// progress never touches another's.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-00000000000a";
const B = "bbbbbbbb-0000-0000-0000-00000000000b";
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  db = memoryDb(
    {
      restaurants: [
        { id: A, name: "Ember & Spice Grill" },
        { id: B, name: "Cardamom Corner" },
      ],
      onboarding_sessions: [],
      onboarding_steps: [],
      setup_gaps: [],
    },
    { unique: ["onboarding_sessions.restaurant_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
});
afterEach(() => vi.doUnmock("@/lib/supabase"));

const load = () => import("@/lib/onboarding/sessions");

describe("starting", () => {
  test("startOnboarding makes one session at Hello; calling it again returns the same one", async () => {
    const { startOnboarding } = await load();
    const first = await startOnboarding(A, { channel: "web" });
    expect(first).toMatchObject({ restaurant_id: A, current_step: "hello", channel_last_used: "web", flow_version: 2 });
    const again = await startOnboarding(A, { channel: "whatsapp" });
    expect(again.restaurant_id).toBe(A);
    expect(db.tables.onboarding_sessions).toHaveLength(1);
    expect(db.tables.onboarding_sessions[0].channel_last_used).toBe("web");
  });

  test("loading a restaurant that never started says so", async () => {
    const { loadFlow } = await load();
    await expect(loadFlow(A)).rejects.toThrow(/hasn't started onboarding/);
  });
});

describe("changing steps", () => {
  test("each change saves the step, moves the owner on and records the channel", async () => {
    const { completeStep, loadFlow, startOnboarding } = await load();
    await startOnboarding(A);
    const { session } = await completeStep(A, "hello", "done", { owner_name: "Amina" }, { channel: "whatsapp" });
    expect(session).toMatchObject({ current_step: "google", channel_last_used: "whatsapp" });
    expect(db.tables.onboarding_steps).toEqual([expect.objectContaining({ restaurant_id: A, step_key: "hello", status: "done", data: { owner_name: "Amina" } })]);
    const { state } = await loadFlow(A);
    expect(state.hello?.status).toBe("done");
  });

  test("saving the same step twice keeps one row", async () => {
    const { completeStep, startOnboarding } = await load();
    await startOnboarding(A);
    await completeStep(A, "hello", "done", { owner_name: "Amina" });
    await completeStep(A, "hello", "done", { owner_name: "Amina Khan" });
    expect(db.tables.onboarding_steps).toHaveLength(1);
    expect(db.tables.onboarding_steps[0].data).toEqual({ owner_name: "Amina Khan" });
  });

  test("skips and partials become gaps; finishing the step later closes its gap", async () => {
    const { completeStep, enterStep, skipStep, startOnboarding } = await load();
    await startOnboarding(A);
    await completeStep(A, "hello", "done", {});
    await skipStep(A, "google");
    await completeStep(A, "tone", "partial", { praise: "warm" });
    expect(db.tables.setup_gaps.map((g) => [g.step_key, g.resolved_at ?? null])).toEqual([
      ["google", null],
      ["tone", null],
    ]);
    await enterStep(A, "google");
    const { session } = await completeStep(A, "google", "done", { connected: true });
    expect(db.tables.setup_gaps.find((g) => g.step_key === "google")?.resolved_at).toBeTruthy();
    expect(db.tables.setup_gaps).toHaveLength(2);
    expect(session.current_step).toBe("make_it_right");
  });

  test("Hello can't be skipped: nothing is saved", async () => {
    const { skipStep, startOnboarding } = await load();
    await startOnboarding(A);
    await expect(skipStep(A, "hello")).rejects.toThrow(/can't be skipped/);
    expect(db.tables.onboarding_steps).toEqual([]);
  });

  test("one restaurant's progress never touches another's", async () => {
    const { completeStep, loadFlow, skipStep, startOnboarding } = await load();
    await startOnboarding(A);
    await startOnboarding(B);
    await completeStep(A, "hello", "done", {});
    await skipStep(A, "google");
    const b = await loadFlow(B);
    expect(b.state).toEqual({});
    expect(b.gaps).toEqual([]);
    expect(b.session.current_step).toBe("hello");
  });
});
