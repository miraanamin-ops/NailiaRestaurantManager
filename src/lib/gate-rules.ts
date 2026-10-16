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
export function simulationStep(input: { channel: SendChannel; google: "dummy" | "simulated" | "live"; emailRedirect: boolean }): SimulationStep {
  if (input.channel === "whatsapp") return { outcome: "simulate", detail: "WhatsApp to customers is off until Meta verification, so nothing was sent." };
  if (input.channel === "google") {
    if (input.google === "simulated") return { outcome: "simulate", detail: "Google is simulated: not posted to the live Google listing." };
    return { outcome: "ok", detail: input.google === "dummy" ? "Dummy Google only." : "Live Google." };
  }
  return input.emailRedirect
    ? { outcome: "ok", detail: "Emails go only to the builder and owner (everyone else is redirected)." }
    : { outcome: "ok", detail: "Emails go to the customers." };
}

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
