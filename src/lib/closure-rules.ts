// Closing a restaurant's account (Pilot Zero phase 5; admin console only, the
// owner-facing flow comes later). Plain code with no imports, so every rule is
// unit-tested (tests/closure.test.ts); lib/closure.ts carries it out.
//
//   1. Request (the builder types the restaurant's name): nothing changes yet.
//   2. Confirm (types it again and ticks "I understand"): sending is paused, the
//      owner is emailed, and it closes after a 24-hour cooling-off. Cancellable
//      until then (sending goes back to how it was). A demo or Pilot Zero
//      restaurant can skip the cooling-off.
//   3. Closing (a queued job): the export (CSV and JSON, a 7-day link, the files
//      deleted when it runs out), the email with the links, Google (our access
//      revoked, or the builder told to remove our manager account), Stripe
//      cancelled (when it's on), then every file and row of the restaurant deleted.
//      One anonymous line is kept: a reference, the kind of restaurant, the dates
//      and the counts. No name, email or number.

export const COOLING_OFF_MS = 24 * 60 * 60_000;
export const EXPORT_DAYS = 7;
// The demo pair is never closed (scripts/delete-restaurants.mjs keeps them too).
export const NEVER_CLOSE = ["ember-spice", "cardamom-corner"];

export type ClosureStatus = "requested" | "scheduled" | "closing" | "closed" | "cancelled" | "failed";
export type ClosureKind = "demo" | "pilot_zero" | "real";

export type ClosureRestaurant = { slug?: string | null; is_demo?: boolean | null; is_test?: boolean | null; pilot_zero?: boolean | null };

export const closureKind = (r: ClosureRestaurant): ClosureKind => (r.pilot_zero === true ? "pilot_zero" : r.is_demo === true || r.is_test === true ? "demo" : "real");

// Why this restaurant can't be closed here (null: it can).
export function closeRefused(r: ClosureRestaurant) {
  return r.slug && NEVER_CLOSE.includes(r.slug) ? "Ember & Spice and Cardamom Corner are the demo restaurants: they're never closed." : null;
}

export const canSkipCoolingOff = (r: ClosureRestaurant) => closureKind(r) !== "real";

export const nameMatches = (typed: string | null | undefined, name: string) => (typed ?? "").trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== "";

// When it closes: after the cooling-off, or straight away if skipped (demo and Pilot Zero only).
export function closesAt(r: ClosureRestaurant, confirmedAt: Date, skip: boolean) {
  return skip && canSkipCoolingOff(r) ? confirmedAt : new Date(confirmedAt.getTime() + COOLING_OFF_MS);
}

// "CL-7F3K2Q": the anonymous reference (from 6 random bytes' worth of letters and digits).
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const closureRef = (random: Uint8Array) => `CL-${Array.from(random.slice(0, 6), (b) => REF_CHARS[b % REF_CHARS.length]).join("")}`;

// Google at closing: an owner's own login is revoked; the shared manager account
// (dina@dinerai.co.uk) can't be removed from their profile by us, so the builder is
// alerted and the owner is told how to remove it.
export type GoogleClosing = "revoke" | "remove_manager" | "none";
export function googleClosing(input: { linked: boolean; connectionKind: string | null }): GoogleClosing {
  if (!input.linked) return "none";
  return input.connectionKind === "owner" ? "revoke" : "remove_manager";
}

// The owner's email when closing is confirmed (the cooling-off starts).
export function confirmEmail(input: { restaurant: string; closesAt: string; coolingOff: boolean }) {
  const subject = `Closing your DinerAI account for ${input.restaurant}`;
  const text = [
    `We've been asked to close the DinerAI account for ${input.restaurant}.`,
    "",
    input.coolingOff
      ? `It closes on ${input.closesAt}. Until then nothing is deleted, and nothing is sent to your customers. If you didn't ask for this, or you've changed your mind, reply to this email before then and we'll cancel it.`
      : `It's closing now.`,
    "",
    `When it closes you'll get a link to download everything we hold for ${input.restaurant} (your customer list, sales and the rest, as CSV and JSON files). The link works for ${EXPORT_DAYS} days. Then everything is deleted.`,
    "",
    "Dina, your DinerAI manager",
  ].join("\n");
  return { subject, text };
}

// The owner's email at closing, with the download links.
export function closedEmail(input: { restaurant: string; links: { label: string; url: string }[]; expires: string; removeManager: { email: string; profile: string } | null }) {
  const subject = `Your DinerAI account for ${input.restaurant} is closed`;
  const text = [
    `The DinerAI account for ${input.restaurant} is now closed, and everything we held is being deleted.`,
    "",
    `Your data, to download before ${input.expires} (the files are deleted after that):`,
    ...input.links.map((l) => `- ${l.label}: ${l.url}`),
    "",
    ...(input.removeManager
      ? [
          `One thing for you to do: remove our manager account (${input.removeManager.email}) from your Google Business Profile${input.removeManager.profile ? ` (${input.removeManager.profile})` : ""}. On Google: your Business Profile > Menu (three dots) > Business Profile settings > People and access > ${input.removeManager.email} > Remove. We've stopped using it already.`,
          "",
        ]
      : []),
    "Thank you for trying DinerAI.",
    "",
    "Dina, your DinerAI manager",
  ].join("\n");
  return { subject, text };
}
