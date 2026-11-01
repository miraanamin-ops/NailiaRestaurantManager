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

// Reviews made by the Pilot Zero simulation (reviews.source): never replied to on
// Google, whatever the dry run switch says.
export const SIMULATED_REVIEW_SOURCE = "simulated";

// Google writes: dry run (Pilot Zero, migration 056). Per restaurant, set only in
// the admin console (/onboarding/admin/pilot-zero), never by the owner, WhatsApp,
// Dina or a profile edit. Two kinds of write:
//   replies   review replies and posts (and taking them down)
//   profile   hours and photos
// google_dry_run: true = replies are dry run, false = they go to Google, empty =
// the default: dry run for a Pilot Zero restaurant, live for everyone else.
// Profile writes are dry run whenever replies are, and for a Pilot Zero restaurant
// also until google_profile_writes is switched on separately.
// On Production it fails closed:
//   - before 056 (the columns aren't there) every Google write is refused;
//   - a restaurant on the builder's own number counts as Pilot Zero from the
//     start, before it's marked (so Maison Noor is dry run the moment it connects).
// Previews and local work keep the old behaviour (they never write to live Google
// anyway, lib/switches.ts), so the phone test isn't changed.
export type DryRunRestaurant = { pilot_zero?: boolean | null; google_dry_run?: boolean | null; google_profile_writes?: boolean | null; owner_whatsapp?: string | null };
export type GoogleWriteKind = "replies" | "profile";
export type DryRunContext = { production: boolean; builderWhatsApp?: string | null };

export const dryRunContext = (env: Record<string, string | undefined>): DryRunContext => ({ production: env.VERCEL_ENV === "production", builderWhatsApp: env.BUILDER_WHATSAPP ?? null });

const digits = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "");

// Counts as Pilot Zero for the dry run: marked, or (on Production) on the builder's number.
export function pilotForDryRun(restaurant: DryRunRestaurant, ctx: DryRunContext) {
  if (restaurant.pilot_zero === true) return true;
  return ctx.production && digits(ctx.builderWhatsApp) !== "" && digits(restaurant.owner_whatsapp) === digits(ctx.builderWhatsApp);
}

// Why this kind of write is dry run for this restaurant (null: it goes to Google).
export function googleDryRunReason(restaurant: DryRunRestaurant | null | undefined, what: GoogleWriteKind, ctx: DryRunContext): "missing_056" | "dry_run" | null {
  if (!restaurant) return null;
  if (!("pilot_zero" in restaurant)) return ctx.production ? "missing_056" : null;
  const pilot = pilotForDryRun(restaurant, ctx);
  const replies = restaurant.google_dry_run ?? pilot;
  if (what === "replies") return replies ? "dry_run" : null;
  return replies || !(restaurant.google_profile_writes ?? !pilot) ? "dry_run" : null;
}

export const googleDryRun = (restaurant: DryRunRestaurant | null | undefined, what: GoogleWriteKind, ctx: DryRunContext) => googleDryRunReason(restaurant, what, ctx) !== null;

export const writeKindForDraft = (kind: string): GoogleWriteKind => (kind === "hours_update" || kind === "menu_update" ? "profile" : "replies");

// From an API call: photos (media) and changes to the location itself (hours) are profile writes.
export const writeKindForCall = (method: string, url: string): GoogleWriteKind => (/\/media(\?|$)/.test(url) || method.toUpperCase() === "PATCH" ? "profile" : "replies");

// The last wall before Google: a test site never changes anything on live Google
// (reads are fine), and nor does a restaurant whose writes of that kind are dry run.
// A write that doesn't say which restaurant it's for is refused too.
export function googleWriteRefused(method: string, restaurant: ({ is_test?: boolean | null } & DryRunRestaurant) | null | undefined, url: string, ctx: DryRunContext) {
  if (method.toUpperCase() === "GET") return null;
  if (!restaurant) return "A Google write must say which restaurant it's for";
  if (restaurant.is_test) return "Test sites never write to live Google";
  const why = googleDryRunReason(restaurant, writeKindForCall(method, url), ctx);
  if (why === "missing_056") return "Google writes are refused until supabase/056_pilot_zero.sql has run on this database";
  return why ? "Google writes are dry run for this restaurant" : null;
}

// What the owner sees instead of a write that was dry run, or a reply to a
// simulated review (never posted to Google, whatever the dry run switch says).
export function dryRunNote(input: { kind: string; content: string; profile?: string | null; simulatedReview?: boolean }) {
  const where = `on Google${input.profile ? ` (${input.profile})` : ""}`;
  const quote = (t: string) => `"${t.length > 300 ? `${t.slice(0, 299)}…` : t}"`;
  const what =
    input.kind === "review_reply"
      ? `posted this reply ${where}: ${quote(input.content)}`
      : input.kind === "google_post"
        ? `posted this ${where} as a post: ${quote(input.content)}`
        : `updated your ${input.kind === "menu_update" ? "menu" : "hours"} ${where}`;
  return input.simulatedReview
    ? `🧪 Simulated review, so never replied to on Google. Would have ${what}`
    : `🧪 Dry run: nothing changed on Google. Would have ${what}`;
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
