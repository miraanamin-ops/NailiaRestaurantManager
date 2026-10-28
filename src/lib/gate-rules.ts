// Two release-gate rules added with the agent organisation. No imports, so
// both are unit-tested (tests/gate.test.ts); lib/send.ts and lib/campaigns.ts use them.

export type SendChannel = "email" | "google" | "whatsapp";

export type SimulationStep =
  | { outcome: "ok"; detail: string }
  | { outcome: "simulate"; detail: string }; // goes through the motions, reaches nobody

// The simulation gate step: what reaches the outside world, by the switches in
// lib/switches.ts. Emails are routed per address (dummy addresses never emailed;
// with EMAIL_REDIRECT on, everyone else goes to the builder: lib/email/route.ts).
// GOOGLE_MODE=simulated reads live Google but posts nothing. WhatsApp to
// customers is off until Meta verification, whatever the switches say.
// A test site (restaurants.is_test) never reaches anyone real on any channel,
// whatever the switches say: no live Google, emails only to the builder and owner.
export function simulationStep(input: { channel: SendChannel; google: "dummy" | "simulated" | "live"; emailRedirect: boolean; testSite?: boolean }): SimulationStep {
  if (input.channel === "whatsapp") return { outcome: "simulate", detail: "WhatsApp to customers is off until Meta verification, so nothing was sent." };
  if (input.channel === "google") {
    if (input.testSite && input.google !== "dummy") return { outcome: "simulate", detail: "Test site: never posted to the live Google listing." };
    if (input.google === "simulated") return { outcome: "simulate", detail: "Google is simulated: not posted to the live Google listing." };
    return { outcome: "ok", detail: input.google === "dummy" ? "Dummy Google only." : "Live Google." };
  }
  return input.emailRedirect || input.testSite
    ? { outcome: "ok", detail: `${input.testSite ? "Test site: e" : "E"}mails go only to the builder and owner (everyone else is redirected).` }
    : { outcome: "ok", detail: "Emails go to the customers." };
}

// The last wall before Google: a test site never changes anything on live Google
// (reads are fine). A write that doesn't say which restaurant it's for is refused too.
export function googleWriteRefused(method: string, restaurant: { is_test?: boolean | null } | null | undefined) {
  if (method.toUpperCase() === "GET") return null;
  if (!restaurant) return "A Google write must say which restaurant it's for";
  return restaurant.is_test ? "Test sites never write to live Google" : null;
}

// Emails from a test site are always redirected (to the builder; the builder and
// the owner still get their own), whatever EMAIL_REDIRECT says.
export const redirectEmails = (switchOn: boolean, restaurant: { is_test?: boolean | null }) => switchOn || restaurant.is_test === true;

export function channelFor(kind: string): SendChannel {
  if (kind === "review_reply" || kind === "google_post" || kind === "hours_update" || kind === "menu_update") return "google";
  if (kind === "email_campaign") return "email";
  return "whatsapp";
}

// No customer gets more than one campaign in any 7 days. Birthday emails are
// excepted: they don't count, and they aren't held back.
export const CAMPAIGN_GAP_DAYS = 7;

export function weeklyLimit<T extends { id: string }>(eligible: T[], recentlySent: Set<string>, isBirthday: boolean) {
  if (isBirthday) return { allowed: eligible, limited: 0 };
  const allowed = eligible.filter((c) => !recentlySent.has(c.id));
  return { allowed, limited: eligible.length - allowed.length };
}

// Google writes (a review reply or a post) and the checker agent: with the checker
// live for the restaurant, nothing reaches Google unless the checker passed that
// exact version of the draft (an edit makes a new version, so it's checked again).
// No live verdict for this version yet: check it now, then decide. Hours and menu
// updates are code's own wording from the profile, so they don't need it; with the
// checker in shadow (the old assistant) the four checks still decide, as before.
export const CHECKED_GOOGLE_KINDS: ReadonlySet<string> = new Set(["review_reply", "google_post"]);

export type CheckerStep = { outcome: "ok" } | { outcome: "check_now" } | { outcome: "blocked"; detail: string };

export function googleCheckerStep(input: {
  kind: string;
  checkerLive: boolean;
  version: number;
  agentCheck: { mode: string; verdict: string; draft_version: number; notes?: string | null } | null | undefined;
}): CheckerStep {
  if (!input.checkerLive || !CHECKED_GOOGLE_KINDS.has(input.kind)) return { outcome: "ok" };
  const c = input.agentCheck;
  if (!c || c.mode !== "live" || c.draft_version !== input.version) return { outcome: "check_now" };
  if (c.verdict === "pass") return { outcome: "ok" };
  const why = c.notes?.trim() ? ` ${c.notes.trim().slice(0, 240)}` : "";
  return { outcome: "blocked", detail: `The checker didn't pass this version (${c.verdict}).${why} Edit it and approve again, or skip it.` };
}
