// The photo "part 2" (phase 4 of the Inbox and emails plan, 15 Nov 2026, the owner's
// flow): the owner approves an offer email about a dish we have no photo of; that card
// goes and a second one takes its place, "Add a photo of the lamb chops", with Take
// photo, Choose photo and Send without. The email waits for it, at most until its
// deadline, then goes either way. Plain code (tests/photo-ask.test.ts).

export const PHOTO_WAIT_MS = 3 * 60 * 60 * 1000;

// Asked only for an offer about one dish, with no photo yet, in a family whose looks show one.
export function wantsPhoto(design: { family: string; photo_url: string | null } | null, dish: string | null) {
  return Boolean(design && dish && !design.photo_url && design.family !== "birthday");
}

// How long it waits: 3 hours from approval, or its own send time if that's later.
export function photoDeadline(now: Date, sendAt: string | null) {
  const wait = new Date(now.getTime() + PHOTO_WAIT_MS);
  const own = sendAt ? new Date(sendAt) : null;
  return own && own > wait ? own : wait;
}

// What's saved on the campaign while it waits (inside campaigns.email_design, 071).
export type PhotoAsk = { request_draft_id: string; dish: string; until: string; original_send_at: string | null; answered: "photo" | "without" | null };

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).replace(" ", "").toLowerCase();
const day = (d: Date, now: Date) =>
  d.toLocaleDateString("en-GB", { timeZone: "Europe/London" }) === now.toLocaleDateString("en-GB", { timeZone: "Europe/London" })
    ? time(d)
    : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" })}, ${time(d)}`;

// The card's words (short: the owner's "less is more").
export function askText(dish: string, until: Date, now: Date) {
  return `Add a photo of the ${dish.toLowerCase()} and it goes in the email. It sends at ${day(until, now)} either way.`;
}
export const approvedLine = (dish: string) => `Approved. Add a photo of the ${dish.toLowerCase()}? It's next in your Inbox.`;
export const savedLine = (sendNow: boolean, at: Date | null, now: Date) => (sendNow ? "Photo added. Sending now." : `Photo added. It sends at ${at ? day(at, now) : "its send time"}.`);
export const withoutLine = (sendNow: boolean, at: Date | null, now: Date) => (sendNow ? "Sending without a photo." : `It sends at ${at ? day(at, now) : "its send time"}, without a photo.`);
