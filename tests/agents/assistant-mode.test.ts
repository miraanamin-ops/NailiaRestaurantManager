// The per-restaurant switch between the agents and the old assistant: the app's
// rule and the script's (scripts/lib/assistant-modes.mjs) are the same.
import { describe, expect, test } from "vitest";
import * as app from "@/lib/agents/assistant-mode";
// @ts-expect-error plain JavaScript module, no types
import * as script from "../../scripts/lib/assistant-modes.mjs";
import { MODES_AVAILABLE } from "@/lib/agents/modes";

describe("assistant mode", () => {
  test("agents sets all five and the checker live, old sets them all to shadow; other settings kept", () => {
    const current = { reputation: "off", extra: "x" };
    const live = app.agentModesFor("agents", current);
    expect(live).toEqual({ reputation: "live", visibility: "live", insights: "live", growth: "live", gm: "live", checker: "live", extra: "x" });
    expect(app.assistantModeOf(live)).toBe("agents");
    const old = app.agentModesFor("old", live);
    expect(Object.values(old).filter((v) => v === "shadow")).toHaveLength(6);
    expect(app.assistantModeOf(old)).toBe("old");
    expect(app.assistantModeOf({ gm: "live" })).toBe("mixed");
    expect(app.assistantModeOf(null)).toBe("old");
  });

  test("the script uses the same rule", () => {
    expect([...script.ASSISTANT_AGENTS]).toEqual([...app.ASSISTANT_AGENTS]);
    for (const mode of ["agents", "old"] as const) expect(script.agentModesFor(mode, { a: "b" })).toEqual(app.agentModesFor(mode, { a: "b" }));
    expect(() => script.agentModesFor("live", {})).toThrow();
  });

  test("every agent the switch sets can really be set live", () => {
    for (const a of app.ASSISTANT_AGENTS) expect(MODES_AVAILABLE[a]?.allowed).toContain("live");
  });
});
