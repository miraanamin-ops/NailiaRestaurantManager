// The switches (lib/switches.ts): each on its own, the key combinations, safe
// fallbacks for missing or unreadable values, and TEST_MODE (deprecated) still
// behaving exactly as before when nothing else is set.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  agentLiveAllowed,
  agentModeReason,
  agentsLiveSwitch,
  allSwitches,
  effectiveAgentMode,
  emailRedirectSwitch,
  environmentOf,
  googleSwitch,
  readFlag,
  switchChanges,
  switchesRecord,
  testToolsFor,
  testToolsSwitch,
} from "@/lib/switches";

const PROD = { VERCEL_ENV: "production" };
const PREVIEW = { VERCEL_ENV: "preview" };
const AGENTS = ["reputation", "visibility", "insights", "growth", "gm"] as const;

describe("reading a value", () => {
  test("true/false in their usual spellings; anything else is unreadable", () => {
    for (const v of ["true", "TRUE", " on ", "yes", "1"]) expect(readFlag(v)).toBe(true);
    for (const v of ["false", "Off", "no", "0"]) expect(readFlag(v)).toBe(false);
    expect(readFlag(undefined)).toBe("missing");
    expect(readFlag("  ")).toBe("missing");
    expect(readFlag("maybe")).toBe("unreadable");
  });

  test("only a Vercel production deployment counts as production", () => {
    expect(environmentOf(PROD)).toBe("production");
    expect(environmentOf(PREVIEW)).toBe("preview");
    expect(environmentOf({ VERCEL_ENV: "development" })).toBe("development");
    expect(environmentOf({})).toBe("development");
    expect(environmentOf({ NODE_ENV: "production" })).toBe("development");
  });
});

describe("EMAIL_REDIRECT", () => {
  test("missing: redirect (safe), in every environment", () => {
    expect(emailRedirectSwitch(PROD)).toMatchObject({ on: true, source: "default" });
    expect(emailRedirectSwitch({}).on).toBe(true);
  });
  test("unreadable: redirect, even with TEST_MODE set", () => {
    expect(emailRedirectSwitch({ ...PROD, EMAIL_REDIRECT: "nah" })).toMatchObject({ on: true, source: "default" });
    expect(emailRedirectSwitch({ ...PROD, EMAIL_REDIRECT: "nah" }).note).toMatch(/isn't true or false/);
  });
  test("off only in production", () => {
    expect(emailRedirectSwitch({ ...PROD, EMAIL_REDIRECT: "false" })).toMatchObject({ on: false, source: "setting" });
  });
  test("preview and development always redirect, whatever the setting", () => {
    expect(emailRedirectSwitch({ ...PREVIEW, EMAIL_REDIRECT: "false" })).toMatchObject({ on: true, source: "forced" });
    expect(emailRedirectSwitch({ EMAIL_REDIRECT: "false" })).toMatchObject({ on: true, source: "forced" });
  });
  test("TEST_MODE=true still redirects; an explicit EMAIL_REDIRECT beats it", () => {
    expect(emailRedirectSwitch({ ...PROD, TEST_MODE: "true" })).toMatchObject({ on: true, source: "TEST_MODE (deprecated)" });
    expect(emailRedirectSwitch({ ...PROD, TEST_MODE: "true", EMAIL_REDIRECT: "false" }).on).toBe(false);
  });
});

describe("TEST_TOOLS", () => {
  test("off unless set, in every environment, production included", () => {
    expect(testToolsSwitch(PROD)).toMatchObject({ on: false, source: "default" });
    expect(testToolsSwitch(PREVIEW).on).toBe(false);
    expect(testToolsSwitch({ ...PROD, TEST_TOOLS: "true" }).on).toBe(true);
  });
  test("unreadable: off, even with TEST_MODE set", () => {
    expect(testToolsSwitch({ TEST_TOOLS: "sure", TEST_MODE: "true" }).on).toBe(false);
  });
  test("TEST_MODE=true still turns them on; TEST_TOOLS=false beats it", () => {
    expect(testToolsSwitch({ TEST_MODE: "true" })).toMatchObject({ on: true, source: "TEST_MODE (deprecated)" });
    expect(testToolsSwitch({ TEST_MODE: "true", TEST_TOOLS: "false" }).on).toBe(false);
  });
  test("TEST_MODE keeps its old exact rule: only \"true\" counts", () => {
    expect(testToolsSwitch({ TEST_MODE: "TRUE" }).on).toBe(false);
    expect(testToolsSwitch({ TEST_MODE: "1" }).on).toBe(false);
  });
  test("they only ever act on a demo restaurant", () => {
    const on = { TEST_TOOLS: "true" };
    expect(testToolsFor(on, { is_demo: true })).toBe(true);
    expect(testToolsFor(on, { is_demo: false })).toBe(false);
    expect(testToolsFor(on, { is_demo: null })).toBe(false);
    expect(testToolsFor(on, {})).toBe(false);
    expect(testToolsFor({}, { is_demo: true })).toBe(false);
  });
});

describe("GOOGLE_MODE", () => {
  test("missing or unknown: dummy", () => {
    expect(googleSwitch(PROD)).toMatchObject({ mode: "dummy", source: "default" });
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "real" })).toMatchObject({ mode: "dummy" });
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "real" }).note).toMatch(/isn't dummy, simulated or live/);
  });
  test("each value in production", () => {
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "dummy" }).mode).toBe("dummy");
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "simulated" }).mode).toBe("simulated");
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "Live" }).mode).toBe("live");
  });
  test("preview and development never write to live Google", () => {
    expect(googleSwitch({ ...PREVIEW, GOOGLE_MODE: "live" })).toMatchObject({ mode: "simulated", source: "forced" });
    expect(googleSwitch({ GOOGLE_MODE: "live" }).mode).toBe("simulated");
  });
  test("the old rule: live with TEST_MODE=true is simulated", () => {
    expect(googleSwitch({ ...PROD, GOOGLE_MODE: "live", TEST_MODE: "true" })).toMatchObject({ mode: "simulated", source: "TEST_MODE (deprecated)" });
    expect(googleSwitch({ ...PROD, TEST_MODE: "true" }).mode).toBe("dummy");
  });
});

describe("AGENTS_LIVE_ALLOWED", () => {
  test("not set: today's rule (Reputation by its checklist, the others need TEST_MODE=true)", () => {
    expect(agentsLiveSwitch({}).allowed).toBe("legacy");
    expect(agentLiveAllowed({}, "reputation")).toBe(true);
    for (const a of ["visibility", "insights", "growth", "gm"] as const) {
      expect(agentLiveAllowed({}, a)).toBe(false);
      expect(agentLiveAllowed({ TEST_MODE: "true" }, a)).toBe(true);
    }
  });
  test("true: every agent may go live, without TEST_MODE", () => {
    for (const a of AGENTS) expect(agentLiveAllowed({ AGENTS_LIVE_ALLOWED: "true" }, a)).toBe(true);
  });
  test("the kill switch: false stops every agent, whatever TEST_MODE says", () => {
    for (const a of AGENTS) expect(agentLiveAllowed({ AGENTS_LIVE_ALLOWED: "false", TEST_MODE: "true" }, a)).toBe(false);
  });
  test("unreadable counts as the kill switch", () => {
    expect(agentsLiveSwitch({ AGENTS_LIVE_ALLOWED: "please" }).allowed).toBe("none");
    for (const a of AGENTS) expect(agentLiveAllowed({ AGENTS_LIVE_ALLOWED: "please", TEST_MODE: "true" }, a)).toBe(false);
  });
});

describe("an agent's effective mode", () => {
  test("live only if set live, allowed, and ready; off and shadow are untouched", () => {
    expect(effectiveAgentMode("live", { liveAllowed: true, ready: true })).toBe("live");
    expect(effectiveAgentMode("live", { liveAllowed: false, ready: true })).toBe("shadow");
    expect(effectiveAgentMode("live", { liveAllowed: true, ready: false })).toBe("shadow");
    expect(effectiveAgentMode("off", { liveAllowed: false, ready: false })).toBe("off");
    expect(effectiveAgentMode("shadow", { liveAllowed: true, ready: true })).toBe("shadow");
  });

  test("the kill switch overrides every restaurant's live setting", () => {
    const env = { AGENTS_LIVE_ALLOWED: "false", TEST_MODE: "true", VERCEL_ENV: "production" };
    const restaurants = [
      { agent_modes: Object.fromEntries(AGENTS.map((a) => [a, "live"])), ready: true },
      { agent_modes: Object.fromEntries(AGENTS.map((a) => [a, "live"])), ready: false },
      { agent_modes: { reputation: "live" }, ready: true },
    ];
    for (const r of restaurants) {
      for (const a of AGENTS) {
        const set = r.agent_modes[a] ?? "shadow";
        expect(effectiveAgentMode(set, { liveAllowed: agentLiveAllowed(env, a), ready: r.ready })).toBe("shadow");
      }
    }
  });

  test("the builder sees why an agent set to live runs in shadow", () => {
    expect(agentModeReason({ AGENTS_LIVE_ALLOWED: "false" }, "growth", "live", true)).toMatch(/kill switch/);
    expect(agentModeReason({}, "growth", "live", true)).toMatch(/isn't set to true/);
    expect(agentModeReason({ AGENTS_LIVE_ALLOWED: "true" }, "growth", "live", false)).toMatch(/readiness/);
    expect(agentModeReason({ AGENTS_LIVE_ALLOWED: "true" }, "growth", "live", true)).toBeNull();
    expect(agentModeReason({ AGENTS_LIVE_ALLOWED: "false" }, "growth", "shadow", true)).toBeNull();
  });
});

describe("the key combinations", () => {
  test("nothing set at all: every switch is on its safe side", () => {
    const s = allSwitches({});
    expect(s.emailRedirect.on).toBe(true);
    expect(s.testTools.on).toBe(false);
    expect(s.google.mode).toBe("dummy");
    for (const a of ["visibility", "insights", "growth", "gm"] as const) expect(agentLiveAllowed({}, a)).toBe(false);
  });

  test("TEST_MODE=true alone behaves exactly as before the split", () => {
    const env = { TEST_MODE: "true", VERCEL_ENV: "production", GOOGLE_MODE: "live" };
    const s = allSwitches(env);
    expect(s.emailRedirect.on).toBe(true);
    expect(s.testTools.on).toBe(true);
    expect(s.google.mode).toBe("simulated");
    for (const a of AGENTS) expect(agentLiveAllowed(env, a)).toBe(true);
  });

  test("an agent live in production with EMAIL_REDIRECT off", () => {
    const env = { VERCEL_ENV: "production", AGENTS_LIVE_ALLOWED: "true", EMAIL_REDIRECT: "false" };
    expect(agentLiveAllowed(env, "growth")).toBe(true);
    expect(emailRedirectSwitch(env).on).toBe(false);
    expect(testToolsSwitch(env).on).toBe(false);
  });

  test("an agent live with emails still redirected (the recommended way to try one)", () => {
    const env = { VERCEL_ENV: "production", AGENTS_LIVE_ALLOWED: "true", EMAIL_REDIRECT: "true" };
    expect(agentLiveAllowed(env, "growth")).toBe(true);
    expect(emailRedirectSwitch(env).on).toBe(true);
  });

  test("a preview copying Production's settings still redirects email and never writes to Google", () => {
    const env = { VERCEL_ENV: "preview", AGENTS_LIVE_ALLOWED: "true", EMAIL_REDIRECT: "false", GOOGLE_MODE: "live" };
    expect(emailRedirectSwitch(env).on).toBe(true);
    expect(googleSwitch(env).mode).toBe("simulated");
  });
});

describe("the record kept on each job run", () => {
  test("a compact record, and what changed between two runs", () => {
    const before = switchesRecord(allSwitches({ TEST_MODE: "true", VERCEL_ENV: "production" }));
    expect(before).toEqual({ environment: "production", email_redirect: true, test_tools: true, google: "dummy", agents_live: "legacy" });
    const after = switchesRecord(allSwitches({ TEST_MODE: "true", VERCEL_ENV: "production", EMAIL_REDIRECT: "false", AGENTS_LIVE_ALLOWED: "true" }));
    expect(switchChanges(before, after)).toEqual(["email_redirect: true → false", "agents_live: legacy → all"]);
    expect(switchChanges(before, before)).toEqual([]);
    expect(switchChanges(null, after)).toEqual([]);
  });
});

describe("customer emails with the real sender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("resend");
    vi.doUnmock("@/lib/email/templates");
  });

  async function deliver(env: Record<string, string>) {
    vi.resetModules();
    for (const k of ["TEST_MODE", "EMAIL_REDIRECT", "VERCEL_ENV", "TEST_EMAIL_ALLOW"]) vi.stubEnv(k, "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("BUILDER_EMAIL", "builder@dinerai.co.uk");
    const sends: { to: string; subject: string }[] = [];
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send: async (m: { to: string; subject: string }) => (sends.push(m), { data: { id: "e1" }, error: null }) };
      },
    }));
    vi.doMock("@/lib/email/templates", () => ({ renderEmail: async () => ({ html: "<p>Hi</p>", text: "Hi" }) }));
    const { sendCustomerEmail } = await import("@/lib/email");
    const delivery = await sendCustomerEmail({
      restaurant: { name: "Ember & Spice Grill", owner_email: "owner@grill.co.uk", reply_to_email: null } as never,
      to: "ayesha@gmail.com",
      content: { kind: "campaign", subject: "A Thursday treat" } as never,
      oneClickUrl: null,
    }).catch((e: Error) => ({ error: e.message }));
    return { delivery, sends };
  }

  test("production with EMAIL_REDIRECT=false: the customer gets it", async () => {
    const { delivery, sends } = await deliver({ VERCEL_ENV: "production", EMAIL_REDIRECT: "false" });
    expect(delivery).toMatchObject({ delivery: "email", to: "ayesha@gmail.com", redirectedFrom: null });
    expect(sends[0].subject).toBe("A Thursday treat");
  });

  test("EMAIL_REDIRECT missing in production: redirected to the builder", async () => {
    const { delivery, sends } = await deliver({ VERCEL_ENV: "production" });
    expect(delivery).toMatchObject({ to: "builder@dinerai.co.uk", redirectedFrom: "ayesha@gmail.com" });
    expect(sends[0].subject).toMatch(/^\[Test → ayesha@gmail.com\]/);
  });

  test("preview with EMAIL_REDIRECT=false: still redirected to the builder", async () => {
    const { delivery } = await deliver({ VERCEL_ENV: "preview", EMAIL_REDIRECT: "false" });
    expect(delivery).toMatchObject({ to: "builder@dinerai.co.uk", redirectedFrom: "ayesha@gmail.com" });
  });

  test("TEST_EMAIL_ALLOW addresses still get their own while redirecting", async () => {
    const { delivery } = await deliver({ VERCEL_ENV: "production", EMAIL_REDIRECT: "true", TEST_EMAIL_ALLOW: "ayesha@gmail.com" });
    expect(delivery).toMatchObject({ to: "ayesha@gmail.com", redirectedFrom: null });
  });
});
