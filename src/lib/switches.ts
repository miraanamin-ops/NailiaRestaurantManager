// The switches that decide what the app is allowed to do. Each is a Vercel
// environment variable, read here and nowhere else. No imports, so every rule
// is unit-tested (tests/switches.test.ts).
//
//   EMAIL_REDIRECT       customer emails go to the builder (TEST_EMAIL_ALLOW, the
//                        builder and the owner still get their own). Preview and
//                        development deployments always redirect.
//   TEST_TOOLS           test commands (TIME, NEW REVIEW, RUN ...), the test clock,
//                        RESET ONBOARDING, new sign-ups as demo restaurants. Only
//                        ever acts on demo restaurants.
//   GOOGLE_MODE          dummy (default) / simulated (read live Google, write nothing)
//                        / live. Preview and development never write to live Google.
//   AGENTS_LIVE_ALLOWED  false = kill switch: every agent runs in shadow, whatever a
//                        restaurant is set to. true = an agent the builder set to live
//                        goes live once its readiness check passes.
//   ANALYTICS_JOBS       true = the nightly jobs queue the analytics service's models
//                        (03:05 UK, one job per model per active restaurant). Off
//                        unless set; TEST_MODE never turns it on. Turn it on only
//                        once the Python worker is deployed, or the jobs pile up.
//   TEST_MODE            DEPRECATED. Only fills in a switch above that isn't set.
//
// Safe by default: a missing or unreadable setting means redirect email, tools
// off, Google dummy, agents in shadow (apart from Reputation's old rule, below).

export type Env = Record<string, string | undefined>;
export type Source = "setting" | "TEST_MODE (deprecated)" | "default" | "forced";
export type GoogleSetting = "dummy" | "simulated" | "live";
export type LiveAgent = "reputation" | "visibility" | "insights" | "growth" | "gm";

export type Switches = {
  environment: "production" | "preview" | "development";
  emailRedirect: { on: boolean; source: Source; note?: string };
  testTools: { on: boolean; source: Source; note?: string };
  google: { mode: GoogleSetting; source: Source; note?: string };
  agentsLive: { allowed: "all" | "none" | "legacy"; source: Source; note?: string };
  analyticsJobs: { on: boolean; source: Source; note?: string };
};

// true / false, on / off, yes / no, 1 / 0 (any case, spaces ignored). Anything else is unreadable.
export function readFlag(value: string | undefined): boolean | "missing" | "unreadable" {
  if (value === undefined || value.trim() === "") return "missing";
  const v = value.trim().toLowerCase();
  if (["true", "on", "yes", "1"].includes(v)) return true;
  if (["false", "off", "no", "0"].includes(v)) return false;
  return "unreadable";
}

// TEST_MODE keeps its old exact rule, so nothing changes for it on merge.
const legacyTestMode = (env: Env) => env.TEST_MODE === "true";

// Only a Vercel production deployment counts as production. Anything else
// (a preview, local `next dev`, the tests, an unknown host) is treated as not.
export function environmentOf(env: Env): Switches["environment"] {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

function flagSwitch(env: Env, name: string, safe: boolean) {
  const own = readFlag(env[name]);
  if (typeof own === "boolean") return { on: own, source: "setting" as Source };
  // Unreadable: the safe value, whatever TEST_MODE says.
  if (own === "unreadable") return { on: safe, source: "default" as Source, note: `${name}="${env[name]}" isn't true or false, so it's ${safe ? "on" : "off"}` };
  if (legacyTestMode(env)) return { on: true, source: "TEST_MODE (deprecated)" as Source };
  return { on: safe, source: "default" as Source };
}

export function emailRedirectSwitch(env: Env): Switches["emailRedirect"] {
  const s = flagSwitch(env, "EMAIL_REDIRECT", true);
  if (environmentOf(env) !== "production" && !s.on) return { on: true, source: "forced", note: "Preview and development always redirect customer emails" };
  return s;
}

// Off unless set (or TEST_MODE=true), in every environment.
export function testToolsSwitch(env: Env): Switches["testTools"] {
  return flagSwitch(env, "TEST_TOOLS", false);
}

export function googleSwitch(env: Env): Switches["google"] {
  const raw = env.GOOGLE_MODE?.trim().toLowerCase();
  const known = raw === "dummy" || raw === "simulated" || raw === "live";
  const note = raw && !known ? `GOOGLE_MODE="${env.GOOGLE_MODE}" isn't dummy, simulated or live` : undefined;
  if (!known) return { mode: "dummy", source: "default", note };
  if (raw === "live" && environmentOf(env) !== "production") return { mode: "simulated", source: "forced", note: "Preview and development never write to live Google" };
  // The old rule: TEST_MODE with GOOGLE_MODE=live read live Google but posted nothing.
  if (raw === "live" && legacyTestMode(env)) return { mode: "simulated", source: "TEST_MODE (deprecated)", note: "Delete TEST_MODE to really write to live Google" };
  return { mode: raw, source: "setting" };
}

// "all": every agent may go live (still per restaurant, once ready). "none": the
// kill switch. "legacy" (not set): today's rule, Reputation by its checklist,
// the others only with TEST_MODE=true.
export function agentsLiveSwitch(env: Env): Switches["agentsLive"] {
  const own = readFlag(env.AGENTS_LIVE_ALLOWED);
  if (own === true) return { allowed: "all", source: "setting" };
  if (own === false) return { allowed: "none", source: "setting" };
  // Unreadable is treated as the kill switch: it's what someone typing a value meant to protect.
  if (own === "unreadable") return { allowed: "none", source: "default", note: `AGENTS_LIVE_ALLOWED="${env.AGENTS_LIVE_ALLOWED}" isn't true or false, so every agent stays in shadow` };
  return { allowed: "legacy", source: "default" };
}

// Off unless set to true. Unlike the others, TEST_MODE doesn't fill it in: it
// queues work for a separate service, which may not be running.
export function analyticsJobsSwitch(env: Env): Switches["analyticsJobs"] {
  const own = readFlag(env.ANALYTICS_JOBS);
  if (typeof own === "boolean") return { on: own, source: "setting" };
  if (own === "unreadable") return { on: false, source: "default", note: `ANALYTICS_JOBS="${env.ANALYTICS_JOBS}" isn't true or false, so it's off` };
  return { on: false, source: "default" };
}

export function agentLiveAllowed(env: Env, agent: LiveAgent) {
  const s = agentsLiveSwitch(env);
  if (s.allowed === "legacy") return agent === "reputation" || legacyTestMode(env);
  return s.allowed === "all";
}

// What an agent really runs as: live only if the builder set it live, live is
// allowed, and its readiness check passes right now. Otherwise live becomes shadow.
export function effectiveAgentMode<M extends string>(set: M, input: { liveAllowed: boolean; ready: boolean }): M | "shadow" {
  if (set !== "live") return set;
  return input.liveAllowed && input.ready ? set : "shadow";
}

// Why an agent set to live is running in shadow, for the builder (null: it isn't).
export function agentModeReason(env: Env, agent: LiveAgent, set: string, ready: boolean) {
  if (set !== "live") return null;
  if (!agentLiveAllowed(env, agent)) {
    return agentsLiveSwitch(env).allowed === "none"
      ? "the kill switch is on (AGENTS_LIVE_ALLOWED is false)"
      : "AGENTS_LIVE_ALLOWED isn't set to true (without it only Reputation can go live)";
  }
  return ready ? null : "its readiness check doesn't pass";
}

// Test tools only ever act on a demo restaurant: a real one is never affected,
// whatever TEST_TOOLS says.
export function testToolsFor(env: Env, restaurant: { is_demo?: boolean | null }) {
  return testToolsSwitch(env).on && restaurant.is_demo === true;
}

export function allSwitches(env: Env): Switches {
  return {
    environment: environmentOf(env),
    emailRedirect: emailRedirectSwitch(env),
    testTools: testToolsSwitch(env),
    google: googleSwitch(env),
    agentsLive: agentsLiveSwitch(env),
    analyticsJobs: analyticsJobsSwitch(env),
  };
}

// One line per switch, for /log, STATUS and the settings page.
export function describeSwitches(s: Switches) {
  const from = (src: Source) => (src === "setting" ? "" : ` (${src === "forced" ? "forced" : `from ${src}`})`);
  const live = s.agentsLive.allowed === "all" ? "allowed" : s.agentsLive.allowed === "none" ? "off (kill switch)" : "Reputation only, others need TEST_MODE";
  return [
    { name: "Environment", value: s.environment, note: undefined },
    { name: "EMAIL_REDIRECT", value: `${s.emailRedirect.on ? "on" : "off"}${from(s.emailRedirect.source)}`, note: s.emailRedirect.note },
    { name: "TEST_TOOLS", value: `${s.testTools.on ? "on" : "off"}${from(s.testTools.source)}`, note: s.testTools.note },
    { name: "GOOGLE_MODE", value: `${s.google.mode}${from(s.google.source)}`, note: s.google.note },
    { name: "AGENTS_LIVE_ALLOWED", value: `${live}${s.agentsLive.allowed === "legacy" ? " (not set)" : from(s.agentsLive.source)}`, note: s.agentsLive.note },
    { name: "ANALYTICS_JOBS", value: `${s.analyticsJobs.on ? "on" : "off"}${from(s.analyticsJobs.source)}`, note: s.analyticsJobs.note },
  ];
}

// The compact record kept on each job run, so changes between runs can be spotted.
export function switchesRecord(s: Switches) {
  return { environment: s.environment, email_redirect: s.emailRedirect.on, test_tools: s.testTools.on, google: s.google.mode, agents_live: s.agentsLive.allowed, analytics_jobs: s.analyticsJobs.on };
}

// What changed from one run's record to the next ("email_redirect: true → false").
// Nothing to compare (an older run without a record) counts as no change.
export function switchChanges(previous: Record<string, unknown> | null | undefined, current: Record<string, unknown> | null | undefined) {
  if (!previous || !current) return [];
  return Object.keys(current)
    .filter((k) => previous[k] !== current[k])
    .map((k) => `${k}: ${String(previous[k] ?? "unset")} → ${String(current[k])}`);
}
