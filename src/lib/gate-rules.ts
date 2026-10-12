// Two release-gate rules added with the agent organisation. No imports, so
// both are unit-tested (tests/gate.test.ts); lib/send.ts and lib/campaigns.ts use them.

export type SendChannel = "email" | "google" | "whatsapp";

export type TestModeStep =
  | { outcome: "ok"; detail: string }
  | { outcome: "simulate"; detail: string }; // goes through the motions, reaches nobody

// TEST_MODE as a gate step: in test mode nothing reaches a real customer, owner
// or platform. Emails are already routed (dummy addresses never emailed, everyone
// else redirected to the builder: lib/email/route.ts); live Google is simulated.
// WhatsApp to customers is off until Meta verification, test mode or not.
export function testModeStep(input: { testMode: boolean; channel: SendChannel; googleMode: "dummy" | "live" }): TestModeStep {
  if (input.channel === "whatsapp") return { outcome: "simulate", detail: "WhatsApp to customers is off until Meta verification, so nothing was sent." };
  if (!input.testMode) return { outcome: "ok", detail: "Test mode is off." };
  if (input.channel === "google") {
    return input.googleMode === "live"
      ? { outcome: "simulate", detail: "Test mode: not posted to the live Google listing." }
      : { outcome: "ok", detail: "Test mode: dummy Google only." };
  }
  return { outcome: "ok", detail: "Test mode: emails go only to the builder and owner (everyone else is redirected)." };
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
