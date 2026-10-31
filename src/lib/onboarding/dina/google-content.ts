// The Google step's fixed words (step 2): the steps to add DinerAI as a manager
// (Path B), tailored to phone or laptop, each with a screenshot slot; the message
// an owner forwards to whoever set the profile up; what Dina says once Google
// has accepted us; the one 24-hour nudge; and the "Email me these steps" email.
// Plain code, unit-tested (tests/dina-steps.test.ts). Dina never writes these.
//
// The screenshots are placeholders in public/onboarding/google/ (phone-1.png …
// laptop-4.png) for the builder to replace with real ones; VIDEO_SLOT is where a
// short video goes on the web once there is one.

export type Device = "phone" | "laptop";
export const VIDEO_SLOT: Record<Device, string | null> = { phone: null, laptop: null };

export type GoogleStep = { n: number; text: string; image: string; copy?: string };

export function managerSteps(device: Device, managerEmail: string): GoogleStep[] {
  const img = (n: number) => `/onboarding/google/${device}-${n}.png`;
  const tap = device === "phone" ? "Tap" : "Click";
  return [
    {
      n: 1,
      text:
        device === "phone"
          ? "Open Google Maps (or google.com) signed in with the account that manages your profile, and search your restaurant's name."
          : "Sign in to Google with the account that manages your profile, and search your restaurant's name.",
      image: img(1),
    },
    { n: 2, text: `${tap} Menu (or the three dots), then Business Profile settings, then People and access.`, image: img(2) },
    { n: 3, text: `${tap} Add at the top and paste our email: ${managerEmail}`, image: img(3), copy: managerEmail },
    { n: 4, text: `Under Access, choose Manager, then ${tap.toLowerCase()} Invite.`, image: img(4) },
  ];
}

export const REASSURANCE = "Manager, not Owner. You stay in control and can remove us any time.";
export const SIGN_IN_HINT = "Use the Google account you manage your profile with.";

// For an owner who isn't an owner on the profile: a message they can forward to whoever is.
export function forwardMessage(restaurantName: string, managerEmail: string) {
  return [
    `Hi, could you add DinerAI as a manager on the Google profile for ${restaurantName}? They'll reply to our reviews and post updates for us.`,
    `1. Open the profile on Google (search ${restaurantName}) signed in as its owner.`,
    "2. Go to Menu, then Business Profile settings, then People and access.",
    `3. Add ${managerEmail}, choose Manager, then Invite.`,
    "Manager, not Owner: we stay in control and can remove them any time. Thanks!",
  ].join("\n");
}

// Once we're in: something concrete from the profile, and Google's 7-day wait.
export function acceptedText(reviews: { count: number; average: number | null }) {
  const first =
    reviews.count === 0
      ? "I'm in! Your profile has no reviews yet, so I'll be ready for the first one."
      : `I'm in! You have ${reviews.count} review${reviews.count === 1 ? "" : "s"}${reviews.average ? ` and a ${reviews.average.toFixed(1)} rating` : ""}.`;
  return `${first} Google makes new managers wait 7 days before some features unlock, so a few things may take a week to switch on.`;
}

export function averageRating(ratings: number[]) {
  return ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;
}

export const NUDGE_TEXT = "Just checking: did you get a chance to add DinerAI as a manager on Google? I can send the steps again.";

// "Email me these steps": plain text and simple HTML, the screenshots as links on our site.
export function stepsEmail(input: { restaurantName: string; device: Device; managerEmail: string; appUrl: string; nudge?: boolean }) {
  const steps = managerSteps(input.device, input.managerEmail);
  const subject = input.nudge ? `Adding DinerAI to ${input.restaurantName}'s Google profile` : `Your steps: adding DinerAI to ${input.restaurantName}'s Google profile`;
  const intro = input.nudge ? NUDGE_TEXT : "Here are the steps to add DinerAI as a manager on your Google profile, for whenever you're ready.";
  const text = [
    intro,
    "",
    ...steps.map((s) => `${s.n}. ${s.text}`),
    "",
    REASSURANCE,
    "",
    `When it's done, tell Dina on WhatsApp or in the chat: ${input.appUrl}/onboarding/chat`,
    "",
    "Dina, your DinerAI manager",
  ].join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1c1917">
<p>${esc(intro)}</p>
${steps.map((s) => `<p><b>${s.n}.</b> ${esc(s.text)}<br><img src="${input.appUrl}${s.image}" alt="Step ${s.n}" width="480" style="max-width:100%;border-radius:8px;margin-top:6px"></p>`).join("\n")}
<p><b>${esc(REASSURANCE)}</b></p>
<p>When it's done, tell Dina on WhatsApp or in the <a href="${input.appUrl}/onboarding/chat">setup chat</a>.</p>
<p>Dina, your DinerAI manager</p></div>`;
  return { subject, text, html };
}

// The one gentle nudge, 24 hours on: they said they'd invited us but Google hasn't
// accepted, or they were shown the steps and haven't said they've done it. Once only.
export const NUDGE_AFTER_MS = 24 * 3_600_000;
export type GoogleStepNow = { status: string; waitingOn: string | null; data: Record<string, unknown> };

export function googleNudgeDue(step: GoogleStepNow, now: Date): "not_accepted" | "not_invited" | null {
  if (step.data.nudged_at || step.status !== "in_progress") return null;
  const since = (key: string) => (typeof step.data[key] === "string" ? now.getTime() - Date.parse(step.data[key] as string) : -1);
  if (step.waitingOn === "google" && since("invited_at") >= NUDGE_AFTER_MS) return "not_accepted";
  if (!step.waitingOn && since("steps_shown_at") >= NUDGE_AFTER_MS) return "not_invited";
  return null;
}
